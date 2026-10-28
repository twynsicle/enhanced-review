import { formatCount, t } from '../i18n/index.ts';
import type { SyncReport } from '../sync/report.ts';

export interface StatusView {
  locale: string;
  lastRun: Date | null;
  report: SyncReport | null;
}

const STALE_MS = 60 * 60 * 1000;

export function renderStatus(view: StatusView, now: Date): string {
  const { locale } = view;
  const stale = view.lastRun === null || now.getTime() - view.lastRun.getTime() > STALE_MS;
  const count = (n: number) => formatCount(locale, n);
  const lines = [
    `<h1>${t(locale, 'status.title')}</h1>`,
    `<p class="${stale ? 'stale' : 'ok'}">${t(locale, stale ? 'status.stale' : 'status.ok')}</p>`,
    `<dl><dt>${t(locale, 'status.lastRun')}</dt><dd>${
      view.lastRun ? view.lastRun.toISOString() : t(locale, 'status.never')
    }</dd></dl>`,
  ];
  if (view.report) {
    const { report } = view;
    lines.push(
      '<ul>',
      `<li>${t(locale, 'status.changed', { count: count(report.changed) })}</li>`,
      `<li>${t(locale, 'status.unchanged', { count: count(report.unchanged) })}</li>`,
      `<li>${t(locale, 'status.unknown', { count: count(report.unknown) })}</li>`,
      '</ul>',
      `<p>${
        report.largest
          ? t(locale, 'status.largest', { ...report.largest, by: count(report.largest.by) })
          : t(locale, 'status.largestNone')
      }</p>`,
    );
    if (report.byDepot.length > 0) {
      lines.push(`<h2>${t(locale, 'status.byDepot')}</h2>`, '<ul>');
      for (const { depot, changed } of report.byDepot) {
        lines.push(`<li>${t(locale, 'status.depotRow', { depot, count: count(changed) })}</li>`);
      }
      lines.push('</ul>');
    }
  }
  return lines.join('\n');
}
