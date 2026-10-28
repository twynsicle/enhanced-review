import { createServer } from 'node:http';
import { loadConfig } from './config.ts';
import { fetchFeed } from './feed/client.ts';
import { log, setLevel } from './logger.ts';
import { reconcile, type Warehouse } from './sync/reconcile.ts';
import { summarise, type SyncReport } from './sync/report.ts';
import { newTraceId } from './sync/trace.ts';
import { renderStatus } from './web/status.ts';
import { openWarehouse } from './warehouse.ts';

const INTERVAL_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  setLevel(config.logLevel);
  const warehouse: Warehouse = await openWarehouse();
  let lastRun: Date | null = null;
  let report: SyncReport | null = null;

  const run = async () => {
    const trace = newTraceId();
    log.info('sync started', { trace });
    try {
      const feed = await fetchFeed(config, trace);
      const result = await reconcile(feed.rows, warehouse, config.batchSize, trace);
      report = summarise(result);
      lastRun = feed.fetchedAt;
      log.info('sync finished', { trace, changed: report.changed, unknown: report.unknown });
    } catch (error) {
      log.error('sync failed', { trace, message: (error as Error).message });
    }
  };

  createServer((_, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(renderStatus({ locale: config.locale, lastRun, report }, new Date()));
  }).listen(8080);

  await run();
  setInterval(() => void run(), INTERVAL_MS);
}

main().catch((error: unknown) => {
  log.error('fatal', { message: (error as Error).message });
  process.exit(1);
});
