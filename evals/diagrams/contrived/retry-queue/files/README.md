# packhouse

The order service for the shop. It takes orders over HTTP, captures the
payment, has a worker pack and ship them, books the carrier, emails the
customer at each step, and sweeps up orders that stall along the way. An ops
CLI sits beside it for the warehouse desk.

## Running

```
npm install
API_KEY=... CARDFLOW_URL=https://api.cardflow.example CARDFLOW_KEY=... \
CARDFLOW_WEBHOOK_SECRET=... PARCELNET_URL=https://api.parcelnet.example \
MAILER_URL=https://relay.example npm start
```

Requires Node 22 or later. The store and the queues are in-process today; a
database-backed store and broker-backed queues drop in behind the `Store`,
`Queue` and `RetryQueue` interfaces without touching anything else.

## The parts

**HTTP** (`src/http`). A route table over `node:http`. Each route declares the
middleware it runs through, in order, before its handler: the API key check,
then JSON parsing and error mapping. The storefront creates orders here and
reads them back; the card gateway posts its refund notices to the webhook.

**Orders** (`src/orders`). The order itself, its status machine, address
validation and pricing. An order is `placed`, then `paid` or `cancelled` once
the gateway answers, `packing` once the worker picks it up, and `shipped` once
the carrier has it. Every move goes through `transition`, which refuses one
the table does not allow.

**Payments** (`src/payments`). The gateway behind one `capture` call. Cardflow
is the only implementation; it is given the order id as the merchant
reference so its refund notices can be matched back. A capture the gateway
fails rather than answers leaves the order `placed`, with a retry on the
retry queue (`src/queue/retry.ts`) for the scheduler to make.

**Queue and worker** (`src/queue`, `src/worker`). The worker takes jobs off
the queue one at a time: `pack` moves the order on and queues `ship`, `ship`
books the carrier and queues the shipped email. A job that fails is retried
once, then logged and dropped.

**Shipping** (`src/shipping`). The carrier behind one `book` call. Parcelnet
is the only carrier.

**Notifications** (`src/notify`). The confirmed and shipped emails, sent
through the mail relay.

**Scheduler** (`src/scheduler`). Three sweeps on their own intervals: orders
left `placed` for a day are cancelled, orders left `packing` for two hours
get their `ship` job queued again, and captures the gateway failed are made
again one, five and thirty minutes on, after which the order is cancelled. A
sweep never overlaps its own previous run.

**CLI** (`src/cli`). `packhouse show <id>`, `packhouse reprocess <id>` to
queue an order's next job by hand, and `packhouse stuck` to list what the
sweeps would pick up.

## Configuration

| Variable                  | Default             | Meaning                                             |
| ------------------------- | ------------------- | --------------------------------------------------- |
| `PORT`                    | 8080                | Port the HTTP server listens on                     |
| `API_KEY`                 | —                   | Key the storefront sends in `x-api-key`             |
| `CARDFLOW_URL`            | —                   | Base URL of the card gateway                        |
| `CARDFLOW_KEY`            | —                   | Bearer key for the card gateway                     |
| `CARDFLOW_WEBHOOK_SECRET` | —                   | Shared secret the gateway signs webhook bodies with |
| `CARDFLOW_TIMEOUT_MS`     | 8000                | How long one capture may take                       |
| `PARCELNET_URL`           | —                   | Base URL of the carrier                             |
| `PARCELNET_TIMEOUT_MS`    | 10000               | How long one booking may take                       |
| `MAILER_URL`              | —                   | Base URL of the mail relay                          |
| `MAILER_TIMEOUT_MS`       | 5000                | How long one send may take                          |
| `MAIL_FROM`               | orders@shop.example | Sender address on customer email                    |
| `ABANDONED_SWEEP_MS`      | 600000              | How often placed-but-unpaid orders are cancelled    |
| `STUCK_SWEEP_MS`          | 300000              | How often stalled packing orders are re-queued      |
| `CAPTURE_RETRY_SWEEP_MS`  | 60000               | How often due capture retries are made              |
