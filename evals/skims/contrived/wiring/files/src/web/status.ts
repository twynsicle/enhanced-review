import { t } from '../i18n/index.ts';
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
  const lines = [
    `<h1>${t(locale, 'status.title')}</h1>`,
    `<p class="${stale ? 'stale' : 'ok'}">${t(locale, stale ? 'status.stale' : 'status.ok')}</p>`,
    `<dl><dt>${t(locale, 'status.lastRun')}</dt><dd>${
      view.lastRun ? view.lastRun.toISOString() : t(locale, 'status.never')
    }</dd></dl>`,
  ];
  if (view.report) {
    if (view.report.depot !== null) {
      lines.push(`<p>${t(locale, 'status.depot')}: ${view.report.depot}</p>`);
    }
    lines.push(
      '<ul>',
      `<li>${t(locale, 'status.changed', { count: view.report.changed })}</li>`,
      `<li>${t(locale, 'status.unchanged', { count: view.report.unchanged })}</li>`,
      `<li>${t(locale, 'status.unknown', { count: view.report.unknown })}</li>`,
      '</ul>',
    );
  }
  return lines.join('\n');
}
