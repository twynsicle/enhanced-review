import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

import { logger } from '@/lib/log';
import { buildNarrativePrompt } from '../prompt/narrative-prompt';
import { parseNarrativeReview } from '../prompt/parse-narrative';
import {
  ExecutorParseError,
  ExecutorProcessError,
  type ReviewExecutor,
  type ReviewExecutorInput,
  type ReviewExecutorOutput,
} from './types';

const FILESYSTEM_BOUNDARY = `

---
You are running inside a freshly cloned working tree at the current working directory. The diff in the user prompt is your primary input. You may use Read, Glob, and Grep to look up surrounding context. Output only the <narrative_review> JSON block — no preamble, no closing remarks.`;

const MAX_TURNS = 30;
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'] as const;

export type ClaudeQueryFn = typeof query;

export interface ClaudeExecutorDeps {
  queryFn?: ClaudeQueryFn;
  env?: NodeJS.ProcessEnv;
}

function pickEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): NodeJS.ProcessEnv {
  const out = {} as NodeJS.ProcessEnv;
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function buildClaudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...pickEnv(env, [
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
    ]),
  };
}

export class ClaudeExecutor implements ReviewExecutor {
  readonly name = 'claude';

  constructor(private readonly deps: ClaudeExecutorDeps = {}) {}

  async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
    if (input.signal.aborted) {
      const aborted = new Error('claude run aborted before start');
      aborted.name = 'AbortError';
      throw aborted;
    }

    const { system, user, wasTruncated, hunkIndex } = buildNarrativePrompt(input.prData);

    const abortController = new AbortController();
    input.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    if (input.signal.aborted) abortController.abort();

    const queryFn = this.deps.queryFn ?? query;
    const env = buildClaudeEnv(this.deps.env ?? process.env);

    const log = logger.child({ job_id: input.jobId, executor: 'claude' });

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
      // Isolation mode: prevent the reviewed repo's .claude/settings.json from
      // registering hooks or MCP servers that would run with the host process env.
      settingSources: [],
      // Don't persist PR transcripts to ~/.claude/projects/.
      persistSession: false,
      abortController,
      maxTurns: MAX_TURNS,
      env,
    };

    const q = queryFn({ prompt: user, options });

    let raw = '';
    let chunkError: Error | null = null;
    let resultError: string | null = null;

    try {
      for await (const message of q) {
        if (chunkError) break;
        if (message.type === 'assistant') {
          const content = message.message?.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (
              block != null &&
              typeof block === 'object' &&
              'type' in block &&
              block.type === 'text' &&
              'text' in block &&
              typeof block.text === 'string'
            ) {
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
          }
        } else if (message.type === 'result' && message.subtype !== 'success') {
          resultError = `claude SDK result subtype=${message.subtype}`;
        }
      }
    } catch (err) {
      if (chunkError) throw chunkError;
      if (input.signal.aborted) {
        log.info({ err }, 'claude executor aborted by signal');
        const aborted = new Error('claude executor aborted');
        aborted.name = 'AbortError';
        throw aborted;
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

    // Defensive: if the SDK silently stopped iterating due to abort (no throw),
    // surface an AbortError rather than letting parse fail with a confusing message.
    if (input.signal.aborted) {
      const aborted = new Error('claude executor aborted');
      aborted.name = 'AbortError';
      throw aborted;
    }

    // Parse first: if the model produced a complete narrative before the SDK
    // emitted a non-success result (e.g. error_max_turns on cleanup), we still
    // return the usable review. Only fall back to ProcessError when parse fails.
    const parsed = parseNarrativeReview(raw, hunkIndex);
    if (!parsed.ok) {
      if (resultError) {
        throw new ExecutorProcessError(resultError, '', null, raw);
      }
      throw new ExecutorParseError(parsed.error, raw);
    }

    return { review: parsed.data, wasTruncated, rawText: raw };
  }
}
