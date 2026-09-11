import { describe, expect, it } from 'vitest';
import { extractChapterTitles } from './partial-narrative-parse.ts';

const PRE = '<narrative_review>{"prTitle":"Test","overviewSummary":"sum","chapters":[';

describe('extractChapterTitles', () => {
  it('returns empty for the empty buffer', () => {
    expect(extractChapterTitles('')).toEqual({ titles: [], inProgressTitle: null });
  });

  it('does not count a chapter diagram title as a chapter', () => {
    // Same shape as the insight-title overcount this scanner was rewritten
    // for: a diagram carries its own `title`, one level deeper than a
    // chapter's, and must not appear in the checklist.
    const buffer = `${PRE}{"id":"one","title":"Real Chapter","diagram":{"id":"d","title":"Not A Chapter","kind":"architecture","caption":"c","nodes":[{"id":"a","label":"A"}],"edges":[]},"insights":[],"diffChunks":[]}]`;
    expect(extractChapterTitles(buffer)).toEqual({
      titles: ['Real Chapter'],
      inProgressTitle: null,
    });
  });

  it('returns empty when chapters key has not appeared yet', () => {
    expect(extractChapterTitles('<narrative_review>{"prTitle":"x","overviewSummary":"y"')).toEqual({
      titles: [],
      inProgressTitle: null,
    });
  });

  it('captures a single completed chapter title', () => {
    const buf = `${PRE}{"id":"c1","title":"Shape of the change","insights":[]}`;
    expect(extractChapterTitles(buf)).toEqual({
      titles: ['Shape of the change'],
      inProgressTitle: null,
    });
  });

  it('captures an in-progress title (no closing quote yet)', () => {
    const buf = `${PRE}{"id":"c1","title":"Shape of `;
    expect(extractChapterTitles(buf)).toEqual({ titles: [], inProgressTitle: 'Shape of ' });
  });

  it('captures multiple completed titles + one in-progress', () => {
    const buf = `${PRE}{"id":"c1","title":"First"},{"id":"c2","title":"Second"},{"id":"c3","title":"Third in pro`;
    expect(extractChapterTitles(buf)).toEqual({
      titles: ['First', 'Second'],
      inProgressTitle: 'Third in pro',
    });
  });

  it('does not count insight titles as chapters', () => {
    // The regression that made a 2-chapter review report "6 chapters": every
    // insight carries an optional title of its own, nested inside the chapter.
    const buf =
      `${PRE}{"id":"c1","title":"First","insights":[` +
      `{"type":"context","title":"An insight headline","text":"t"},` +
      `{"type":"rationale","title":"Another insight","text":"t"}]},` +
      `{"id":"c2","title":"Second","insights":[` +
      `{"type":"highlight","title":"Third insight","text":"t"}]}]`;
    expect(extractChapterTitles(buf)).toEqual({
      titles: ['First', 'Second'],
      inProgressTitle: null,
    });
  });

  it('stops at the end of the chapters array', () => {
    // `files` comes after `chapters` and a later schema addition could put a
    // `title` there too; nothing outside the array may be counted.
    const buf =
      `${PRE}{"id":"c1","title":"Only chapter","insights":[]}],` +
      `"files":[{"filename":"a.ts","title":"not a chapter","status":"modified"}]}`;
    expect(extractChapterTitles(buf)).toEqual({
      titles: ['Only chapter'],
      inProgressTitle: null,
    });
  });

  it('is not confused by braces or quotes inside a chapter string value', () => {
    const buf =
      `${PRE}{"id":"c1","description":"a } brace and a \\"quote\\"","title":"Real title",` +
      `"insights":[{"type":"context","title":"Nested","text":"t"}]}]`;
    expect(extractChapterTitles(buf)).toEqual({
      titles: ['Real title'],
      inProgressTitle: null,
    });
  });

  it('does not pick up the prTitle as a chapter title', () => {
    const buf = `${PRE}{"id":"c1","title":"Real chapter"}`;
    const result = extractChapterTitles(buf);
    expect(result.titles).toEqual(['Real chapter']);
    expect(result.titles).not.toContain('Test');
  });

  it('handles escaped quotes in titles', () => {
    const buf = `${PRE}{"id":"c1","title":"Quoted \\"title\\" inside"}`;
    expect(extractChapterTitles(buf)).toEqual({
      titles: ['Quoted "title" inside'],
      inProgressTitle: null,
    });
  });

  it('handles unicode escape sequences', () => {
    const buf = `${PRE}{"id":"c1","title":"Caf\\u00e9 break"}`;
    expect(extractChapterTitles(buf)).toEqual({ titles: ['Café break'], inProgressTitle: null });
  });

  it('waits for the rest of a unicode escape that is still streaming', () => {
    const buf = `${PRE}{"id":"c1","title":"Caf\\u00`;
    expect(extractChapterTitles(buf)).toEqual({ titles: [], inProgressTitle: 'Caf' });
  });

  it('returns empty on totally malformed garbage with no chapters key', () => {
    expect(extractChapterTitles('!!! not even json $$$')).toEqual({
      titles: [],
      inProgressTitle: null,
    });
  });

  it('treats the chapters key followed by something other than [ as no match', () => {
    expect(extractChapterTitles('<narrative_review>{"chapters": "not an array yet"}')).toEqual({
      titles: [],
      inProgressTitle: null,
    });
  });

  it('survives whitespace between key/colon/[', () => {
    const buf = '<narrative_review>{"chapters" : [ {"id":"c1", "title" : "Whitespace ok"}';
    expect(extractChapterTitles(buf)).toEqual({ titles: ['Whitespace ok'], inProgressTitle: null });
  });

  it('returns the last in-progress title only (older titles already closed)', () => {
    const buf = `${PRE}{"id":"c1","title":"Done","insights":[]},{"id":"c2","title":"Mid`;
    expect(extractChapterTitles(buf)).toEqual({ titles: ['Done'], inProgressTitle: 'Mid' });
  });
});
