# Changelog

## Unreleased

- Take Cardflow's asynchronous capture: an order whose capture answers
  pending is stored `placed` with its payment reference and `POST /orders`
  answers 202 for it; the gateway's `capture.completed` and
  `capture.declined` webhook events then move it to `paid` or `cancelled`.
  A pending capture Cardflow says nothing about for an hour is cancelled by
  a new sweep (`UNANSWERED_SWEEP_MS`).

## 2.3.1

- Book the carrier at most once per order: a `ship` job replayed after the
  booking succeeded reuses the stored shipment instead of booking again.

## 2.3.0

- Record the gateway's refund reference on the order when its webhook arrives.
- Free domestic shipping on orders of £50 and over.

## 2.2.0

- Sweep orders left `packing` for two hours and queue their `ship` job again.
- `packhouse stuck` lists what the sweeps would pick up.

## 2.1.0

- Retry a failed job once before dropping it, so a carrier blip no longer
  needs the warehouse desk to step in.
