#!/bin/sh
#
# Container start-up (phase-5-plan P5-D5): bring the database to the current
# migration, clear jobs orphaned by whatever stopped the last process, then
# hand the container over to the server.
#
# `set -e` is deliberate: a failed migration must kill the container rather
# than leave a server running against an out-of-date schema. The last line is
# `exec` so node replaces this shell as PID 1 and receives SIGTERM directly —
# the review runner's shutdown drain depends on it.
#
# This is the image's CMD, not its ENTRYPOINT, so a one-off still works:
#   docker run --rm <image> node src/jobs/cli.ts recover-jobs
set -e

./node_modules/.bin/prisma migrate deploy

node src/jobs/cli.ts recover-jobs

exec node server/index.ts
