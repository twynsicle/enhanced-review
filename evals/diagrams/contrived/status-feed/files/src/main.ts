import { loadConfig, VERSION } from './config.ts';
import { withStatusFeed } from './feed/status-feed.ts';
import { statusHandler } from './feed/status-job.ts';
import { ShelfwiseWarehouse } from './feed/warehouse.ts';
import { orderRoutes } from './http/routes/orders.ts';
import { webhookRoutes } from './http/routes/webhooks.ts';
import { createHttpServer } from './http/server.ts';
import { errorFields, log } from './logger.ts';
import { RelayMailer } from './notify/email.ts';
import { CardflowGateway } from './payments/cardflow.ts';
import { MemoryQueue } from './queue/queue.ts';
import { startScheduler } from './scheduler/scheduler.ts';
import { abandonedOrders, stuckShipments } from './scheduler/sweeps.ts';
import { ParcelnetCarrier } from './shipping/parcelnet.ts';
import { migrate } from './store/migrate.ts';
import { openStore } from './store/store.ts';
import { emailHandler } from './worker/email.ts';
import { packHandler } from './worker/pack.ts';
import { shipHandler } from './worker/ship.ts';
import { startWorker } from './worker/worker.ts';

const WORKER_IDLE_MS = 250;

const clock = (): Date => new Date();

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const queue = new MemoryQueue();
  const orders = openStore();
  await migrate(orders);
  const store = withStatusFeed(orders, queue);
  const { gatewayUrl, gatewayKey, gatewayTimeoutMs } = config;
  const gateway = new CardflowGateway(gatewayUrl, gatewayKey, gatewayTimeoutMs);
  const carrier = new ParcelnetCarrier(config.carrierUrl, config.carrierTimeoutMs);
  const mailer = new RelayMailer(config.mailerUrl, config.mailFrom, config.mailerTimeoutMs);
  const { warehouseUrl, warehouseKey, warehouseTimeoutMs } = config;
  const warehouse = new ShelfwiseWarehouse(warehouseUrl, warehouseKey, warehouseTimeoutMs);

  const server = createHttpServer([
    ...orderRoutes(config.apiKey, { store, gateway, queue, clock }),
    ...webhookRoutes(config.gatewayWebhookSecret, store, clock),
  ]);
  server.listen(config.port, () => log.info('listening', { port: config.port, version: VERSION }));

  const worker = startWorker(
    queue,
    {
      pack: packHandler({ store, queue, clock }),
      ship: shipHandler({ store, queue, carrier, clock }),
      email: emailHandler({ store, mailer }),
      status: statusHandler({ warehouse }),
    },
    WORKER_IDLE_MS,
  );

  const scheduler = startScheduler(
    [
      {
        name: 'abandoned-orders',
        intervalMs: config.abandonedSweepMs,
        run: (now) => abandonedOrders(store, now),
      },
      {
        name: 'stuck-shipments',
        intervalMs: config.stuckSweepMs,
        run: (now) => stuckShipments(store, queue, now),
      },
    ],
    clock,
  );

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    scheduler.stop();
    server.close();
    await worker.stop();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  log.error('fatal', errorFields(error));
  process.exit(1);
});
