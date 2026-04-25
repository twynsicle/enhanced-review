import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { builtInDenyGlobs } from '../prompt/ai-file-filter';

/**
 * Generate the opencode.json and AGENTS.md files inside the clone dir
 * before invoking the agent. The config is what locks opencode into
 * read-only filesystem behaviour and routes inference at opencode-zen.
 */

export interface OpencodeConfigInput {
  /** Default model id, e.g. `opencode-zen/glm-4.7`. Used as opencode.json's top-level model. */
  model: string;
  /** Model-name display map keyed by short id. */
  modelDisplay?: Record<string, string>;
  /** Extra glob patterns to deny read on (user-supplied filter patterns). */
  extraReadDenyGlobs?: readonly string[];
  /** The full system prompt. Written into AGENTS.md so opencode picks it up. */
  systemPrompt: string;
}

interface PermissionRule {
  permission: 'read' | 'write' | 'bash';
  action: 'allow' | 'ask' | 'deny';
  pattern: string;
}

function buildPermissionRules(extra: readonly string[] = []): PermissionRule[] {
  // Order matters in opencode's rule matcher: the first matching rule wins.
  // Put the deny patterns first, then a catch-all allow on read, then a
  // catch-all deny on write/bash.
  const denyGlobs = [...builtInDenyGlobs(), ...extra];
  const rules: PermissionRule[] = [];
  for (const pattern of denyGlobs) {
    rules.push({ permission: 'read', action: 'deny', pattern });
  }
  rules.push({ permission: 'read', action: 'allow', pattern: '**/*' });
  rules.push({ permission: 'write', action: 'deny', pattern: '**' });
  rules.push({ permission: 'bash', action: 'deny', pattern: '*' });
  return rules;
}

export interface BuiltConfig {
  /** Path of the opencode.json file written to disk. */
  configPath: string;
  /** Path of the AGENTS.md file written to disk. */
  agentsPath: string;
}

/** Pure builder so tests can assert the exact JSON shape without writing files. */
export function buildOpencodeConfig(input: OpencodeConfigInput): {
  config: Record<string, unknown>;
  agentsMd: string;
} {
  const [providerId] = input.model.split('/');
  const modelShortId = input.model.slice((providerId?.length ?? 0) + 1);

  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    model: input.model,
    permission: { rules: buildPermissionRules(input.extraReadDenyGlobs) },
    provider: {
      'opencode-zen': {
        npm: '@ai-sdk/openai-compatible',
        name: 'Opencode Zen',
        options: {
          baseURL: 'https://opencode.ai/zen/v1',
          apiKey: '{env:OPENCODE_ZEN_API_KEY}',
        },
        models: {
          [modelShortId]: {
            name: input.modelDisplay?.[modelShortId] ?? modelShortId,
          },
        },
      },
    },
  };

  // AGENTS.md carries the narrative-review system prompt plus a short
  // advisory about excluded files. The config above already enforces the
  // read-deny rules; this is the belt to that suspenders.
  const advisoryGlobs = [...builtInDenyGlobs(), ...(input.extraReadDenyGlobs ?? [])];
  const agentsMd = `# Diffy Review Agent

${input.systemPrompt}

---

## Filesystem boundaries

You are running inside a freshly cloned working tree. The user's diff is
provided in the prompt — that is your primary input. You may use read-only
tools to look up surrounding context if needed, but do not attempt to
write, run shell commands, or modify any file.

The following file patterns are excluded from review and may not be useful
context (the host has already removed them from the diff):

${advisoryGlobs.map((g) => `- \`${g}\``).join('\n')}
`;

  return { config, agentsMd };
}

export async function writeOpencodeConfig(
  cloneDir: string,
  input: OpencodeConfigInput,
): Promise<BuiltConfig> {
  const { config, agentsMd } = buildOpencodeConfig(input);
  const configPath = path.join(cloneDir, 'opencode.json');
  const agentsPath = path.join(cloneDir, 'AGENTS.md');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  await writeFile(agentsPath, agentsMd, 'utf-8');
  return { configPath, agentsPath };
}
