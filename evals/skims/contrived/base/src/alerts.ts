import { VERSION } from './config.ts';
import { t } from './i18n/index.ts';
import type { SyncReport } from './sync/report.ts';

export interface Alert {
  subject: string;
  lines: string[];
}

const LARGE_ADJUSTMENT = 1000;

/** What the operations desk is told about a run, or null when nothing is wrong. */
export function alertFor(locale: string, report: SyncReport, feedDownMinutes: number): Alert | null {
  const lines: string[] = [];
  if (feedDownMinutes > 0) {
    lines.push(
      t(locale, 'alert.feedDown', { minutes: feedDownMinutes }),
      t(locale, 'alert.feedDownHint'),
    );
  }
  if (report.unknown > 0) {
    lines.push(
      t(locale, 'alert.unknownSkus', { count: report.unknown }),
      t(locale, 'alert.unknownSkusHint'),
    );
  }
  if (report.largest && report.largest.by >= LARGE_ADJUSTMENT) {
    lines.push(
      t(locale, 'alert.largeAdjustment', report.largest),
      t(locale, 'alert.largeAdjustmentHint'),
    );
  }
  if (lines.length === 0) return null;
  lines.push(t(locale, 'alert.footer', { version: VERSION }));
  return { subject: t(locale, 'alert.subject'), lines };
}
