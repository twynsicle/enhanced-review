import { describe, expect, it } from 'vitest';
import { buildDiffHunkIndex } from './diff-hunk-catalog.ts';
import { hunkLines, provenFacts, type HunkBody } from './hunk-facts.ts';

let next = 0;
function body(filename: string, removed: string[], added: string[]): HunkBody {
  next += 1;
  return { id: `H${String(next).padStart(4, '0')}`, filename, removed, added };
}

const APPLY_DISCOUNT = [
  'export function applyDiscount(price: number, percent: number): number {',
  '  const cut = price * (percent / 100);',
  '  const rounded = Math.round(cut * 100) / 100;',
  '  const floor = Math.max(0, price - rounded);',
  '  return floor;',
  '}',
];

/** The same body, lifted into a function of another name and indented one level deeper. */
const DISCOUNTED = [
  '  discounted(price: number, percent: number): number {',
  '    const cut = price * (percent / 100);',
  '    const rounded = Math.round(cut * 100) / 100;',
  '    const floor = Math.max(0, price - rounded);',
  '    return floor;',
  '  }',
];

describe('hunkLines', () => {
  it('reads each hunk’s removed and added lines in the order the catalog numbers them', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      ' kept',
      '-old',
      '+new',
      '@@ -10,1 +10,2 @@ (part 1 of 2)',
      '+--not a header',
      '\\ No newline at end of file',
      'diff --git a/src/b.ts b/src/b.ts',
      '@@ -0,0 +1 @@',
      '+fresh',
    ].join('\n');

    expect(hunkLines(diff)).toEqual([
      { removed: ['old'], added: ['new'] },
      { removed: [], added: ['--not a header'] },
      { removed: [], added: ['fresh'] },
    ]);
    expect(hunkLines(diff)).toHaveLength(buildDiffHunkIndex(diff).hunks.length);
  });

  it('counts no hunk before the first file header, as the catalog does', () => {
    expect(hunkLines('@@ -1 +1 @@\n+x\n')).toEqual([]);
  });
});

describe('provenFacts: whitespace only', () => {
  it('marks a hunk whose lines differ only in whitespace, rewrapping included', () => {
    const reindent = body('src/a.ts', ['  return x;'], ['    return x;']);
    const rewrap = body(
      'src/a.ts',
      ['export function pad(s: string): string { return s.padStart(4); }'],
      ['export function pad(s: string): string {', '  return s.padStart(4);', '}', ''],
    );
    const facts = provenFacts([reindent, rewrap]);
    expect(facts.get(reindent.id)).toEqual({ whitespaceOnly: true });
    expect(facts.get(rewrap.id)).toEqual({ whitespaceOnly: true });
  });

  it('treats added or removed blank lines alone as whitespace only', () => {
    const blank = body('src/a.ts', [], ['', '   ']);
    expect(provenFacts([blank]).get(blank.id)).toEqual({ whitespaceOnly: true });
  });

  it('keeps the spacing inside a string literal, which is behaviour', () => {
    const joined = body(
      'src/a.ts',
      ["const csv = names.join(', ');"],
      ["const csv = names.join(',');"],
    );
    const template = body(
      'src/a.ts',
      ['const line = `${a} ${b}`;'],
      ['const line = `${a}  ${b}`;'],
    );
    const facts = provenFacts([joined, template]);
    expect(facts.has(joined.id)).toBe(false);
    expect(facts.has(template.id)).toBe(false);

    // A rewrap that leaves its strings alone is still only whitespace.
    const rewrapped = body(
      'src/a.ts',
      ["log.info('started at', when);"],
      ['log.info(', "  'started at',", '  when);'],
    );
    expect(provenFacts([rewrapped]).get(rewrapped.id)).toEqual({ whitespaceOnly: true });
  });

  it('holds each line to its indentation where indentation is syntax', () => {
    // Out of the `if`: the call now runs every time.
    const dedent = body('src/jobs.py', ['        launch()'], ['    launch()']);
    const yaml = body('deploy.yaml', ['    replicas: 3'], ['  replicas: 3']);
    const recipe = body('Makefile', ['\tnpm test'], ['    npm test']);
    // Spacing within a line, and blank lines, still prove it.
    const spaced = body('src/jobs.py', ['    total = a+b', ''], ['    total = a + b']);
    const facts = provenFacts([dedent, yaml, recipe, spaced]);
    expect(facts.has(dedent.id)).toBe(false);
    expect(facts.has(yaml.id)).toBe(false);
    expect(facts.has(recipe.id)).toBe(false);
    expect(facts.get(spaced.id)).toEqual({ whitespaceOnly: true });
  });

  it('proves nothing about a hunk that changes a character', () => {
    const edit = body('src/a.ts', ['return x;'], ['return y;']);
    const added = body('src/a.ts', [], ['const z = 1;']);
    const facts = provenFacts([edit, added]);
    expect(facts.has(edit.id)).toBe(false);
    expect(facts.has(added.id)).toBe(false);
  });
});

