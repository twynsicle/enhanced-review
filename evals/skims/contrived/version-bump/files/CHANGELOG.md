# Changelog

## 1.5.0

- Retry a failed feed fetch, twice by default, before failing the run. `FEED_RETRIES` sets the count.
- Requires Node 20.

## 1.4.2

- Treat a feed row with a negative quantity as zero rather than failing the whole sync.

## 1.4.1

- Status page shows when the feed was last fetched.

## 1.4.0

- Reconcile in batches of 500 so a large feed no longer holds one transaction open.
- Report the number of items that changed, not just whether anything did.

## 1.3.0

- Five-column feed format. The three-column format stays behind `LEGACY_FEED`.
