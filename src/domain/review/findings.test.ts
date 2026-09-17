import { describe, expect, it } from 'vitest';
import {
  countBySeverity,
  fatalFindings,
  finding,
  findingLog,
  FindingSchema,
  FINDING_SEVERITY,
  passedAfterRetry,
  runStoppedEarly,
  type FindingCode,
  type FindingSeverity,
} from './findings.ts';

/**
 * The policy, spelled out a second time. Duplicating the table is the point:
 * a severity that changes has to be changed here too, by someone who has read
 * what the tier means, rather than slipping through as a one-word edit.
 */
const EXPECTED: Record<FindingCode, FindingSeverity> = {
  'answer-missing-block': 'fatal',
  'answer-unparseable': 'fatal',
  'answer-invalid': 'fatal',
  'fields-missing': 'fatal',
  'chapter-no-hunks': 'fatal',
  'hunk-uncited': 'fatal',
  'run-stopped-early': 'fatal',
  'risk-dropped': 'warning',
  'diagram-dropped': 'warning',
  'insight-anchor-dropped': 'warning',
  'diff-truncated': 'warning',
  'commands-refused': 'warning',
  'passed-after-retry': 'warning',
  'chapter-id-synthesised': 'note',
  'chapter-title-synthesised': 'note',
  'prose-promoted': 'note',
  'prose-dropped': 'note',
  'chunk-dropped': 'note',
  'json-quote-repaired': 'note',
  'chunks-merged': 'note',
  'insight-type-unknown': 'note',
  'insight-dropped': 'note',
  'diagram-part-dropped': 'note',
  'hunk-id-dropped': 'note',
  'risk-part-dropped': 'note',
};

describe('the finding table', () => {
  it('gives every code exactly the severity the policy says', () => {
    expect(FINDING_SEVERITY).toEqual(EXPECTED);
  });

  it('stamps a finding with the severity its code carries', () => {
    expect(finding('hunk-uncited', 'x')).toEqual({
      code: 'hunk-uncited',
      severity: 'fatal',
      message: 'x',
    });
    expect(finding('chunks-merged', 'x').severity).toBe('note');
  });

  it('keeps the location it was given', () => {
    expect(
      finding('hunk-id-dropped', 'x', { chapterId: 'c', filename: 'a.ts', hunkIds: ['H0001'] }),
    ).toMatchObject({ chapterId: 'c', filename: 'a.ts', hunkIds: ['H0001'] });
  });

  it('parses back from storage, and refuses a code it does not know', () => {
    const stored: unknown = JSON.parse(JSON.stringify(finding('diff-truncated', 'cut short')));
    expect(FindingSchema.parse(stored)).toEqual(finding('diff-truncated', 'cut short'));
    expect(
      FindingSchema.safeParse({ code: 'invented', severity: 'fatal', message: 'x' }).success,
    ).toBe(false);
  });
});

describe('a log of findings', () => {
  it('returns what it recorded, in the order it was recorded', () => {
    const log = findingLog();
    const first = log.add('chunks-merged', 'one');
    log.add('hunk-uncited', 'two');
    expect(first).toEqual(finding('chunks-merged', 'one'));
    expect(log.findings.map((f) => f.message)).toEqual(['one', 'two']);
  });

  it('separates the disqualifying findings from the rest', () => {
    const findings = [
      finding('chunks-merged', 'a note'),
      finding('hunk-uncited', 'a hole'),
      finding('diff-truncated', 'a warning'),
      finding('chapter-no-hunks', 'another hole'),
    ];
    expect(fatalFindings(findings).map((f) => f.message)).toEqual(['a hole', 'another hole']);
    expect(countBySeverity(findings)).toEqual({ fatal: 2, warning: 1, note: 1 });
    expect(fatalFindings([finding('diff-truncated', 'a warning')])).toEqual([]);
    expect(countBySeverity([])).toEqual({ fatal: 0, warning: 0, note: 0 });
  });
});

describe('what a run earns by how it behaved', () => {
  it('says how it ended, and adds the hint only when there is one', () => {
    expect(runStoppedEarly('error_max_turns')).toEqual(
      finding(
        'run-stopped-early',
        'The run did not finish cleanly (error_max_turns), so the reviewer stopped short of the change.',
      ),
    );
    expect(runStoppedEarly('no result', 'Run it again.').message).toBe(
      'The run did not finish cleanly (no result), so the reviewer stopped short of the change. Run it again.',
    );
  });

  it('counts the attempts a passing answer took', () => {
    expect(passedAfterRetry(1).message).toContain('after 1 further attempt.');
    expect(passedAfterRetry(2).message).toContain('after 2 further attempts.');
    expect(passedAfterRetry(2).severity).toBe('warning');
  });
});