describe('provenFacts: moved', () => {
  it('finds a body lifted into a differently named function in another file, both ways', () => {
    const removing = body('src/billing.ts', ['', ...APPLY_DISCOUNT], []);
    const adding = body('src/pricing.ts', [], DISCOUNTED);
    const facts = provenFacts([removing, adding]);

    // Four of the five significant added lines are the moved body's; the
    // signature is new.
    expect(facts.get(adding.id)).toEqual({
      movedFrom: { filename: 'src/billing.ts', similarity: 80 },
    });
    expect(facts.get(removing.id)).toEqual({
      movedTo: { filename: 'src/pricing.ts', similarity: 80 },
    });
  });

  it('is not fooled by a hunk that wraps the moved body in more new code than it moved', () => {
    const removing = body('src/billing.ts', APPLY_DISCOUNT, []);
    const adding = body(
      'src/pricing.ts',
      [],
      ['export class Pricing {', ...DISCOUNTED, '  readonly currency = "EUR";', '}'],
    );
    expect(provenFacts([removing, adding]).size).toBe(0);
  });

  it('finds a move within one file', () => {
    const removing = body('src/a.ts', APPLY_DISCOUNT, []);
    const adding = body('src/a.ts', [], APPLY_DISCOUNT);
    const facts = provenFacts([removing, adding]);
    expect(facts.get(adding.id)?.movedFrom).toEqual({ filename: 'src/a.ts', similarity: 100 });
    expect(facts.get(removing.id)?.movedTo).toEqual({ filename: 'src/a.ts', similarity: 100 });
  });

  it('wants most of the removed lines found too, so a deletion is not a move of its few survivors', () => {
    const removing = body(
      'src/auth.ts',
      [
        'export function authorise(user: User, resource: Resource): boolean {',
        '  if (!user.active) return false;',
        '  if (user.lockedUntil > clock.now()) return false;',
        '  if (!resource.owners.includes(user.id)) audit.denied(user, resource);',
        '  const grants = permissions.for(user.role);',
        '  const allowed = grants.includes(resource.kind);',
        '  audit.checked(user, resource, allowed);',
        '  return allowed;',
        '}',
      ],
      [],
    );
    const adding = body(
      'src/grants.ts',
      [],
      [
        '  const grants = permissions.for(user.role);',
        '  const allowed = grants.includes(resource.kind);',
        '  audit.checked(user, resource, allowed);',
        '  return allowed;',
      ],
    );
    expect(provenFacts([removing, adding]).size).toBe(0);
  });

  it('moves nothing into or out of a hunk that edits in place', () => {
    const removing = body('src/billing.ts', APPLY_DISCOUNT, []);
    const editing = body(
      'src/pricing.ts',
      ['export const LEGACY_RATES = loadLegacyRates();'],
      APPLY_DISCOUNT,
    );
    const removingAndAdding = body('src/old.ts', APPLY_DISCOUNT, [
      'export { applyDiscount } from "./new";',
    ]);
    const adding = body('src/new.ts', [], APPLY_DISCOUNT);
    expect(provenFacts([removing, editing]).size).toBe(0);
    expect(provenFacts([removingAndAdding, adding]).size).toBe(0);
  });

  it('is never proven by boilerplate alone', () => {
    const closers = [
      '  } else {',
      '    return null;',
      '  </div>',
      '</span>',
      '  try:',
      'finally:',
      'continue;',
    ];
    const removing = body('src/a.tsx', closers, []);
    const adding = body(
      'src/b.tsx',
      [],
      closers.map((line) => `  ${line}`),
    );
    expect(provenFacts([removing, adding]).size).toBe(0);
  });

  it('never matches a hunk against itself', () => {
    // A hunk that removes a block and adds it back reindented is whitespace,
    // not a move from itself.
    const reindent = body(
      'src/a.ts',
      APPLY_DISCOUNT,
      APPLY_DISCOUNT.map((line) => `  ${line}`),
    );
    expect(provenFacts([reindent]).get(reindent.id)).toEqual({ whitespaceOnly: true });
  });

  it('wants most of the added lines found, and at least three', () => {
    const removing = body('src/a.ts', APPLY_DISCOUNT, []);
    // Three found of five significant: 60%, under the share a move needs.
    const diluted = body(
      'src/b.ts',
      [],
      [
        ...APPLY_DISCOUNT.slice(1, 4),
        'const extra = computeSomethingElse();',
        'logger.info(extra);',
      ],
    );
    // Every line found, but only two of them.
    const tiny = body('src/c.ts', [], APPLY_DISCOUNT.slice(1, 3));
    const facts = provenFacts([removing, diluted, tiny]);
    expect([...facts.keys()]).toEqual([]);
  });

  it('matches whitespace-collapsed lines and ignores ones too short or wordless to mean anything', () => {
    const removing = body(
      'src/a.ts',
      [
        'const  total =  sum(items);',
        'const mean = total / items.length;',
        'return mean;',
        '});',
        '});',
      ],
      [],
    );
    // `});` matches but is not significant, so these three lines are all there is.
    const adding = body(
      'src/b.ts',
      [],
      [
        'const total = sum(items);',
        'const  mean = total / items.length;',
        'return mean;',
        '});',
        '});',
        '});',
      ],
    );
    expect(provenFacts([removing, adding]).get(adding.id)?.movedFrom).toEqual({
      filename: 'src/a.ts',
      similarity: 100,
    });
  });

  it('counts lines as a multiset, so a repeated line is found only as often as it was removed', () => {
    const removing = body(
      'src/a.ts',
      ['advance(clock);', 'const finished = clock.done();', 'return finished && ready;'],
      [],
    );
    const adding = body(
      'src/b.ts',
      [],
      [
        'advance(clock);',
        'advance(clock);',
        'advance(clock);',
        'const finished = clock.done();',
        'return finished && ready;',
      ],
    );
    // Three found of five: one `advance(clock);` was removed, not three.
    expect(provenFacts([removing, adding]).has(adding.id)).toBe(false);
  });

  it('takes the source with the most lines in common, and gives it one destination', () => {
    const partial = body('src/old-a.ts', APPLY_DISCOUNT.slice(0, 4), []);
    const whole = body('src/old-b.ts', APPLY_DISCOUNT, []);
    const first = body('src/new-a.ts', [], APPLY_DISCOUNT);
    const copy = body('src/new-b.ts', [], APPLY_DISCOUNT.slice(0, 5));
    const facts = provenFacts([partial, whole, first, copy]);

    expect(facts.get(first.id)?.movedFrom?.filename).toBe('src/old-b.ts');
    expect(facts.get(copy.id)?.movedFrom?.filename).toBe('src/old-b.ts');
    // Both copies came from old-b; it names the one that kept the most of it.
    expect(facts.get(whole.id)?.movedTo?.filename).toBe('src/new-a.ts');
    expect(facts.has(partial.id)).toBe(false);
  });
});
