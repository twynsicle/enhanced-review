import type { HunkTier } from '../review/narrative.ts';

/**
 * The model's answer to the skim prompt, read strictly. The review's parser
 * is lenient toward the model — a missing tier is read as `read` — because a
 * review has to ship; an eval has to count, so anything short of a clear tier
 * is a problem on the record and no tier at all.
 */
export interface TierAnswer {
  id: string;
  tier: HunkTier;
  skimReason?: string;
}

export interface ParsedAnswer {
  tiers: Map<string, TierAnswer>;
  /** Everything that was not a clean tier, one line each. */
  problems: string[];
}

const OPEN = '<hunk_tiers>';
const CLOSE = '</hunk_tiers>';

export function parseTierAnswer(text: string): ParsedAnswer {
  const tiers = new Map<string, TierAnswer>();
  const problems: string[] = [];
  const start = text.lastIndexOf(OPEN);
  const end = start < 0 ? -1 : text.indexOf(CLOSE, start + OPEN.length);
  if (start < 0 || end < 0) {
    return { tiers, problems: [`no ${OPEN} block in the answer`] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start + OPEN.length, end));
  } catch (error) {
    return { tiers, problems: [`the block is not JSON: ${(error as Error).message}`] };
  }
  const hunks =
    typeof value === 'object' && value !== null && 'hunks' in value ? value.hunks : undefined;
  if (!Array.isArray(hunks)) return { tiers, problems: ['the block has no "hunks" array'] };

  for (const [index, entry] of hunks.entries()) {
    const where = `hunks[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`${where} is not an object`);
      continue;
    }
    const fields = entry as Record<string, unknown>;
    const id = fields.id;
    if (typeof id !== 'string' || !/^H\d{4,}$/.test(id)) {
      problems.push(`${where} has no hunk id`);
      continue;
    }
    if (tiers.has(id)) {
      problems.push(`${id} is tiered twice; the first kept`);
      continue;
    }
    const tier = fields.tier;
    if (tier !== 'read' && tier !== 'skim') {
      problems.push(`${id} has tier ${JSON.stringify(tier)}, not read or skim`);
      continue;
    }
    const reason = fields.skimReason;
    const skimReason =
      typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : undefined;
    if (tier === 'read' && skimReason !== undefined)
      problems.push(`${id} is read with a skim reason`);
    if (tier === 'skim' && skimReason === undefined) problems.push(`${id} is skim with no reason`);
    tiers.set(id, { id, tier, ...(tier === 'skim' && skimReason ? { skimReason } : {}) });
  }
  return { tiers, problems };
}
