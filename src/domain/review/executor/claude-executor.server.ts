import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../../common/logger.ts';
import { pickHostEnv } from '../../../config/host-env.ts';
import { buildNarrativePrompt } from '../prompt/narrative-prompt.ts';
import { parseNarrativeReview } from '../prompt/parse-narrative.ts';
import {
  abortError,
  ExecutorParseError,
  ExecutorProcessError,
  type ReviewExecutor,
  type ReviewExecutorInput,
  type ReviewExecutorOutput,
} from './types.ts';

/**
 * Runs the Claude Agent SDK against the cloned tree with read-only tools
 * (Read/Glob/Grep), the filesystem sandbox pinned to the clone, no settings
 * from the reviewed repository (so its `.claude/` cannot register hooks or
 * MCP servers) and no persisted transcript. Only an allowlist of host
 * variables reaches the SDK subprocess.
 */
const FILESYSTEM_BOUNDARY = `

---
You are running inside a freshly cloned working tree at the current working directory. The diff in the user prompt is your primary input. You may use Read, Glob, and Grep to look up surrounding context. Output only the <narrative_review> JSON block — no preamble, no closing remarks.`;

const MAX_TURNS = 30;
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'] as const;

/** Host variables forwarded to the SDK subprocess: credentials, proxies, paths. */
export const CLAUDE_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'PATH',
  'Path',
  'SystemRoot',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
];

export type ClaudeQueryFn = typeof query;

export interface ClaudeExecutorDeps {
  queryFn?: ClaudeQueryFn;
  /** Environment for the SDK subprocess; defaults to the host allowlist. */
  env?: Record<string, string>;
}

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'text' &&
    'text' in block &&
    typeof block.text === 'string'
  );
}

export class ClaudeExecutor implements ReviewExecutor {
  readonly name = 'claude';
  readonly #deps: ClaudeExecutorDeps;

  constructor(deps: ClaudeExecutorDeps = {}) {
    this.#deps = deps;
  }

  async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
    if (input.signal.aborted) throw abortError('claude run aborted before start');

    const { system, user, wasTruncated, hunkIndex } = buildNarrativePrompt(input.prData);

    const abortController = new AbortController();
    input.signal.addEventListener('abort', () => abortController.abort(), { once: true });

    const queryFn = this.#deps.queryFn ?? query;
    const env = this.#deps.env ?? pickHostEnv(CLAUDE_ENV_KEYS);
    const log = logger.child({ job_id: input.jobId, executor: this.name });

    const options: Options = {
      cwd: input.cloneDir,
      model: input.model,
      systemPrompt: system + FILESYSTEM_BOUNDARY,
      tools: [...READ_ONLY_TOOLS],
      allowedTools: [...READ_ONLY_TOOLS],
      permissionMode: 'dontAsk',
      sandbox: {
        enabled: true,
        failIfUnavailable: false,
        allowUnsandboxedCommands: false,
        filesystem: {
          allowRead: [input.cloneDir],
          denyWrite: [input.cloneDir],
          allowManagedReadPathsOnly: true,
        },
        network: { allowManagedDomainsOnly: true },
      },
      settingSources: [],
      persistSession: false,
      abortController,
      maxTurns: MAX_TURNS,
      env,
    };

    let raw = '';
    let chunkError: Error | null = null;
    let resultError: string | null = null;

    try {
      for await (const message of queryFn({ prompt: user, options })) {
        if (chunkError) break;
        if (message.type === 'assistant') {
          const content: unknown = message.message.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (!isTextBlock(block)) continue;
            raw += block.text;
            if (!input.onChunk) continue;
            try {
              input.onChunk(block.text);
            } catch (err) {
              chunkError = err instanceof Error ? err : new Error(String(err));
              abortController.abort();
              break;
            }
          }
        } else if (message.type === 'result' && message.subtype !== 'success') {
          resultError = `claude SDK result subtype=${message.subtype}`;
        }
      }
    } catch (err) {
      if (chunkError) throw chunkError;
      if (input.signal.aborted) {
        log.info({ err }, 'claude executor aborted by signal');
        throw abortError('claude executor aborted');
      }
      log.error({ err }, 'claude SDK error');
      throw new ExecutorProcessError(
        err instanceof Error ? err.message : String(err),
        '',
        null,
        raw,
      );
    }

    if (chunkError) throw chunkError;
    // The SDK may stop iterating on abort without throwing; report the abort,
    // not a confusing parse failure.
    if (input.signal.aborted) throw abortError('claude executor aborted');

    // Parse first: a complete narrative followed by a non-success result
    // (error_max_turns during cleanup, say) is still a usable review.
    const parsed = parseNarrativeReview(raw, hunkIndex);
    if (!parsed.ok) {
      if (resultError) throw new ExecutorProcessError(resultError, '', null, raw);
      throw new ExecutorParseError(parsed.error, raw);
    }
    return { review: parsed.data, wasTruncated, rawText: raw };
  }
}
