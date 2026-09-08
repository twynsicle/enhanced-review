import { describe, expect, it } from 'vitest';
import { extractChapterTitles } from './partial-narrative-parse.ts';

const PRE = '<narrative_review>{"prTitle":"Test","overviewSummary":"sum","chapters":[';

describe('extractChapterTitles', () => {
  it('returns empty for the empty buffer', () => {
    expect(extractChapterTitles('')).toEqual({ titles: [], inProgressTitle: null });
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
