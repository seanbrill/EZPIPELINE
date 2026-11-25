# Architecture

How EZPIPELINE is put together, and why a few of the pieces are shaped the way
they are.

EZPIPELINE is a monorepo with two workspaces: a React client and an Express
server. The server is the whole product. It owns the database, runs the
pipelines as child processes on its own machine, and in production also serves
the client's static files. The client is a browser UI over the server's API
and holds no state that matters.

---

## The pieces

```
Browser
  |
  |  HTTP  ------------------> Express routes  --> controllers --> services
  |  SSE   (build progress)                                         |
  |  Socket.IO (AI + terminal)                                      |
  |                                                                 v
  |                                                     SQLite (better-sqlite3)
  |                                                     data/pipelines on disk
  |
  +-- served in production from apps/server/public
```

Three background things run inside the same process:

| Service | What it does |
|---|---|
| `SchedulerService` | node-cron jobs that trigger pipelines on a schedule |
| `MCPServer` | Exposes 16 tools to the AI assistant over Model Context Protocol |
| `PluginManager` | Loads plugins from `data/plugins` and puts their binaries on the pipeline's PATH |

There is no queue, no worker process and no second node. One server process
does everything, and pipeline steps run as its children with its privileges.

---

## Repository layout

```
EZPIPELINE/
  apps/
    client/          React + Vite
    server/          Express + better-sqlite3 + Socket.IO
      src/
        routes/      HTTP handlers (index.ts is ~2,750 lines and holds most of them)
        controllers/ EZPipelineController, ConfigController, SystemController, Logger
        services/    Database, Build, Versioning, Permissions, Scheduler,
                     Plugin, Claude, MCP, Agent, Email, Settings, Terminal, Reset
        middleware/  auth.ts
        migrations/  001..007, wired by hand in server.ts
        config/      reads ezpipeline.config.json and .env
        types/
      data/          SQLite database, pipelines, plugins, global env
      logs/          Winston output
      public/        the built client, served in production
      compile/       tsc output plus the esbuild bundle
  docs/
  scripts/
  ezpipeline.config.json
```

