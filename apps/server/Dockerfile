# EZPIPELINE server, for local development.
#
# Deliberately runs `tsx watch` against BIND-MOUNTED source rather than a
# compiled build: editing a file on your machine restarts the server inside the
# container with no rebuild. docker-compose.yml is what mounts the source and
# masks node_modules; this file only has to install and start.
#
# The file that was here before was dead - it ran `npm init -y` and started
# `index.cjs`, a file this repo has never had. Nothing referenced it. It is now
# the development server image, which is what apps/*/Dockerfile means in the
# project this layout was copied from.

# Debian, not Alpine, and Node 22, not 18. Three reasons, all of them things
# that were broken before:
#
#  1. better-sqlite3 12.5 declares `node: 20.x || 22.x || 23.x || 24.x || 25.x`.
#     On node:18-alpine, npm ci found no matching prebuild, fell back to
#     node-gyp, and died looking for a Python that Alpine does not ship. The
#     old root Dockerfile has never been able to build on this machine.
#  2. TerminalService.ts spawns the literal path '/bin/bash' for every xterm
#     session. Alpine has busybox ash at /bin/sh and no bash at all, so every
#     terminal session would have failed with ENOENT.
#  3. Debian is glibc, so better-sqlite3 installs a prebuilt binary and this
#     image needs no C toolchain. Rejected: alpine plus build-essential and
#     python3 to compile from source - it builds a ~180 MB toolchain into the
#     image to produce a binary that Debian just downloads.
FROM node:22-bookworm-slim

WORKDIR /app

# Dependencies are installed INTO THE IMAGE, on Linux, so better-sqlite3 is
# compiled or downloaded for this container's ABI. The host's node_modules is
# masked by anonymous volumes at run time (see docker-compose.yml) so a macOS
# build cannot reach the container and fail at require().
#
# The three package.json files are copied on their own first so this layer is
# reused whenever only source changed.
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


# Below npm ci, not above it, so that the install layer stays byte-identical
# with apps/client/Dockerfile and Docker builds the workspace tree once for
# both images. Nothing installed here is needed to install: better-sqlite3
# finds a glibc prebuild on Debian and never invokes a compiler.
#
# Everything the server shells out to. These are not decoration: the code calls
# each one by name, and a missing one fails at the point of use with an ENOENT
# that names a binary rather than a cause.
#
#   tini             correct signal handling, so Ctrl-C stops the container now
#                    rather than after Docker's ten second kill timer
#   bash             TerminalService.ts, hardcoded as '/bin/bash'
#   git              pipeline steps clone and check out repositories
#   unzip            EZPipelineController rollback runs `unzip -o <artifact>`
#   python3          services/bridge.py allocates a real PTY for the AI
#                    assistant login, and PluginManager lists python3 as a
#                    prerequisite for the aws and azure plugins
#   openssh-client   git over ssh, which is what pipeline_workspace/PIPELINE_SSH
#                    exists to hold keys for
#   curl, ca-certificates  plugin downloads and TLS for all of the above
#   python3-venv     `python3 -m venv` needs ensurepip, which Debian ships in a
#                    separate package. Without it the azure-cli and aws-cli
#                    plugin installers fail on their first line with
#                    "ensurepip is not available" and leave a half made venv.
#   postgresql-client  psql, so a pipeline can create the database role its
#                    application connects as. Without it that is a human with
#                    a terminal, which is the step every deploy guide has and
#                    nobody remembers.
#   libicu72         the Bicep CLI is a .NET binary and .NET refuses to start
#                    without ICU: "Couldn't find a valid ICU package installed
#                    on the system", printed as a 60 line stack trace after
#                    `az bicep install` reports success. Installing it here
#                    rather than at pipeline time because apt inside a running
#                    container is lost on the next recreate, and a provisioning
#                    run that works until you rebuild is worse than one that
#                    never worked.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini \
      bash \
      git \
      unzip \
      python3 \
      python3-venv \
      postgresql-client \
      libicu72 \
      openssh-client \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# GitHub's SSH host keys, so `git clone git@github.com:...` works at all.
#
# Without them every SSH clone dies with "Host key verification failed", which
# reads like a credentials problem and is not one - there was no ~/.ssh in this
# image whatsoever.
#
# ssh-keyscan is trust-on-first-use, so the result is CHECKED against the
# fingerprints GitHub publishes at
# https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
# and the build fails if they disagree. A keyscan nobody verifies is a keyscan
# that would happily bake in whatever answered on the network that day.
#
# StrictHostKeyChecking=no would also have "fixed" it, by turning off the check
# that makes SSH worth using.
RUN mkdir -p /root/.ssh \
    && ssh-keyscan -t rsa,ecdsa,ed25519 github.com > /root/.ssh/known_hosts 2>/dev/null \
    && for fp in \
         "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU" \
         "SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s" \
         "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM" ; do \
         ssh-keygen -lf /root/.ssh/known_hosts | grep -q "$fp" \
           || { echo "github.com host key $fp not found in keyscan output"; exit 1; }; \
       done \
    && chmod 700 /root/.ssh && chmod 600 /root/.ssh/known_hosts \
    && echo "github.com host keys verified against published fingerprints"

# Where a deploy key lives, if there is one.
#
# /root/.ssh is in the image and therefore lost on every recreate, so the KEY
# is kept in the data volume and only this pointer is baked in. Generating a
# key that a rebuild silently discards is worse than having none: the pipeline
# works until the next `docker compose build` and then fails with an
# authentication error nobody connects to the rebuild.
#
# IdentitiesOnly stops ssh offering every key it can find - without it an agent
# with several keys can exhaust GitHub's auth attempt limit before reaching the
# right one, which surfaces as "Permission denied" for a key that is present
# and correct.
RUN printf '%s\n' \
      'Host github.com' \
      '  User git' \
      '  IdentityFile /app/apps/server/data/ssh/id_ed25519' \
      '  IdentitiesOnly yes' \
      '  StrictHostKeyChecking yes' \
      > /root/.ssh/config \
    && chmod 600 /root/.ssh/config

# The Docker CLI, so that pipeline steps running `docker build` and
# `docker push` find a binary. docker-compose.yml mounts the host's Docker
# socket into this container, and that mount without a CLI is the interface
# promising something the image cannot do - which is where it stood before,
# since node:18-alpine had no docker binary either.
#
# The static tarball rather than Docker's apt repository: the repo route means
# adding a GPG key and an apt source and pulls containerd and the daemon in
# behind it. This takes the one file that is needed - about 35 MB of the 67 MB
# archive - and pins the version.
#
# KNOWN LIMIT, stated here because it will bite someone: the socket talks to
# the HOST daemon, so any path in a `docker build` context is resolved on the
# host filesystem, not this container's. Image references, registries, `docker
# ps` and `docker run` all work; a build whose context is a path under /app
# will not, because /app does not exist on the host. See docker-compose.yml.
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

COPY . .

# Below npm ci, and that ordering matters: npm reads NODE_ENV at install time
# and would omit the devDependencies this image runs - tsx, typescript, esbuild.
#
# Why default to production in a file headed "for local development": because
# docker-compose.yml, the only thing that runs this image locally, sets it to
# development explicitly. The default is therefore never what a developer gets.
# It is what everything else gets - a bare `docker run`, an orchestrator, a CI
# job that forgets. NODE_ENV was set nowhere in this repo, so ClaudeManager's
# `isDev` check read undefined and took its development branch everywhere. An
# unset variable has to land on the strict side, and an image default is the
# last place that can guarantee it.
ENV NODE_ENV=production

EXPOSE 5001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "dev", "--workspace", "apps/server"]
