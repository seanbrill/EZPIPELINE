# EZPIPELINE client, for local development.
#
# Runs the Vite dev server against BIND-MOUNTED source, so hot module reload
# works inside the container exactly as it does outside it. New file: there was
# no client image before, only the root Dockerfile's production build, which
# meant there was no way to get a working dev loop out of Docker at all.

# Same base and same tag as apps/server/Dockerfile on purpose, and everything
# down to and including npm ci is byte-identical between the two files. Docker
# keys its layer cache on instruction text, so it installs the 600-package
# workspace tree ONCE and this image reuses it. That is also why the apt line
# sits below npm ci here rather than above it, which is the more usual order:
# the two images need different system packages, and putting that difference
# first would break the cache for the expensive layer behind it.
FROM node:22-bookworm-slim

WORKDIR /app

# Identical to apps/server/Dockerfile so the layer is shared. npm ci at the
# repo root installs BOTH workspaces - this is one npm workspaces tree, and
# installing only apps/client would leave the root package-lock.json unsatisfied.
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/client/package.json ./apps/client/
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


# Only tini here. This image serves files and compiles TypeScript; unlike the
# server it never shells out to git, bash or python, so installing them would
# be weight with nothing behind it.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Below npm ci for the same reason as the server image: npm reads NODE_ENV at
# install time and production would drop vite itself, which lives in
# devDependencies. Compose overrides this to development.
ENV NODE_ENV=production

EXPOSE 5000

# The command is split across ENTRYPOINT and CMD so that docker-compose.yml can
# override the PORT ALONE. Compose replaces CMD but never ENTRYPOINT, so
# `command: ["--port", "5000"]` there changes the one thing that varies without
# restating the whole vite invocation in a second file where it could drift.
#
# `npm run start`, not `npm run dev`. They are the same command except that
# `dev` is `vite --open`, which tries to launch a browser - inside a container
# there is none, so Vite prints a spawn failure on every boot for a browser
# that was never going to be the right one. The host browser opens the
# published port instead.
#
# --host binds 0.0.0.0: Vite defaults to localhost, which inside a container
# means the container's own loopback and refuses every connection arriving from
# the published port. --strictPort makes a port clash an error rather than
# letting Vite quietly move to the next free port, which would leave the
# published port mapped to nothing while the logs claimed success.
ENTRYPOINT ["/usr/bin/tini", "--", "npm", "run", "start", "--workspace", "apps/client", "--", "--host", "0.0.0.0", "--strictPort"]

# Overridden by docker-compose.yml from the root .env. This default matches
# ezpipeline.config.json's ports.client, which is what a bare `docker run` of
# this image would otherwise disagree with.
CMD ["--port", "5000"]
