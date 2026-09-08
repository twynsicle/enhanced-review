# syntax=docker/dockerfile:1
#
# enhanced-review — single image, single process.
#
#   build:  docker build -t enhanced-review .
#   run:    docker run --rm -p 3000:3000 --env-file .env enhanced-review
#   job:    docker run --rm --env-file .env enhanced-review \
#             node src/jobs/cli.ts recover-jobs
#
# The server and the jobs CLI are TypeScript that Node runs directly (type
# stripping), so the runtime stage ships source, not a second bundle
# (phase-5-plan P5-D1). Everything those two entry points import has to be
# here: missing `src/domain` is what stopped the Phase 1 image from booting.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: postinstall runs `prisma generate`, which needs the schema
# that is only copied in the build stage.
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# git: the review runner shallow-clones the target repo (Phase 3).
RUN apk add --no-cache git
COPY package.json package-lock.json prisma.config.ts ./
# `prisma migrate deploy` reads the config, the schema and the migration SQL,
# and they have to be here before the install: unlike the other stages this
# one runs lifecycle scripts, because Prisma's own install step is what puts
# the schema engine in node_modules (the CLI cannot fetch it at runtime — the
# image's node user owns nothing under /app), and the repo's postinstall
# (`prisma generate`) needs the schema. The client it writes is replaced by
# the build stage's copy below.
COPY prisma ./prisma
# Production dependencies only. `prisma` is one of them (phase-5-plan P5-D2)
# so entrypoint.sh can apply migrations without a second image.
#
# The prune shares this layer because a later `rm` would leave the files in
# the earlier one: npm filters the Claude SDK's optional binary packages by os
# and cpu but not by libc, so an alpine image gets the glibc build as well as
# the musl one it actually uses — 234 MB that cannot execute here. Verified
# before removing: with the glibc copy gone, the musl `claude` binary still
# reports its version, and musl is what the SDK resolves on this base image.
RUN npm ci --omit=dev --no-audit --no-fund   && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-x64

# Copied from the build stage rather than the context, so `src/db/generated`
# (written by `prisma generate`, gitignored and docker-ignored) comes along.
COPY --from=build /app/build ./build
COPY --from=build /app/server ./server
COPY --from=build /app/src/config ./src/config
COPY --from=build /app/src/common ./src/common
COPY --from=build /app/src/db ./src/db
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/src/jobs ./src/jobs
COPY --chmod=755 entrypoint.sh ./entrypoint.sh

# Reported by GET /api/health; CI passes the commit SHA.
ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION

USER node
EXPOSE 3000

# Node has fetch built in, so the check needs no extra package in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

# CMD, not ENTRYPOINT: `docker run <image> node src/jobs/cli.ts <job>` then
# replaces the start-up chain with the one-off instead of appending to it.
CMD ["./entrypoint.sh"]
