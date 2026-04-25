# enhanced-review worker container.
#
# Build context is the monorepo root so npm workspaces resolve correctly.
# Build:
#   docker build -f packages/worker/Dockerfile -t enhanced-review-worker .
#
# Run via the worker compose overlay (./docker-compose.worker.yml) so it
# joins the same network as the upstream Supabase stack.
#
# Base image: node:20-bookworm-slim. We deliberately avoid alpine because:
#   - opencode ships glibc-targeted prebuilt binaries
#   - git's credential / smart-http machinery is more reliably tested on
#     glibc, especially for shallow fetches against private GitHub repos
#   - the size delta vs alpine (~25 MB) doesn't matter for a long-lived
#     worker
#
# Pinned versions:
#   OPENCODE_VERSION  — placeholder default below; verify the current
#                       opencode CLI release before deploying and bump in
#                       a dedicated PR. CLI flags can change between
#                       releases, so the build also runs `opencode
#                       --version` as a smoke test before publishing.
#
# Image-size note: this installs the full root workspace (including
# packages we don't strictly need at runtime) for build simplicity.
# Phase 7 can tighten this.

ARG NODE_IMAGE=node:20-bookworm-slim
ARG OPENCODE_VERSION=0.21.0

FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Manifests first for build-cache friendliness.
COPY package.json package-lock.json ./
COPY packages/review-types/package.json ./packages/review-types/
COPY packages/worker/package.json ./packages/worker/
COPY packages/github-client/package.json ./packages/github-client/

RUN npm ci --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ARG OPENCODE_VERSION
WORKDIR /app

# tini for proper SIGINT/SIGTERM forwarding to the node process.
# git for the per-job shallow clone.
# ca-certificates so the GitHub HTTPS handshake works.
# curl is the install path for opencode below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Install opencode CLI. The official installer is a curl|bash script that
# downloads a glibc binary and drops it at /usr/local/bin/opencode. Pin
# the version via OPENCODE_VERSION so a behaviour change upstream doesn't
# silently break the worker.
ENV OPENCODE_INSTALL_DIR=/usr/local/bin
RUN curl -fsSL https://opencode.ai/install \
    | env OPENCODE_VERSION="${OPENCODE_VERSION}" bash \
 && opencode --version

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/review-types/node_modules ./packages/review-types/node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules

# Copy only the workspaces the worker actually needs.
COPY package.json package-lock.json ./
COPY packages/review-types ./packages/review-types
COPY packages/worker ./packages/worker

WORKDIR /app/packages/worker
ENV NODE_ENV=production
ENV REVIEW_EXECUTOR=opencode

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start", "--silent"]
