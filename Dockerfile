# syntax=docker/dockerfile:1.7
#
# Phase B Dockerfile. Multi-stage build that produces a slim runtime image
# (~115 MB) for a Next.js 16 standalone app + a small migrate runner.
# Platform pinned to linux/amd64 because ECS Fargate runs amd64.

# --- Stage 1: deps ---
FROM --platform=linux/amd64 node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/github-client/package.json ./packages/github-client/
COPY packages/review-types/package.json ./packages/review-types/
RUN npm ci

# --- Stage 2: build ---
FROM --platform=linux/amd64 node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Compile the migrate runner so the runtime image runs it via plain node.
# .mts -> .mjs preserves ESM (the source uses `import.meta.url`).
RUN npx --no-install tsc drizzle/migrate.mts \
      --outDir drizzle \
      --module nodenext --moduleResolution nodenext \
      --target es2022 --esModuleInterop --skipLibCheck

# --- Stage 3: runtime ---
FROM --platform=linux/amd64 node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# git: required by the runner for `git clone`. tini: PID 1 reaper so
# SIGTERM propagates cleanly to node. ca-certificates: HTTPS to GitHub
# and Anthropic.
RUN apk add --no-cache git ca-certificates tini

# Non-root runtime user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone Next.js tree (server.js + minimal node_modules) + assets.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations: SQL files + meta + the compiled migrator (.mjs).
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle

# `drizzle-orm` is bundled into the standalone server chunks for app
# usage, but the migrator subpath (`drizzle-orm/node-postgres/migrator`)
# is only `import`-ed from drizzle/migrate.mjs at runtime. Drop the
# package next to the standalone tree so node can resolve it.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# Recovery runner + entrypoint. Both are plain CJS / sh, no compile step.
COPY --chown=nextjs:nodejs scripts/recover-jobs.cjs ./scripts/recover-jobs.cjs
COPY --chown=nextjs:nodejs scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "server.js"]
