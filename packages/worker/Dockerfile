# enhanced-review worker container.
#
# Build context is the monorepo root so npm workspaces resolve correctly.
# Build:
#   docker build -f packages/worker/Dockerfile -t enhanced-review-worker .
#
# Run via the worker compose overlay (./docker-compose.worker.yml) so it
# joins the same network as the upstream Supabase stack.
#
# Image size note: this installs the full root workspace (including
# packages we don't strictly need at runtime) for build simplicity.
# Phase 7 can tighten this.

FROM node:20-alpine AS deps
WORKDIR /app

# Manifests first for build-cache friendliness.
COPY package.json package-lock.json ./
COPY packages/review-types/package.json ./packages/review-types/
COPY packages/worker/package.json ./packages/worker/
COPY packages/github-client/package.json ./packages/github-client/

RUN npm ci --omit=dev --ignore-scripts

FROM node:20-alpine AS runtime
WORKDIR /app

# tini for proper SIGINT/SIGTERM forwarding to the node process.
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/review-types/node_modules ./packages/review-types/node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules

# Copy only the workspaces the worker actually needs.
COPY package.json package-lock.json ./
COPY packages/review-types ./packages/review-types
COPY packages/worker ./packages/worker

WORKDIR /app/packages/worker
ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start", "--silent"]
