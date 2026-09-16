import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../../common/logger.ts';
import { plural } from '../../../common/plural.ts';
import { pickHostEnv } from '../../../config/host-env.ts';
import { fatalFindings, finding, type Finding } from '../findings.ts';
import { SERVER_WORKING_TREE } from '../prompt/instructions.ts';
import { buildNarrativePrompt } from '../prompt/narrative-prompt.ts';
import { validateReview } from '../validate-review.ts';
import { runSdkLoop, type SdkRunResult } from './sdk-loop.server.ts';
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

/**
 * How the run ended, when that was not a clean success; null when it was.
 *
 * No result at all counts as ending badly. The SDK sends one for every way a
 * run can finish, including running out of turns, so a stream that stops
 * without one stopped for a reason nobody recorded — and taking that for a
 * clean success would ship the answer of a run that was cut off.
 */
function howItEnded(result: SdkRunResult | null): string | null {
  if (!result) return 'no result';
  if (result.subtype !== 'success') return result.subtype;
  return result.isError ? 'error' : null;
}

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
    if (ended !== null) {
      findings.push(
        finding(
          'run-stopped-early',
          `The run did not finish cleanly (${ended}), so the reviewer stopped short of the change.`,
        ),
      );
    }

    const fatal = fatalFindings(findings);
    const lastFatal = fatal.at(-1);
    if (lastFatal) {
      // How the run ended outranks what it said: a run cut short stays a
      // process error even when the text it managed to emit parsed.
      if (ended !== null) {
        throw new ExecutorProcessError(`claude SDK result: ${ended}`, '', null, raw);
      }
      throw new ExecutorParseError(lastFatal.message, raw);
    }
    if (!validation.review) {
      // Unreachable: an answer that did not parse carries a fatal finding.
      throw new ExecutorParseError('The answer was not a usable review.', raw);
    }
    if (retries > 0) {
      findings.push(
        finding(
          'passed-after-retry',
          `The reviewer's first answer was disqualified; this review is what it sent after ${plural(retries, 'further attempt')}.`,
        ),
      );
    }
    return { review: validation.review, rawText: raw, hunks: catalog, findings };
  }
}
