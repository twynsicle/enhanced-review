# stockline

Keeps the warehouse's stock levels in line with the supplier feed. Every few
minutes it pulls the feed, reconciles it against what the warehouse system
thinks it holds, and writes the differences back, with a status page for the
operations desk.

## Running

```
npm install
FEED_URL=https://feed.example.com/stock.csv npm start
```

Requires Node 18 or later.

## Configuration

| Variable          | Default | Meaning                                        |
| ----------------- | ------- | ---------------------------------------------- |
| `FEED_URL`        | —       | Where the supplier feed is fetched from        |
| `FEED_TIMEOUT_MS` | 8000    | How long one fetch of the feed may take        |
| `LOCALE`          | en      | Language of the status page                    |
