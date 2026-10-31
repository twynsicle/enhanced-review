# Diagram evals, phase 1 — the model system and its cases (ER-62)

The first phase of `diagram-evals.md`: a system to review and six changes to
it, each written from the diagram it should produce, with the machinery to
stand them up. No model runs. Deleted when the work lands.

## Done looks like

- `npm run eval:diagrams -- contrive --all` stands every branch up as a
  throwaway repository, runs `er review --stub --no-open` in it, and prints
  the change's size: files, hunks, and the lines added and removed.
- `node --test` passes in the base and on every branch's tree, run by the
  same command, so every branch is coherent code and not a diff that only
  looks like one.
- Every branch's spec parses, its expectations name only kinds the schema
  knows, and nothing a model could read, the spec's prose or the branch's
  files, says what the branch is for.
- `docs/diagram-evals.md` describes the model system, a branch, its
  expectation, and the `contrive` command; `AGENTS.md` and
  `.claude/rules/evals.md` carry the new directory, script and modules.
- The gate passes. The money spent is nil, except one real `er review` of one
  branch by hand at the end, to see that the model system reads as a real
  service before phase 2 sweeps it. That run is looked at, not scored.

## The model system

`evals/diagrams/contrived/base/`: **packhouse**, the order service of a small
merchant. It takes orders over HTTP, captures payment through an external
gateway, hands packing and shipping to a worker through a job queue, books
carriers, emails the customer, and sweeps stuck orders on a schedule, with an
ops CLI beside it. Wide and shallow: around thirty-five TypeScript files of
twenty to eighty lines, with no dependency outside Node, so `node --test`
runs without an install. Every part is thin, and the point of each is the
boundary it sits on.

```
README.md                      what it does, how it runs, its parts in one paragraph each
package.json                   private, ESM, node >=22, scripts start/test/typecheck, no dependencies
CHANGELOG.md
src/main.ts                    boots: config, store, migrations, http, worker, scheduler
src/config.ts                  env → Config (ports, gateway and carrier URLs, sweep intervals)
src/logger.ts
src/store/store.ts             Store interface over orders and shipments; MemoryStore
src/store/migrate.ts           runs migrations in order, records which ran
src/store/migrations/001-orders.ts
src/store/migrations/002-shipments.ts
src/http/server.ts             node:http, a route table, the middleware chain
src/http/middleware/auth.ts    api key header
src/http/middleware/json.ts    body parsing, error → status
src/http/routes/orders.ts      POST /orders, GET /orders/:id
src/http/routes/webhooks.ts    POST /webhooks/payment (phase: exists but the gateway is synchronous today)
src/orders/order.ts            Order, OrderStatus and the allowed transitions; transition() refuses the rest
src/orders/create.ts           validate, price, capture, enqueue pack
src/orders/address.ts          validateAddress: country, postcode shape
src/orders/pricing.ts
src/payments/gateway.ts        PaymentGateway interface: capture → captured | declined
src/payments/cardflow.ts       the external gateway's HTTP adapter
src/queue/queue.ts             Queue interface: enqueue, take, ack; MemoryQueue
src/queue/jobs.ts              Job union: pack, ship, email
src/worker/worker.ts           takes jobs, dispatches to handlers, retries a failed job once
src/worker/pack.ts
src/worker/ship.ts             books the carrier, moves the order to shipped, enqueues email
src/shipping/carrier.ts        Carrier interface: book → tracking number
src/shipping/parcelnet.ts      the one carrier's HTTP adapter
src/notify/email.ts            Mailer interface + SMTP-ish adapter
src/notify/templates.ts        confirmed, shipped
src/scheduler/scheduler.ts     runs sweeps on intervals
src/scheduler/sweeps.ts        abandoned orders → cancelled; stuck shipments → re-enqueued
src/cli/packhouse.ts           ops: show order, reprocess order, list stuck
src/orders/order.test.ts
src/orders/address.test.ts
src/worker/worker.test.ts
src/scheduler/sweeps.test.ts
```

Boundaries the diagrams can draw: three externals (gateway, carrier,
mailer), one data store, two actors (customer over HTTP, ops over the CLI),
and two asynchronous seams (the queue and the scheduler). The status
vocabulary (`placed → paid → packing → shipped`, with `cancelled`) is a state
machine on day one, so a branch that changes it has something to change.

The README describes the parts, as a real service's would. That is fair: a
mechanism map drawn from a README is still a mechanism map, and the eval
measures whether the model draws one, not whether it reverse-engineers it.

## The branches

Each is `evals/diagrams/contrived/<name>/`: `branch.json` and `files/`, the
files the branch changes or adds, whole, laid over the base, as the skim
branches are. Each is written from the diagram it should produce, then
dressed as an ordinary change with an engineer's description, tests, and the
small edits that ride along with real work (a README line, a changelog
entry, a log field), so that the diagram has to be chosen out of a change
and not handed to the model by the change's shape.

