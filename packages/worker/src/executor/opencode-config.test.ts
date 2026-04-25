import { describe, expect, it } from 'vitest';

import { buildOpencodeConfig } from './opencode-config';

describe('buildOpencodeConfig', () => {
  it('emits an opencode.json with deny-first permission rules and the model registered under opencode-zen', () => {
    const { config } = buildOpencodeConfig({
      model: 'opencode-zen/glm-4.7',
      systemPrompt: 'PROMPT',
    });

    expect(config['$schema']).toBe('https://opencode.ai/config.json');
    expect(config.model).toBe('opencode-zen/glm-4.7');

    const permission = config.permission as { rules: { permission: string; action: string; pattern: string }[] };
    const rules = permission.rules;
    // Deny-on-read rules must come before the catch-all read allow.
    const firstAllowReadIdx = rules.findIndex((r) => r.permission === 'read' && r.action === 'allow');
    const denyReads = rules.filter((r, i) => r.permission === 'read' && r.action === 'deny' && i < firstAllowReadIdx);
    expect(denyReads.length).toBeGreaterThan(0);
    expect(rules.find((r) => r.permission === 'write' && r.action === 'deny')).toBeDefined();
    expect(rules.find((r) => r.permission === 'bash' && r.action === 'deny')).toBeDefined();

    const provider = config.provider as Record<string, { options: { baseURL: string; apiKey: string }; models: Record<string, unknown> }>;
    expect(provider['opencode-zen']?.options.baseURL).toBe('https://opencode.ai/zen/v1');
    expect(provider['opencode-zen']?.options.apiKey).toBe('{env:OPENCODE_ZEN_API_KEY}');
    expect(provider['opencode-zen']?.models['glm-4.7']).toBeDefined();
  });

  it('includes user-supplied extra deny globs ahead of the catch-all read allow', () => {
    const { config } = buildOpencodeConfig({
      model: 'opencode-zen/glm-4.7',
      systemPrompt: '',
      extraReadDenyGlobs: ['**/secrets/**', '**/*.env'],
    });
    const rules = (config.permission as { rules: { pattern: string; action: string; permission: string }[] }).rules;
    const allowReadIdx = rules.findIndex((r) => r.permission === 'read' && r.action === 'allow');
    expect(rules.slice(0, allowReadIdx).some((r) => r.pattern === '**/secrets/**')).toBe(true);
    expect(rules.slice(0, allowReadIdx).some((r) => r.pattern === '**/*.env')).toBe(true);
  });

  it('embeds the system prompt and a filesystem advisory in AGENTS.md', () => {
    const { agentsMd } = buildOpencodeConfig({
      model: 'opencode-zen/glm-4.7',
      systemPrompt: 'CUSTOM_SYSTEM_PROMPT_X',
    });
    expect(agentsMd).toContain('CUSTOM_SYSTEM_PROMPT_X');
    expect(agentsMd).toContain('Filesystem boundaries');
    expect(agentsMd).toContain('package-lock.json');
  });
});
