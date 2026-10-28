import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SyncReport } from '../sync/report.ts';
import { renderStatus } from './status.ts';

const report: SyncReport = {
  changed: 1234,
  unchanged: 5,
  unknown: 0,
  largest: { sku: 'A1', depot: 'north', by: 1200 },
  byDepot: [
    { depot: 'north', changed: 1200 },
    { depot: 'south', changed: 34 },
  ],
};

const now = new Date('2024-06-01T12:00:00Z');

describe('renderStatus', () => {
  it('lists each depot and names the largest adjustment', () => {
    const html = renderStatus({ locale: 'en', lastRun: now, report }, now);
    assert.match(html, /<h2>By depot<\/h2>/);
    assert.match(html, /<li>north: 1,200 changed<\/li>/);
    assert.match(html, /Largest adjustment: A1 at north, by 1,200/);
  });

  it('formats counts for the locale', () => {
    const html = renderStatus({ locale: 'de', lastRun: now, report }, now);
    assert.match(html, /1\.234 Artikel geändert/);
  });

  it('says so when a run made no adjustments', () => {
    const html = renderStatus(
      { locale: 'fr', lastRun: now, report: { ...report, largest: null, byDepot: [] } },
      now,
    );
    assert.match(html, /Aucun ajustement/);
    assert.doesNotMatch(html, /<h2>/);
  });
});
