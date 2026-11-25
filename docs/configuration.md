# Configuration

EZPIPELINE reads configuration from two places: `ezpipeline.config.json` for
things that are not secret, and a `.env` at the repository root for things
that are.

Every setting on this page is read by the server. Names from older versions
that are no longer read, and what replaced them, are in
[Older names](#older-names).

---

## `ezpipeline.config.json`

At the repository root. Loaded by `apps/server/src/config/index.ts`, which
walks four directories up from itself to find it.

```json
{
  "ports":  { "client": 5173, "server": 5001 },
  "paths":  { "data": "apps/server/data",
              "logs": "apps/server/logs" },
  "auth":   { "required": true,
              "defaultUser": { "username": "admin", "isAdmin": true } },
  "email":  { "enabled": false, "host": "", "port": 587, "secure": false,
              "from": "", "auth": { "user": "", "pass": "" } }
}
```

The merge is shallow apart from `auth` and `email`, which are merged one level
deep. Anything you omit falls back to the built-in defaults, which are the
values shown here.

### `ports`

| Key | Shipped | What reads it |
|---|---|---|
| `server` | 5001 | The server, unless `PORT` is set |
| `client` | 5173 | Vite's dev server port in development |

The client port is not just a dev server setting. `vite.config.ts` also injects
the **server** port into the browser bundle at build time through a `define`,
because in development the browser calls `http://localhost:<server port>`
directly rather than going through a proxy.

So set the server port in `ezpipeline.config.json` rather than with `PORT`
when you run the dev client against it: the dev client is built with the port
from the file. `scripts/docker.mjs` refuses to start the stack when the two
disagree. A production build calls its own origin and is unaffected.

### `paths`

Relative paths resolve against the repository root; absolute paths are used
as-is.

| Key | What it actually controls |
|---|---|
| `data` | Everything the server keeps: `app.db`, `pipelines/`, `plugins/`, `global/`, `.env.global` |
| `logs` | Where Winston writes `app.log` |

`EZP_DATA_DIR` and `EZP_LOGS_DIR`, when set, win over both. The desktop app
uses them to keep its data in the system's app-data folder.

Moving `paths.data` moves the database with everything else. Move the folder's
contents across before you point the setting at a new place.

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
| `JWT_SECRET` | none outside development | Signs sign-in tokens. See below |
| `NODE_ENV` | unset | `development` or `test` allows the built-in development JWT secret |
| `EZP_DATA_DIR` | `paths.data` | Where everything the server keeps lives, the database included |
| `EZP_LOGS_DIR` | `paths.logs` | Where `app.log` is written |
| `EZP_HOST` | all interfaces | The address to bind. The desktop app sets `127.0.0.1` |
| `EZP_SETUP_TOKEN` | unset | Set by the self-host wizard on the instance it deploys: shuts the first-admin page and lets that instance take one hand-over. See [Self-hosting](self-hosting.md#the-hand-over) |
| `EZP_SELFHOST_IMAGE` | `api.filefreak.io/ezpipeline/ezpipeline` | The image repository the self-host wizard deploys, without a tag; the running version is the tag |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`, for the console and `app.log`. Build output is unaffected |
| `ANTHROPIC_API_KEY` | unset | Enables the AI assistant |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model the assistant uses |
| `SMTP_ENABLED` | `email.enabled` | `true` to send mail |
| `SMTP_HOST` | `email.host` | |
| `SMTP_PORT` | `email.port` | |
| `SMTP_SECURE` | `email.secure` | `true` only for implicit TLS on 465 |
| `SMTP_USER` | `email.auth.user` | |
| `SMTP_PASS` | `email.auth.pass` | |
| `SMTP_FROM` | `email.from` | |

The desktop app also sets `EZP_DESKTOP_TOKEN`, `EZP_SUPERVISED` and
`EZP_VERSION` for the server it starts. You do not set those yourself.

This list was produced by searching `apps/server/src` for `process.env`.

#### `JWT_SECRET`

Sign-in tokens are signed with it. Outside development the server will not
start without one: an unset value, the placeholder older versions used, or one
shorter than 32 characters stops it with a message saying what to do.

```bash
JWT_SECRET=$(openssl rand -hex 32)
```

With `NODE_ENV=development` (or `test`) and no `JWT_SECRET`, the server uses a
fixed development secret so a local checkout runs without setup. Never deploy
with `NODE_ENV=development`.

Changing the secret signs everyone out, which is the right behaviour.

#### `ANTHROPIC_API_KEY`

Read lazily by the assistant, so it is picked up from `.env` regardless of
module load order. Without it, the assistant panel loads and reports that it
is not configured; nothing else in EZPIPELINE is affected.

There is deliberately no field in the interface for it. See
[AI assistant](ai-assistant.md#setting-it-up).

---

## Older names

Earlier versions and their documentation used these. None is read now; the
right-hand column is what to use instead.

| Older name | Use instead |
|---|---|
| `DATABASE_PATH` | `EZP_DATA_DIR` or `paths.data`. The database is `app.db` in the data folder |
| `LOG_FILE` | `EZP_LOGS_DIR` or `paths.logs`. The file is always `app.log` |
| `CLAUDE_API_KEY` | `ANTHROPIC_API_KEY` |
| `paths.sandbox` | Nothing. The assistant calls the Anthropic API and has no working folder |
| `env:` in `pipeline.yaml` | Nothing. The pipeline's `.env` is found by name, and the editor flags the field as unused |

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
If there is no `.env`, the loader tries `.env.<pipeline id>`. There is no field
for it in the YAML. Each run reads the file afresh, and its variables reach only
that pipeline's steps. See
[Pipeline schema](pipeline-schema.md#environment-variable-precedence).

---

## Global environment

`<data>/.env.global`, managed under Settings or through `/api/global-env`.
It is read at the start of every run, so a change takes effect on the next
run, whether it was made in the app or by editing the file.

Access is by permission on the literal target `global-env`: `view` lists key
names, `editEnv` reveals values and permits writes. See
[Permissions](permissions.md#targets).

---

## Logging

Winston, one console transport and one file transport at
`<paths.logs>/app.log`. The level is `info` unless `LOG_LEVEL` says otherwise.

Values from the env files (global, group and pipeline) are hidden in logs
when the variable's name looks secret (it contains `SECRET`, `PASSWORD`,
`TOKEN`, `_KEY`, `API_KEY`, `CREDENTIAL`, `PRIVATE`, `SESSION`, `SALT` or
`CERT`, or is a `PAT`) or the line is marked `# @secret`, and the value is
8 characters or longer. Any log line containing one has it replaced with
`[REDACTED]` before it is written or streamed. Values such as a branch name
are left alone, so a log still says which branch failed to clone.

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