| name                 | the picture wanted                        | the change                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `retry-queue`        | an architecture map, most of it unchanged | a capture that fails with a gateway error no longer cancels the order: it goes to a new retry queue with backoff, the scheduler drains it, and a retry that succeeds continues to packing. New `queue/retry.ts` and a sweep; `orders/create.ts`, `scheduler/sweeps.ts`, `config.ts` touched. The gateway, worker, store and customer are untouched and are the map |
| `on-hold`            | a state machine                           | orders gain `on_hold`: entered from `paid` when the address fails a stricter check, left to `packing` by the ops CLI's new `release`, or to `cancelled` by the abandoned sweep after a week. `orders/order.ts`, `orders/address.ts`, `cli/packhouse.ts`, `scheduler/sweeps.ts`, tests                                                                              |
| `async-capture`      | a sequence with three endings             | capture becomes asynchronous: the gateway answers `pending`, the webhook route completes it to `paid` or `cancelled`, and a new sweep cancels a capture that has had no webhook in an hour. `payments/gateway.ts`, `payments/cardflow.ts`, `http/routes/webhooks.ts`, `orders/create.ts`, `scheduler/sweeps.ts`                                                    |
| `address-middleware` | a before-and-after of one path            | address validation moves out of `orders/create.ts` into `http/middleware/address.ts`, after auth and before the handler, answering 422 with the field named, so the handler never sees a bad address. One step moved in a chain that is otherwise unchanged                                                                                                        |
| `timestamps`         | nothing                                   | `createdAt` and `updatedAt` on every record: the two migrations, the store, both route handlers, the CLI's output, the email templates, the fixtures in every test. Fifteen files, each gaining a line or two. The control: a change with a shape and no structure                                                                                                 |
| `carrier-switch`     | one chapter's picture, the rest none      | a second carrier (`shipping/northpost.ts`) chosen by destination country in `worker/ship.ts` through a new `shipping/choose.ts`; beside it, a README section, a `carrier` field on the ship log line, and two tests renamed. One chapter deserves an architecture or before-and-after picture of the choice; the others deserve nothing                            |

The last two are what make "drawn when it helps" measurable: without them a
prompt that draws on every change scores as well as one that draws when it
should.

## `branch.json`

The skim eval's spec, plus what the branch deserves:

```json
{
  "branch": "feat/retry-failed-captures",
  "title": "Retry a capture the gateway failed instead of cancelling the order",
  "description": "…as the engineer would write it…",
  "commit": { "subject": "…", "body": "…" },
  "removed": [],
  "expect": {
    "overview": { "kinds": ["architecture"] },
    "chapterDiagrams": { "min": 0, "max": 1, "kinds": ["sequence"] },
    "mustName": [
      "a capture failure enqueues a retry",
      "the scheduler drains retries with backoff",
      "the order stays paid-pending until the retry settles"
    ],
    "mustReach": ["src/payments/gateway.ts", "src/worker/worker.ts", "src/store/store.ts"],
    "question": "Where does a failed capture go now, and what still reads the order while it waits?"
  }
}
```

- `overview` is `null` when the change deserves none, else the kinds an
  overview may be. `chapterDiagrams` bounds how many chapters may carry one
  and of which kinds; `max: 0` is the control.
- `mustName` is prose for the eye in phase 2 and for the judge in phase 4;
  `mustReach` is the untouched files a mechanism map should ground, which
  phase 2 counts once phase 3 lets a node reach them. `question` is what a
  reader should be able to answer from the overview alone, the test the
  contact sheet puts to whoever reads it.
- The model never sees `expect`. The no-giveaway check reads the spec's
  prose and every file under `files/`, and refuses `fixture`, `contrived`,
  `eval`, `sample`, `synthetic` and `diagram`.

## Code

- `src/evals/contrive.ts` becomes the shared machinery: `standUpRepo` and
  `layBranch` take a `ModelRepo` (`dir`, `name`, `importSubject`, the fixed
  author) and a spec directory, and return the working tree for the caller
  to use and throw away. `BranchSpecSchema` stays the shared core;
  `contriveCase` moves to `skim-contrive.ts` with the skim identity and base,
  calling the shared module. The skim tests move with it; nothing the skim
  eval does changes.
- `src/evals/diagram-case.ts`: `DiagramBranchSpecSchema` (the shared spec
  plus `expect`, kinds validated against `DiagramKindSchema`),
  `readDiagramSpec`, `listDiagramBranches`, `DIAGRAM_CONTRIVED_DIR`.
- `src/evals/diagram-contrive.ts`: `contriveDiagramBranch`: stand the
  packhouse base up, lay the branch, commit, run the base's `node --test`
  there, run the stub review through this checkout's bin, read the run's
  `context.json` for the change's size, throw the repository away. Phase 2
  reuses everything but the stub.
- `src/evals/diagrams.ts`: the bin, `npm run eval:diagrams -- contrive
<name>... | --all`, printing one line a branch. `run`, `score` and `sheet`
  are phase 2 and are named in `USAGE` only when they exist.
- Tests: the spec schema; `listDiagramBranches`; the no-giveaway check over
  spec and files; `contriveDiagramBranch` with a stubbed review against a
  two-file base, as `contrive.test.ts` does today.
- `package.json`: `eval:diagrams`. `.gitignore`: `/evals/diagrams/results/`
  now, so phase 2 does not forget it.

## Decisions taken here

- **TypeScript, no framework, no dependencies.** The splitter's test-aware
  cuts and the import proof are TypeScript-only, so a TypeScript system is
  reviewed the way this repository's own changes are, and no install is
  needed to run its tests.
- **Packhouse, not a stand-in for the user's own stack.** The domain is
  chosen for its boundaries, not its realism to any one organisation. If the
  contact sheet is to double as pitch material, the base can be reskinned
  later; the branches are written against interfaces and would follow.
- **Six branches, not more.** One per picture, a control, and a mixed change.
  A seventh that shows a kind already covered adds a sample, not a question;
  samples come from `--samples`.
- **Whole files, as the skim branches.** A patch would be smaller but a
  branch is read as code, by the model and by whoever writes the next one.
- **The base's tests run on every branch.** A branch whose tests fail is a
  change an engineer would not have opened, and the model notices.

## Open for the user

- The domain: packhouse as above, or a shape nearer what the pitch audience
  runs.
- Whether the hand-run real review at the end is wanted now or left to the
  first sweep in phase 2.
