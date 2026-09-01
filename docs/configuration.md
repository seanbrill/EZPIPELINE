# Configuration

EZPIPELINE reads configuration from two places: `ezpipeline.config.json` for
things that are not secret, and a `.env` at the repository root for things
that are.

The most useful thing this page can tell you is which knobs are real. Several
settings that appear in older documentation, and one that appears in the
config file itself, are not read by any code. They are listed in
[Settings that do nothing](#settings-that-do-nothing) so you do not spend an
afternoon on one.

---

## `ezpipeline.config.json`

At the repository root. Loaded by `apps/server/src/config/index.ts`, which
walks four directories up from itself to find it.

```json
{
  "ports":  { "client": 5000, "server": 5001 },
  "paths":  { "data": "apps/server/data",
              "logs": "apps/server/logs",
              "sandbox": "apps/server/ai_sandbox" },
  "auth":   { "required": true,
              "defaultUser": { "username": "admin", "isAdmin": true } },
  "email":  { "enabled": false, "host": "", "port": 587, "secure": false,
              "from": "", "auth": { "user": "", "pass": "" } }
}
```

The merge is shallow apart from `auth` and `email`, which are merged one level
deep. Anything you omit falls back to the built-in defaults, and those defaults
are **not** the same as the values shipped in the file: the code defaults the
client to 5173, the file says 5000. The file wins.

### `ports`

| Key | Shipped | What reads it |
|---|---|---|
| `server` | 5001 | The server, unless `PORT` is set |
| `client` | 5000 | Vite's dev server port, and the API URL compiled into the dev client |

The client port is not just a dev server setting. `vite.config.ts` also injects
the **server** port into the browser bundle at build time through a `define`,
because in development the browser calls `http://localhost:<server port>`
directly rather than going through a proxy.

The consequence is worth stating plainly: if `ezpipeline.config.json` and your
environment disagree about the server port, the server listens on one and the
browser calls the other. Everything looks healthy, and every request fails in
the browser console only. `scripts/docker.mjs` refuses to start the stack when
it detects this, which is the only place anything checks.

### `paths`

Relative paths resolve against the repository root; absolute paths are used
as-is.

| Key | What it actually controls |
|---|---|
| `data` | `data/pipelines`, `data/plugins`, `data/global`, `data/.env.global`. **Not the database** |
| `logs` | Where Winston writes `app.log` |
| `sandbox` | The old AI sandbox directory. Nothing loads it since the assistant moved to the Anthropic API |

#### The data path does not move the database

`config/index.ts` exports `DB_PATH` as `<data>/app.db`, and **nothing imports
it**. `services/Database.ts` computes its own path instead:

```ts
const dbPath = path.resolve(__dirname, "../../data/app.db");
```

That is `apps/server/data/app.db`, always. Point `paths.data` at
`/var/lib/ezpipeline` and your pipelines and plugins move there while the
database stays behind, which looks like data loss and is not.

This is a bug in `apps/server/src/services/Database.ts`, reported but not
fixed by this documentation pass. Until it is fixed, treat the database
location as fixed.

### `auth`

```json
"auth": { "required": true, "defaultUser": { "username": "admin", "isAdmin": true } }
```

Set `required` to `false` and the auth middleware stops verifying tokens
entirely, injecting a synthetic primary admin into every request instead.
`PermissionsService` short-circuits every check to `true` at the same time.

This is one switch that removes all authentication **and** all authorization,
for anyone who can reach the port. Nothing in the interface indicates it is
off. `defaultUser` only names the synthetic account.

### `email`

Fallback values for SMTP. Every field can be overridden by an environment
variable, and the environment wins whenever it is set. There is also a
database-backed SMTP settings screen under Settings, which is what most
installs use; this block is the boot-time default.

---

## Environment variables

One file, at the repository root: `.env`. Copy `.env.example` and fill it in.
`config/index.ts` calls `dotenv.config()` on it during module load, so **every
change needs a server restart**.

It is the root `.env`, not `apps/server/.env`. Older documentation said the
latter. A file there is not read.

### The ones that are read

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `ports.server` | The port the server listens on. Wins over the config file |
| `JWT_SECRET` | see below | Signs login tokens |
| `ANTHROPIC_API_KEY` | unset | Enables the AI assistant |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model the assistant uses |
| `SMTP_ENABLED` | `email.enabled` | `true` to send mail |
| `SMTP_HOST` | `email.host` | |
| `SMTP_PORT` | `email.port` | |
| `SMTP_SECURE` | `email.secure` | `true` only for implicit TLS on 465 |
| `SMTP_USER` | `email.auth.user` | |
| `SMTP_PASS` | `email.auth.pass` | |
| `SMTP_FROM` | `email.from` | |

That is the complete list. It was produced by grepping `process.env` across
`apps/server/src`, not by copying a previous page.

`NODE_ENV` is **not** on it. The only place the server reads it is
`ClaudeManager.ts`, which nothing imports any more since the assistant moved to
the Anthropic API. Docker sets it, and setting it is still worth doing because
`npm ci` behaves differently under it, but no EZPIPELINE code branches on it
today. The client's production build is selected by Vite's own
`import.meta.env.PROD`, which is decided at build time and is unrelated.

#### `JWT_SECRET`

```ts
const SECRET = process.env.JWT_SECRET || "ezpipeline-secret-key";
```

Two files do this: `middleware/auth.ts` and `routes/index.ts`.

If `JWT_SECRET` is unset, tokens are signed with a string that is committed to
this repository. Anyone who knows it can mint a token claiming
`{"id": 1, "isAdmin": true}` and the server will accept it, because the
middleware verifies the signature and then re-reads user 1 from the database.
That is not a theoretical attack; it is how this documentation verified the
authenticated endpoints on a development instance.

The server does not warn when the fallback is in use. **Set it.**

```bash
JWT_SECRET=$(openssl rand -hex 32)
```

Changing it invalidates every outstanding token, which is the correct
behaviour and means everyone logs in again.

#### `ANTHROPIC_API_KEY`

Read lazily by the assistant, so it is picked up from `.env` regardless of
module load order. Without it, the assistant panel loads and reports that it
is not configured; nothing else in EZPIPELINE is affected.

There is deliberately no field in the interface for it. See
[AI assistant](ai-assistant.md#setting-it-up).

---

## Settings that do nothing

Every one of these appeared in a previous version of the documentation as a
working option. None are read by any code in `apps/server/src`.

| Setting | What it claimed | Reality |
|---|---|---|
| `DATABASE_PATH` | Moves the SQLite file | Not read anywhere. The path is hardcoded |
| `LOG_LEVEL` | Sets Winston's verbosity | Not read. The level is hardcoded to `info` in `Logger.ts` |
| `LOG_FILE` | Names the log file | Not read. Always `<paths.logs>/app.log` |
| `CLAUDE_API_KEY` | Enabled the AI features | Never existed. The variable is `ANTHROPIC_API_KEY` |
| `paths.sandbox` | The AI working directory | Nothing loads it since the engine changed |
| `pipeline.yaml`'s `env:` field | Names the environment file | Not read. The file is found by convention |

To change the log level today you edit `apps/server/src/controllers/Logger.ts`.
There is no `apps/server/src/config/logger.ts`, whatever the troubleshooting
page used to say.

---

## Per-pipeline configuration

Each pipeline is a directory under `<data>/pipelines`:

```
<Group>/<Name>/
  pipeline.yaml
  .env
  .pipeline
  resources/
  workspace/
  versions/
```

Environment variables come from `.env` in that directory, found **by name**.
If there is no `.env`, the loader tries `.env.<pipeline id>`. The `env:` field
in the YAML is not consulted. See
[Pipeline schema](pipeline-schema.md#env-does-not-do-what-it-says).

One thing to be aware of: loading a pipeline's `.env` assigns each key onto the
server's own `process.env`, so the values persist after the build and leak into
the next pipeline that runs. Reported as a bug in `EZPipelineController.run()`.

---

## Global environment

`<data>/.env.global`, managed under Settings or through `/api/global-env`.
Loaded once when the server starts, so a change made through the API takes
effect for new builds without a restart, while a change made by editing the
file directly does not.

Access is by permission on the literal target `global-env`: `view` lists key
names, `editEnv` reveals values and permits writes. See
[Permissions](permissions.md#targets).

---

## Logging

Winston, one console transport and one file transport at
`<paths.logs>/app.log`. The level is `info` and is not configurable without
editing the source.

Values loaded from any pipeline `.env` are registered with a redactor, and any
log line containing one of them has it replaced with `[REDACTED]` before it is
written or streamed. Strings shorter than three characters are ignored, to
avoid turning every log line into noise.

This is a substring match, not a parser. It catches a secret echoed into an
error message, which is the common case. It will not catch one that a command
base64-encoded or split across lines.

There is no log rotation. Use `logrotate` or PM2's rotation module.

---

## Checking your configuration

```bash
# The config file parses
jq . ezpipeline.config.json

# The variables the server will actually see
grep -vE '^\s*#|^\s*$' .env

# The server starts and answers
npm run dev:server
curl -s localhost:5001/health
# {"status":"ok"}
```

`GET /health` is not under `/api` and needs no token.

To confirm the assistant picked up its key:

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:5001/api/ai/status
```

`configured: true` means the key is present.

---

[Back to the documentation index](README.md)
