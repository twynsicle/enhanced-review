---
paths:
  - 'Dockerfile'
  - '.dockerignore'
  - 'entrypoint.sh'
  - 'docker-compose.yml'
  - 'package.json'
  - '.github/workflows/**'
  - 'server/**'
---

# Container

Loaded when you open the image, compose, CI or bootstrap files, or
`package.json`. The two traps below are summarised in `AGENTS.md` too, because
they bite from ordinary code changes.

One image, one process. `docker compose up -d` is all day-to-day dev needs:
it starts Postgres alone, because `web` is behind the `app` profile.
`docker compose --profile app up --build` runs the app as it ships on `:3000`.
The profile exists because that port is also `npm run dev`'s — a bare `up`, a
`restart` or Docker Desktop's start button used to raise a container built from
whatever the tree held at image-build time, which silently beat the dev server
to the port and served a stale build. Compose enables a profile automatically
when a command names the service, so `run --rm web …` and `logs web` need no
flag. CI builds the image with plain `docker build` and is unaffected.
`entrypoint.sh` is the image's **CMD**, not its entrypoint, so
`docker run <image> node src/jobs/cli.ts <job>` replaces the start-up chain
instead of appending to it.

The runtime stage ships **source, not a bundle**: the server and the jobs CLI
are TypeScript that Node runs directly, so everything they import has to be
copied into the image — `server/`, `src/{config,common,db,domain,jobs}/`,
`prisma/`. Adding an import that reaches a directory not on that list breaks
the container without breaking `npm run dev`, which is exactly how an earlier
image came to build and not boot.

The opposite trap applies to packages. `@tabler/icons-react`,
`@monaco-editor/react`, `monaco-editor`, `@dagrejs/dagre` and `@fontsource/*`
are **devDependencies** bundled into `build/server` by `ssr.noExternal`, so the
image never installs them. Importing one from a module that runs on the server
at runtime, rather than through the bundle, fails only in the container.
