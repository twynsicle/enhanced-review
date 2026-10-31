# Changelog

## Unreleased

- Hold a paid order whose address the carrier cannot deliver to (`on_hold`)
  instead of packing it. `packhouse release <id>` sends it to the warehouse
  once the desk has settled the address; the abandoned sweep cancels one
  nobody has released in a week.
- `packhouse stuck` lists held orders, with how long each has waited.

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
