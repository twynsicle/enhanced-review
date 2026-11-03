# Changelog

## Unreleased

- A shipment records `updatedAt` beside `bookedAt`, and the migrations table
  records `ranAt` for each migration it has applied.
- Every log line that names an order carries the order's `status` and the
  `at` it was last written.
- `packhouse show` prints the order's shipment beside it; `packhouse stuck`
  prints when each order last changed.
- The confirmation email says the date the order was placed.

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
