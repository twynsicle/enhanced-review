# Changelog

## 2.4.0

- Retry a capture the gateway failed instead of leaving the order for the
  abandoned sweep: the request answers 202 with the order still `placed`,
  and a sweep captures again after one, five and thirty minutes before
  giving up and cancelling it.
- `packhouse stuck` lists the capture retries that have come due.

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
