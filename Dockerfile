# syntax=docker/dockerfile:1
#
# enhanced-review — single image, single process.
#
#   build:  docker build -t enhanced-review .
#   run:    docker run --rm -p 3000:3000 --env-file .env enhanced-review
#
# Phase 5 adds entrypoint.sh (migrate → seed → recover → web) and the jobs
# bundle; this Dockerfile only proves the web service builds and boots.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# git: the review runner shallow-clones the target repo (Phase 3).
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/build ./build
COPY server ./server
COPY src/config ./src/config
COPY src/common ./src/common
USER node
EXPOSE 3000
CMD ["node", "server/index.ts"]
