# Scripts and commands

Every npm script and shell script in the repository, what it does, and which
ones destroy data.

Read [`npm run reset`](#npm-run-reset) before you run it. Its default
behaviour changed and no longer matches what most people expect from a command
with that name.

---

## At a glance

| Command | What it does | Destructive |
|---|---|---|
| `npm run start` | Server plus client, watch mode | no |
| `npm run dev:server` | Server only | no |
| `npm run dev:client` | Client only | no |
| `npm run build` | Build both workspaces | no |
| `npm run init` | Install root plus workspace dependencies | no |
| `npm run reset` | **Smart reset, with no prompt** | **yes** |
| `npm run clean` | Alias for `reset` | **yes** |
| `npm run package` | `docker build -t ezpipeline .` | no |
| `npm run build:dist` | Clean distribution image | no |
| `npm run build:local` | Image with **your data baked in** | no, but see the warning |
| `node scripts/docker.mjs` | Start the Docker stack | no |

---

## Development

### `npm run start`

Runs `scripts/start-dev.ts`, which:

1. reads `ezpipeline.config.json` for both ports
2. kills anything listening on either of them, with `lsof -ti | xargs kill -9`
3. starts `PORT=<server> npm run dev:server` and `npm run dev:client` under
   `concurrently`, colour-prefixed, with `--kill-others`

Step 2 is unconditional. If you have something unrelated on port 5000 it dies
without being asked.

`--kill-others` means the two halves live and die together: a TypeScript error
that stops the server also stops Vite.

The `lsof` call makes this macOS and Linux only. On Windows, run
`npm run dev:server` and `npm run dev:client` in two terminals.

### `npm run dev:server`

`tsx watch src/server.ts` in `apps/server`. Restarts on file change. Reads
`PORT` from the environment, falling back to `ports.server`.

### `npm run dev:client`

`vite --open` in `apps/client`. HMR, and it opens a browser. The port comes
from `ports.client` in `ezpipeline.config.json`, which ships as **5000**.

---

## Building

### `npm run build`

`npm run build -ws`, which runs both workspaces:

| Workspace | Command | Output |
|---|---|---|
| `apps/client` | `tsc -b && vite build` | **`apps/server/public`** |
| `apps/server` | `tsc --build --force && node esbuild.config.js` | `apps/server/compile` |

Note where the client lands. `vite.config.ts` sets
`build.outDir: '../../apps/server/public'`, so the built client goes straight
into the server's static directory. **There is no copy step.** Documentation
that tells you to run `cp -r apps/client/dist/* apps/server/public/` is
describing an arrangement that no longer exists, and `apps/client/dist/` is a
stale leftover from before the change. Copying from it ships an old client.

The server build is two stages: `tsc` emits to `compile/src/`, then esbuild
bundles `compile/src/server.js` into one minified ESM file at
`compile/index.js`, which is what `npm run start -w apps/server` runs.

### `npm run init`

`npm install && npm install -ws`. Run it after cloning, and after anyone adds
a dependency to a workspace.

---

## Data

### `npm run reset`

**Destructive, and it does not ask.**

With no arguments it prints one line and immediately performs a **Smart
Reset**: users and the database, plugins, the AI sandbox, logs and build
history are deleted. Pipeline configuration, meaning YAML, `.env` and
`resources`, is preserved.

```
$ npm run reset
No flags provided. Defaulting to Smart Reset...
   (Use 'npm run reset -- --menu' to see options)
```

There is no confirmation prompt. Older documentation said "Script will prompt
for confirmation before proceeding". It does not, and that sentence was the
most dangerous thing in the old documentation set.

To get the menu, pass `--menu`, with the `--` that tells npm to forward the
argument:

```bash
npm run reset -- --menu
```

| Option | What it removes |
|---|---|
| 1 | Smart Reset: users, database, plugins, sandbox, logs, build history. **Default** |
| 2 | Factory Reset: everything, including all pipelines |
| 3 | Pipelines only |
| 4 | Logs only |
| 5 | Users and database only |
| 6 | Plugins only |
| 7 | AI sandbox only |
| 8 | npm cache only |
| 9 | Cancel |

Pressing Enter takes option 1.

Flags work directly too, and skip the menu:

```bash
npm run reset -- --logs
npm run reset -- --users
npm run reset -- --everything
```

Available: `--everything`, `--pipelines`, `--plugins`, `--logs`, `--claude`,
`--users`, `--cache`, `--smart`, `--menu` (or `-m`).

The database it deletes is `apps/server/data/app.db`.

### `npm run clean`

An alias for `npm run reset`. Same behaviour, same lack of a prompt. A command
called "clean" that silently deletes every user account is worth knowing about
before you type it out of habit.

---

## Docker

### `node scripts/docker.mjs`

The development stack. Checks Docker is installed and the daemon is
responding, checks the ports in `.env` and `ezpipeline.config.json` agree,
builds on first run, then starts `init`, `server` and `client`.

| Argument | Effect |
|---|---|
| *(none)* | Start |
| `down` | Stop |
| `logs` | Follow |
| `rebuild` | Rebuild images from scratch |
| `reset` | Rebuild, and delete the data volume |

The npm aliases now exist in the root `package.json`, so either form works:

| Alias | Same as |
| --- | --- |
| `npm run docker:up` | `node scripts/docker.mjs up` |
| `npm run docker:down` | `node scripts/docker.mjs down` |
| `npm run docker:logs` | `node scripts/docker.mjs logs` |
| `npm run docker:rebuild` | `node scripts/docker.mjs rebuild` |
| `npm run docker:reset` | `node scripts/docker.mjs reset` |
| `npm run docker:sh` | a shell in the server container |

`reset` asks before it runs. It deletes the data volume, which takes the
database, every pipeline workspace and your admin account with it, so it wants
you to type `reset` to confirm. In a script, where nobody can answer, pass
`--yes` and it will not prompt.

### `npm run reset-password`

There is no forgot-password flow in EZPIPELINE: no reset endpoint, no mail out.
A lost admin password used to mean editing SQLite inside the container by hand.

    npm run reset-password -- --list           # account names, never hashes
    npm run reset-password <user> <password>   # at least 8 characters

It runs inside the server container, where the database and bcrypt already
live, and writes the hash at cost 10, the same as the app itself. The stack has
to be running.

### `npm run package` and `npm run build:dist`

Both run `docker build -t ezpipeline .` against the root `Dockerfile`. The
result is the shipped image: Node 22 on Debian slim, client compiled to static
files and served by the server, one process, one port, and **no data**.

`build:dist` is the same command with an explanatory banner.

Run it:

```bash
docker run --env-file .env -p 5000:5000 ezpipeline
```

### `npm run build:local`

Builds `ezpipeline:latest` first, then layers `Dockerfile.baked` on top of it
with **your current `apps/server/data` copied in**.

Useful for handing someone a container that already has your pipelines and
history in it: demos, bug reports, moving an instance between machines.

Two warnings, both from the file itself:

**Size.** `apps/server/data` is around 1.5 GB on the machine this was written
on, and almost none of that is configuration: 381 MB of downloaded azure-cli,
138 MB of azcopy, and 967 MB of one pipeline's checked-out repository. The
server re-downloads and re-clones those on demand. Clear
`data/plugins` and the workspace directories first if the image comes out
absurdly large.

**Secrets.** Everything under `apps/server/data` goes in, including `app.db`
with its password hashes and MFA secrets, `data/.env.global`, and every
per-pipeline `.env` holding deploy credentials. Anyone who can pull the image
or run `docker history` on it has all of it, permanently, because a deleted
layer is still in the history. Treat the result as a secret, not a release.

The root `.env` is deliberately **not** baked in. Supply it at run time:

```bash
docker run --env-file .env -p 5000:5000 ezpipeline-local
```

### `scripts/build-snapshot.sh`

Builds a timestamped image `ezpipeline-snapshot:<YYYYMMDDHHMMSS>` plus
`:latest` from the root `Dockerfile`. Predates the current Docker work and is
not wired to an npm script.

---

## Workspace scripts

From `apps/server`:

| Command | What it does |
|---|---|
| `npm run dev` | `tsx watch src/server.ts` |
| `npm run build` | `tsc --build --force && node esbuild.config.js` |
| `npm run start` | `node compile/index.js`, the esbuild bundle |
| `npm run kill` | `pm2 stop all && pm2 delete all && pm2 flush all` |

`npm run kill` operates on **every** PM2 process on the machine, not just
EZPIPELINE's.

From `apps/client`:

| Command | What it does |
|---|---|
| `npm run dev` | `vite --open` |
| `npm run start` | `vite`, without opening a browser |
| `npm run build` | `tsc -b && vite build` |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |

---

## Loose scripts

Not wired to npm. Run with `npx tsx`.

| Script | What it does |
|---|---|
| `scripts/debug-db.ts` | Prints every row of the `users` table |
| `scripts/test-ai-headless.ts` | Old headless test for the AI assistant. **Hardcodes `http://localhost:8080`**, which is not a port this project uses, and drives the pre-Anthropic assistant API |
| `scripts/dev-split.sh` | Opens two macOS Terminal windows via AppleScript, one per workspace |

---

## Common sequences

**Fresh start, keeping pipelines**

```bash
npm run reset          # smart reset, no prompt
npm run start
```

**Fresh start, keeping nothing**

```bash
npm run reset -- --everything
npm run start
```

**Test the production build locally**

```bash
npm run build
npm run start -w apps/server
# http://localhost:5001
```

No copy step. The client is already in `apps/server/public`.

**Reinstall everything**

```bash
rm -rf node_modules apps/*/node_modules package-lock.json
npm install
npm run init
```

**Clean a failed build**

```bash
rm -rf apps/server/compile apps/server/public
npm run build
```

---

[Back to the documentation index](README.md)
