import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { REPO_ROOT, isTestFile, listFiles, readSource, report, toPosix } from './helpers.ts';

/**
 * Guardrail — the review prompt names nothing from the systems the evals are
 * built on. An eval measures the prompt only while the prompt was not written
 * against its cases: an example lifted from one ("Retry sweep", `POST /orders`)
 * hands the model that case's answer, lifts its score, and says nothing about
 * a real pull request. Examples belong to a domain no eval case uses.
 *
 * The terms come from the evals themselves, so a new branch widens the check
 * with nothing to remember: every folder and file under a contrived `src/`,
 * every exported name with a capital inside it (a lowercase one is an English
 * word as often as a name) that this repository does not declare itself (an
 * `isRecord` is an idiom, not the case's), and every route literal. What extraction cannot
 * see, the systems' own names and the nouns of their domain, each eval lists
 * in its `vocabulary.json`, kept beside its branches and never in a tree the
 * model reads. A shape fitted to one case ("a backoff names its steps") has no
 * word to catch; that stays a reviewer's call.
 */
const PROMPT_SOURCES = ['src/review/prompt/*.ts', 'src/cli/prompt.ts'];
const EVALS = ['evals/diagrams', 'evals/skims'];

const VocabularySchema = z.object({ names: z.array(z.string()), nouns: z.array(z.string()) });

type Term = { term: string; pattern: RegExp; from: string };

const DECLARED = /\b(?:function|const|let|class|interface|type)\s+(\w+)/g;

const OWN_NAMES = new Set(
  listFiles(['src/**/*.{ts,tsx}']).flatMap((file) =>
    [...readSource(file).matchAll(DECLARED)].map((match) => match[1]!),
  ),
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordPattern(word: string, suffix = '', flags = ''): RegExp {
  return new RegExp(`\\b${escape(word)}${suffix}\\b`, flags);
}

function contrivedSources(evalDir: string): string[] {
  return globSync(`${evalDir}/contrived/*/{,files/}src/**/*`, { cwd: REPO_ROOT }).map(toPosix);
}

function termsOf(evalDir: string): Term[] {
  const from = `${evalDir}/vocabulary.json`;
  const vocabulary = VocabularySchema.parse(JSON.parse(readSource(from)));
  const terms: Term[] = [
    ...vocabulary.names.map((name) => ({ term: name, pattern: wordPattern(name, '', 'i'), from })),
    ...vocabulary.nouns.map((noun) => ({
      term: noun,
      pattern: wordPattern(noun, 's?', 'i'),
      from,
    })),
  ];
  for (const file of contrivedSources(evalDir)) {
    const inTree = file.replace(/^.*?\/contrived\/[^/]+\/(?:files\/)?/, '');
    const isFolder = !/\.[a-z]+$/.test(inTree);
    if (inTree.includes('/')) {
      const path = isFolder ? `${inTree}/` : inTree;
      terms.push({ term: path, pattern: new RegExp(escape(path)), from: file });
    }
    if (!file.endsWith('.ts')) continue;
    const source = readSource(file);
    const exported = /\bexport\s+(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)/g;
    for (const [, name] of source.matchAll(exported)) {
      if (/[a-z][A-Z]/.test(name!) && !OWN_NAMES.has(name!))
        terms.push({ term: name!, pattern: wordPattern(name!), from: file });
    }
    for (const [, route] of source.matchAll(/['"`](\/[a-z][\w\-/:{}]*)['"`]/g)) {
      terms.push({ term: route!, pattern: new RegExp(`${escape(route!)}(?![\\w/])`), from: file });
    }
  }
  return terms;
}

const TERMS = EVALS.flatMap(termsOf);

// Two model systems give hundreds of terms; well under that means the globs
// above stopped finding the trees and the check went quiet.
const MIN_TERMS = 100;

describe('guardrail: eval vocabulary', () => {
  it('the review prompt names nothing from an eval case', () => {
    const violations = listFiles(PROMPT_SOURCES)
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readSource(file)
          .split('\n')
          .flatMap((line, index) =>
            // One report a term, though several branches carry the same file.
            [
              ...new Map(TERMS.filter(({ pattern }) => pattern.test(line)).map((t) => [t.term, t])),
            ].map(
              ([, { term, from }]) =>
                `${file}:${index + 1} says "${term}", from ${from}: ` +
                `take the example from a domain no eval case uses`,
            ),
          ),
      );
    expect(report(violations)).toBe('');
  });

  it('still finds terms to check', () => {
    expect(TERMS.length).toBeGreaterThanOrEqual(MIN_TERMS);
  });
});
