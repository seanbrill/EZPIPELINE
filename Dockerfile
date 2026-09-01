# EZPIPELINE, built as one shipped image: client compiled to static files and
# served by the server, one process, one port.
#
#   docker build -t ezpipeline .          (or npm run package)
#   docker compose --profile prod up app
#
# This is NOT the development image. For a dev loop with hot reload use
# `node scripts/docker.mjs`, which builds apps/server/Dockerfile and
# apps/client/Dockerfile against bind-mounted source. This file is the
# artifact: what runs is exactly what was built.
#
# It was rewritten rather than replaced. Four things in the previous version
# meant it could not produce a working container, and all four are fixed below
# with the reason next to the fix.

# ---------------------------------------------------------------------------
# base
# ---------------------------------------------------------------------------
# node:22-bookworm-slim, not node:18-alpine. FIX 1 of 4, and the one that
# stopped the build dead: better-sqlite3 12.5 declares
# `node: 20.x || 22.x || 23.x || 24.x || 25.x`, so on Node 18 + musl npm found
# no prebuilt binary, fell back to node-gyp, and failed with
# "Could not find any Python installation to use". Alpine ships no Python.
# Debian is glibc, so better-sqlite3 downloads a prebuild and this image needs
# no C toolchain at all. Rejected: alpine plus python3 and build-essential,
# which bakes a 180 MB compiler into the image to build something Debian
# simply fetches.
FROM node:22-bookworm-slim AS base

# ---------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/client/package.json ./apps/client/
COPY apps/server/package.json ./apps/server/
# `npm ci`, with a LOUD fallback rather than a silent one.
#
# npm ci is the right command: it installs exactly what package-lock.json
# pins, so an image built today and one built next month contain the same
# tree. But it refuses to run at all when the lock does not match
# package.json, and at the time of writing this repo's lock is missing six
# packages that apps/server/package.json asks for - @anthropic-ai/sdk and its
# dependencies, added without a matching `npm install` at the root.
#
# Failing the build there would leave nobody able to start a container over
# someone else's uncommitted lock file. Falling back QUIETLY would be worse:
# the image would be built from a resolution nothing recorded, and no one
# would know. So it falls back and says so, in the build log, every time,
# until the lock is fixed.
RUN npm ci || { \
      echo; \
      echo "=============================================================="; \
      echo "npm ci failed: package-lock.json does not match package.json."; \
      echo "Falling back to npm install so this image can still be built."; \
      echo "This image is NOT reproducible: its dependency tree is not the"; \
      echo "one the lock file records."; \
      echo "Fix on the host with:  npm install   then commit package-lock.json"; \
      echo "=============================================================="; \
      echo; \
      npm install --no-audit --no-fund; \
    }

COPY . .

# `npm run build -ws`: apps/client runs `tsc -b && vite build` and apps/server
# runs `tsc --build --force && node esbuild.config.js`.
#
# Note where the client output lands. vite.config.ts sets
# outDir: '../../apps/server/public', so the built client is at
# apps/server/public and NOT at apps/client/dist. The previous version of this
# file copied apps/client/dist, which on this machine still holds a build from
# a week before the current one - so the shipped image served a stale client
# and nothing said so. FIX 2 of 4.
RUN npm run build

# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

# Everything the server shells out to at run time, by hardcoded name.
# TerminalService spawns the literal '/bin/bash'; pipeline steps run git;
# rollback runs `unzip -o`; services/bridge.py needs python3 to allocate a PTY.
# On the previous alpine base none of these existed, so every one of those
# features failed inside the shipped image with an ENOENT.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini bash git unzip python3 openssh-client curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI, because docker-compose.yml mounts the host Docker socket into
# this container for pipeline steps that build and push images. Same pinned
# static tarball as apps/server/Dockerfile, and the same limit applies: the
# daemon is the host's, so a `docker build` context path that only exists
# inside this container will not resolve.
ARG DOCKER_CLI_VERSION=27.5.1
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) arch=x86_64 ;; \
      arm64) arch=aarch64 ;; \
      *) echo "no Docker CLI build for TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${arch}/docker-${DOCKER_CLI_VERSION}.tgz" \
      | tar -xzf - -C /usr/local/bin --strip-components=1 docker/docker; \
    docker --version

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/ecosystem.config.cjs ./apps/server/

# FIX 4 of 4 is an omission. The previous version also copied
# /app/apps/server/yaml and /app/apps/server/env. Neither directory exists in
# this repository and neither ever has, and COPY fails the build when its
# source is missing - so even with a working base image this file could not
# have reached the end. They are simply gone.
#
# apps/server/node_modules is not copied either: this is an npm workspaces
# tree, so every dependency hoists to /app/node_modules, which is copied above.

# ezpipeline.config.json and docs/ are read at run time from the repo root:
# config/index.ts computes ROOT_DIR from __dirname and reads the config there,
# and DOCS_DIR is ROOT_DIR/docs, which the docs viewer and the MCP server both
# list. Neither was in the previous image, so the server silently fell back to
# its built-in defaults and the docs pages were empty.
COPY --from=builder /app/ezpipeline.config.json ./
COPY --from=builder /app/docs ./docs

# The compiled server is installed at apps/server/src, NOT apps/server/compile.
# FIX 3 of 4, and the least obvious one.
#
# Five modules compute their paths from __dirname plus a fixed number of '..'
# segments - config/index.ts walks four levels up to find the repo root,
# Database.ts walks two to find data/app.db, and PUBLIC_DIR walks two to find
# the client build. tsc writes to compile/, which inserts ONE EXTRA DIRECTORY
# between those modules and everything they are counting toward. In the
# previous image that shifted every one of them: ROOT_DIR resolved to
# /app/apps, so ezpipeline.config.json was never found; DATA_DIR became
# /app/apps/apps/server/data; and PUBLIC_DIR pointed at a directory the build
# never wrote to, so the server served no client at all.
#
# Installing the compiled JavaScript at the path its TypeScript occupied makes
# every one of those counts land exactly where it does in development.
# Rejected: patching the five path expressions - they are in apps/server/src,
# which this task does not own, and a layout fix in the file that creates the
# layout is the smaller change. The real fix is still worth making in source;
# it is written up in the report that accompanies this work.
COPY --from=builder /app/apps/server/compile/src ./apps/server/src

# The built client. PUBLIC_DIR resolves to apps/server/public relative to the
# compiled config module above.
COPY --from=builder /app/apps/server/public ./apps/server/public

WORKDIR /app/apps/server

# 5000 by default, matching ezpipeline.config.json's ports.client, which is
# the port the previous compose file published. The server reads process.env
# PORT first, so docker-compose.yml can move it.
ENV PORT=5000
EXPOSE 5000

# tini as PID 1 so SIGTERM reaches node and the terminal sessions and pipeline
# children it spawned get cleaned up, instead of Docker killing the container
# ten seconds later with everything still running.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
