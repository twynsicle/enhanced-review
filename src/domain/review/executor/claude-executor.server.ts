import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../../common/logger.ts';
import { pickHostEnv } from '../../../config/host-env.ts';
import {
  fatalFindings,
  finding,
  passedAfterRetry,
  runStoppedEarly,
  type Finding,
} from '../findings.ts';
import { SERVER_WORKING_TREE } from '../prompt/instructions.ts';
import { buildNarrativePrompt } from '../prompt/narrative-prompt.ts';
import { validateReview } from '../validate-review.ts';
import { howItEnded, runSdkLoop } from './sdk-loop.server.ts';
import { MAX_VALIDATION_RETRIES, validationStopHook } from './validation-stop-hook.server.ts';
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

/**
 * Measured on the local CLI, which shares this prompt: an 88-file, 138-hunk
 * review took 32 turns, so this leaves a change about twice that size room to
 * finish. Room matters more than it looks: a run that ends on `error_max_turns`
 * fails the review outright, and every refused stop costs another full
 * re-emission of the block on top of the reading.
 */
const MAX_TURNS = 60;
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

export class ClaudeExecutor implements ReviewExecutor {
  readonly name = 'claude';
  readonly #deps: ClaudeExecutorDeps;

  constructor(deps: ClaudeExecutorDeps = {}) {
    this.#deps = deps;
  }

  async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
    if (input.signal.aborted) throw abortError('claude run aborted before start');

    const { system, user, wasTruncated, catalog, grounding } = buildNarrativePrompt(input.prData);

    const abortController = new AbortController();
    input.signal.addEventListener('abort', () => abortController.abort(), { once: true });

    const queryFn = this.#deps.queryFn ?? query;
    const env = this.#deps.env ?? pickHostEnv(CLAUDE_ENV_KEYS);
    const log = logger.child({ job_id: input.jobId, executor: this.name });

    // The executor keeps its own copy of what the model has said: the loop
    // accumulates privately, and the Stop hook has to grade an answer that is
    // still being written.
    const said: string[] = [];
    let retries = 0;
    const onText = (text: string): void => {
      said.push(text);
      input.onChunk?.(text);
    };

    const options: Options = {
      cwd: input.cloneDir,
      model: input.model,
      systemPrompt: system + SERVER_WORKING_TREE,
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
      hooks: {
        Stop: [
          validationStopHook({
            grounding,
            maxRetries: MAX_VALIDATION_RETRIES,
            text: () => said.join(''),
            onBlock: (attempt, reason) => {
              retries = attempt;
              log.warn({ attempt, reason }, 'review validation blocked stop');
            },
            onError: (err) => {
              log.error({ err }, 'review validation hook failed');
            },
          }),
        ],
      },
      env,
    };

    const outcome = await runSdkLoop(queryFn, { prompt: user, options }, { onText });
    const raw = outcome.raw;
    const ended = howItEnded(outcome.result);

    if (outcome.callbackError) throw outcome.callbackError;
    if (outcome.sdkError) {
      const err = outcome.sdkError;
      if (input.signal.aborted) {
        log.info({ err }, 'claude executor aborted by signal');
        throw abortError('claude executor aborted');
      }
      log.error({ err }, 'claude SDK error');
      throw new ExecutorProcessError(err.message, '', null, raw);
    }
    // The SDK may stop iterating on abort without throwing; report the abort,
    // not a confusing parse failure.
    if (input.signal.aborted) throw abortError('claude executor aborted');

    const validation = validateReview(raw, grounding);
    const findings: Finding[] = [...validation.findings];
    if (wasTruncated) {
      findings.push(
        finding(
          'diff-truncated',
          'The diff was too large for the prompt, so part of the change was never shown to the reviewer.',
        ),
      );
    }
    // A run that ended on anything but a clean success reviewed less than it
    // was asked to, whatever its answer looks like: the turns it never took
    // are files it never read, and a review that reads well on half the
    // change is the most misleading thing this can produce.
    if (ended !== null) findings.push(runStoppedEarly(ended));

    const fatal = fatalFindings(findings);
    if (fatal.length > 0) {
      // The thrown message is one sentence and the job's error column holds
      // 500 characters, so the whole list goes to the log first: whoever looks
      // at why a job errored sees everything the answer was judged on.
      log.error({ findings, ended }, 'review validation failed');
      // How the run ended outranks what it said: a run cut short stays a
      // process error even when the text it managed to emit parsed.
      if (ended !== null) {
        throw new ExecutorProcessError(`claude SDK result: ${ended}`, '', null, raw);
      }
      throw new ExecutorParseError(fatal[0]!.message, raw);
    }
    if (!validation.review) {
      // Unreachable: an answer that did not parse carries a fatal finding.
      throw new ExecutorParseError('The answer was not a usable review.', raw);
    }
    if (retries > 0) findings.push(passedAfterRetry(retries));
    return { review: validation.review, rawText: raw, hunks: catalog, findings };
  }
}
