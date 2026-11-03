# Changelog

## 2.4.0

- Check the address in the middleware chain, before the handler. A bad address
  now answers 422 (was 400) with the field that failed, and no order is stored
  or capture attempted for it.

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
