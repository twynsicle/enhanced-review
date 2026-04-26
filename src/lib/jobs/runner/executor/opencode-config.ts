import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { builtInDenyGlobs } from '../prompt/ai-file-filter';

export interface OpencodeConfigInput {
  model: string;
  modelDisplay?: Record<string, string>;
  extraReadDenyGlobs?: readonly string[];
  systemPrompt: string;
}

interface PermissionRule {
  permission: 'read' | 'write' | 'bash';
  action: 'allow' | 'ask' | 'deny';
  pattern: string;
}

function buildPermissionRules(extra: readonly string[] = []): PermissionRule[] {
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
  configPath: string;
  agentsPath: string;
}

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
