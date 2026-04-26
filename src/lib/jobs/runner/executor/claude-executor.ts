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

export type ClaudeQueryFn = typeof query;

export interface ClaudeExecutorDeps {
  queryFn?: ClaudeQueryFn;
  env?: NodeJS.ProcessEnv;
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

    const queryFn = this.deps.queryFn ?? query;
    const env = this.deps.env ?? process.env;

    const log = logger.child({ executor: 'claude' });

    const options: Options = {
      cwd: input.cloneDir,
      model: input.model,
      systemPrompt: system + FILESYSTEM_BOUNDARY,
      tools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
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
        log.error({ err }, 'claude executor aborted by signal');
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

    if (resultError) {
      throw new ExecutorProcessError(resultError, '', null, raw);
    }

    const parsed = parseNarrativeReview(raw, hunkIndex);
    if (!parsed.ok) {
      throw new ExecutorParseError(parsed.error, raw);
    }

    return { review: parsed.data, wasTruncated, rawText: raw };
  }
}