The pipeline file's shape (`EZPIPELINEYAML`, `Step`, `KubernetesConfig`) is
declared in `controllers/EZPipelineController.ts`; which fields are allowed,
and what loading a file does with it, is `services/pipelineFile.ts`. See
[Pipeline schema](pipeline-schema.md#where-this-is-defined).

---

## How a build actually runs

```
1.  POST /api/run-pipeline           permission checked here
2.  start_build()                    a build row is created, status "running"
3.  resolve the pipeline directory   from the target id
4.  copy resources/ into workspace/  private keys chmod'd to 600
5.  read the env layers              .env.global, each .env.group, the pipeline's .env
6.  emit build_start
7.  for each step (a kubernetes block is the last one):
      resolve cwd
      build the step environment from the layers
      spawn a shell, stream stdout and stderr through the redactor
      emit progress
8.  record what the run was made of  commits, and the images it pushed
9.  emit build_complete
```

The env layers are read into a per-run object and given to each step. They are
never written into the server's own `process.env`, so a variable reaches only
the pipeline it belongs to.

### Where a step runs

`cwd` defaults to the pipeline's `workspace/` directory. A relative `cwd` is
joined onto it. The literal value `root` is the server's own folder, which
differs in every install; the editor warns about it.

### Approval steps

A step with `type: approval` pauses the loop and emits `build_paused`, which
is on the SSE stream. The build sits with status `paused` until
`POST /api/builds/:id/approve`, which needs `run` permission on the pipeline
and works once: a second approve answers 409.

### Rollback

A run records the container images it pushed. Rolling back to a run starts a
new run of the pipeline with `EZP_ROLLBACK=1` and `EZP_IMAGE_TAG` set to that
run's tag, so the deploy steps deploy it instead of building.

---

## How progress reaches the browser

**Build progress is Server-Sent Events. It is not WebSocket.** Every previous
version of this page said otherwise and every one was wrong, so it is worth
being blunt.

```
GET /api/logs-stream?ticket=<one-time ticket>     text/event-stream
```

`EZPipelineController` is a Node `EventEmitter`. The SSE handler subscribes to
it and forwards each event down the open response as
`data: {"type": "...", "data": ...}`. Event names use underscores:
`build_start`, `progress`, `build_complete`, `build_error`, `build_aborted`.

Socket.IO is present and connected, but only the AI assistant (`claude-*`)
and the terminal (`terminal-*`) use it. The server registers exactly one
socket handler, for `disconnect`.

Why two mechanisms? Build output is one-directional server-to-browser, which
is what SSE is for and it survives a plain HTTP proxy without an upgrade. The
terminal and the assistant need to send keystrokes back, which SSE cannot do.
The cost is that a reverse proxy has to be configured for both, and that
buffering proxies will silently break the SSE stream.

On disconnect the SSE handler removes each listener it added, by the same
function reference, so a closed tab leaves nothing behind.

---

## How the client reaches the server

In development the browser calls `http://localhost:5001` directly. There is
**no Vite proxy**; `apps/client/vite.config.ts` sets a port, an output
directory and one `define`, and nothing else. Cross-origin calls work because
`app.ts` enables CORS with `origin: true`.

The server port is passed to the client at build time through
`define: { 'import.meta.env.VITE_SERVER_PORT': ... }`, read out of
`ezpipeline.config.json`. In a production build `API_URL` is the empty string
and everything is same-origin.

The client build writes **straight into `apps/server/public`**
(`build.outDir` in the Vite config). There is no copy step.

---

## Database

SQLite through `better-sqlite3`, single file, synchronous API.

The file is `app.db` in the data folder: `paths.data` in
`ezpipeline.config.json`, or `EZP_DATA_DIR` when that is set
(`DB_PATH` in `config/index.ts`). Moving the data folder moves the database
with the pipelines. See [Configuration](configuration.md#paths).

### Tables

Dumped from a live database with `sqlite3 apps/server/data/app.db`, not
transcribed from an older doc.

**users**

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | PK |
| `username` | TEXT | unique, not null |
| `password` | TEXT | bcrypt hash, 10 rounds. The column is `password`, not `password_hash` |
| `email` | TEXT | |
| `mfa_enabled`, `mfa_secret`, `mfa_code`, `mfa_expires` | | Email-code MFA |
| `is_admin` | INTEGER | |
| `is_primary_admin` | INTEGER | added by migration 001, cannot be deleted or demoted |
| `display_name` | TEXT | added by migration 001 |
| `can_manage_users` | INTEGER | added by migration 003 |
| `pending_email` | TEXT | added by migration 005 |
| `created_at` | DATETIME | |

**permissions**

| Column | Notes |
|---|---|
| `id`, `user_id` | |
| `target` | TEXT. A pipeline id, `pipeline:<id>`, `global-env`, or `*` |
| `can_view`, `can_run`, `can_edit_yaml`, `can_edit_env`, `can_use_claude`, `can_use_terminal`, `can_view_resources` | INTEGER booleans |

Unique on `(user_id, target)`. There is no `access_level` column and no
`pipeline_name` column.

**builds**

`id` (TEXT uuid), `target`, `status`, `active_step`, `percentage`, `error`,
`version`, `started_at`, `ended_at`, `build_number`, `step_timings` (JSON).
There is no `pipeline_name`, no `completed_at` and no `user_id`.

**build_logs**

`id`, `build_id`, `message`, `timestamp`. The time column is `timestamp`, not
`created_at`.

**Also present**: `settings` (key/value), `agent_tokens`, `schedules`,
`user_devices`.

### Migrations

Seven files in `apps/server/src/migrations/`, each exporting one named
function, imported and called in order inside `server.ts` with a `try/catch`
around each. **There is no migration runner and no `migrations/index.ts`.**
Adding one means editing `server.ts`. See
[Development](development.md#adding-a-migration).

---

## Authentication and authorization

Login checks bcrypt, then issues an HS256 JWT with a 24 hour expiry, signed
with `JWT_SECRET`, without which the server does not start outside
development. Failed attempts are limited per account and per address. The
client keeps the token in `localStorage`, and signs out when the server
answers 401. On every protected request the middleware verifies the
token **and re-reads the user row**, so deleting a user invalidates their
outstanding tokens immediately.

If `auth.required` is false in `ezpipeline.config.json`, the middleware skips
all of that and injects a synthetic super-admin. That is a real switch, not a
development-only affordance: it disables authentication for everyone.

Authorization is the seven-flag model in
[Permissions](permissions.md). Admins bypass every check.

Each route checks the permission its action needs: `view` to read a
pipeline, its builds and their logs; `run` to run, abort, approve, roll back
or schedule; `editYaml` and `editEnv` to change its files. The
[API reference](api-reference.md) lists the requirement beside each route.

---

## Log redaction

`Logger` holds a `Redactor`. At the start of each run, values from the env
files whose variable names look secret (`SECRET`, `PASSWORD`, `TOKEN`, `_KEY`
and similar), or that are marked `# @secret`, and are 8 characters or longer,
are registered with it. Any log line containing one has it replaced with
`[REDACTED]` before it is written or streamed. Names, not every value: hiding
every value turned a branch called `develop` into `[REDACTED]` wherever the
word appeared.

This is a substring match over a set, not a parser. It catches a secret pasted
into an error message, which is the common case. It will not catch a secret
that a command transformed, base64-encoded or split across lines. Treat it as
a safety net, not a guarantee.

---

## Serving

**Development.** `npm run start` kills whatever is on the two configured
ports, then runs the server under `tsx watch` and the client under Vite
through `concurrently`. Ports come from `ezpipeline.config.json`: 5001 for
the server and 5173 for the client.

**Production.** `npm run build` compiles the client into
`apps/server/public` and the server into `apps/server/compile`, then bundles
`compile/src/server.js` into a single minified ESM file at `compile/index.js`.
`npm run start -w apps/server` runs that bundle. One port serves the API, the
static client and the SPA fallback.

---

## Extensibility

**Plugins** are directories under `apps/server/data/plugins`. `PluginManager`
scans them and prepends any binary directories they expose to the `PATH` given
to pipeline steps, which is how a pipeline can call `az` without it being
installed system-wide. Custom step types and lifecycle hooks are **not**
implemented.

**Scheduling** is `node-cron` inside `SchedulerService`, with schedules stored
in the `schedules` table and reloaded on boot.

---

[Back to the documentation index](README.md)
