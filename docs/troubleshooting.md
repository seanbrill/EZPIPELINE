# Troubleshooting

Symptoms, what causes them, and what to do. Grouped by where the symptom
shows up.

Two corrections up front, because they invalidate a lot of the advice that
used to be on this page:

- **The database is `apps/server/data/app.db`.** Not `ezpipeline.db`. Every
  `sqlite3` command aimed at that name silently created a new empty file and
  told you nothing was there.
- **Build progress is SSE, not WebSocket.** If build output is not appearing,
  the thing to check is `/api/logs-stream`, not Socket.IO.

---

## Installation

### `npm install` fails on better-sqlite3

Almost always Node 18. `better-sqlite3` 12.5 declares
`20.x || 22.x || 23.x || 24.x || 25.x`, so on 18 there is no prebuilt binary
and npm falls back to compiling. The error mentions `node-gyp`, Python or a
C compiler, and never mentions Node versions, which is what makes it hard to
place.

```bash
node --version      # needs to be 20 or newer
```

On a supported version:

```bash
npm cache clean --force
rm -rf node_modules apps/*/node_modules package-lock.json
npm install
npm run init
```

### `npm ci` says the lock file does not match

`package-lock.json` at the root is currently missing packages that
`apps/server/package.json` asks for, including `@anthropic-ai/sdk`. Fix it
once, on the host, and commit:

```bash
npm install
git add package-lock.json
```

The Docker build works around it by falling back to `npm install` and printing
a warning that the image is not reproducible.

### `npm run init` fails

Run the halves separately to see which one fails:

```bash
npm install
npm install -ws
```

---

## The server

### Port already in use

`npm run start` clears both configured ports first, so this usually means you
started the server another way.

```bash
lsof -ti:5001 | xargs kill -9
lsof -ti:5000 | xargs kill -9
```

Or change `ports` in `ezpipeline.config.json`. Change it **there**, not in
`.env` alone: the dev client compiles the server port into its bundle from
that file, so changing only `.env` gives you a server on one port and a
browser calling another.

### It exits immediately

```bash
tail -50 apps/server/logs/app.log
```

If the log is empty, the failure is before Winston initialises. Run it in the
foreground to see the real error:

```bash
cd apps/server && npx tsx src/server.ts
```

The common one is `better-sqlite3` failing to load, which in Docker means a
macOS-built `node_modules` leaked into a Linux container. The compose file
masks the bind mount with anonymous volumes to prevent exactly that; if you
edited it, put them back.

### `SQLITE_BUSY: database is locked`

Two processes are writing to the same file. Usually a stray server, or one on
the host and one in a container sharing a bind mount.

```bash
pkill -f "tsx src/server.ts"
pkill -f "node compile/index.js"

ls -la apps/server/data/app.db*
```

If a `-shm` or `-wal` file is left behind after everything is stopped, delete
those two, never `app.db` itself.

### Everyone was logged out after a restart

Expected if `JWT_SECRET` is unset: the fallback is a constant, so that is not
it. If you just **set** `JWT_SECRET` for the first time, or changed it, every
existing token became invalid. That is correct behaviour.

---

## The client

### Requests fail with connection refused

Open the browser console and look at the port in the failing URL.

In development the client calls `http://localhost:<port>` directly. There is
**no Vite proxy**, whatever older documentation said, and the port is compiled
into the bundle at build time by a `define` in `vite.config.ts` reading
`ezpipeline.config.json`.

So the fix is to make `ezpipeline.config.json` and your environment agree, and
then rebuild or restart Vite so the new value is compiled in.

### An API call returned HTML

The path is wrong. The SPA catch-all serves `index.html` with status **200**
for any unrecognised GET, so a typo in a URL looks like success.

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  -H "Accept: application/json" localhost:5001/api/whatever
```

With `Accept: application/json` you get an honest `404 {"error":"Not Found"}`.
Send that header from your client.

### Parsing a 401 or 403 throws

They are `text/plain`, not JSON. The auth middleware uses `res.sendStatus()`,
so the body is the literal word `Unauthorized` or `Forbidden`. Check
`content-type` before parsing.

### Build output never appears

Build progress is Server-Sent Events on `GET /api/logs-stream`, not
Socket.IO. In the browser's network tab it should be an `eventsource` request
that stays open.

Behind a reverse proxy this is the classic failure: with response buffering
on, nginx holds the stream until its buffer fills, so output arrives in a
burst minutes later or not at all. `proxy_buffering off` on that location.
See [Deployment](deployment.md#reverse-proxy).

Socket.IO is a separate matter and carries only the assistant and the
terminal. If those are broken but builds are fine, the problem is
`/socket.io/`.

### The build looks stuck at a step

Check whether the step has `type: approval`. An approval step pauses the build
and waits for someone to release it, and the pause is **not** published on the
SSE stream, so the UI shows a build that simply stopped moving. Look at the
build in the dashboard for an approve control, or:

```bash
sqlite3 apps/server/data/app.db \
  "SELECT id, target, status, active_step FROM builds WHERE status='paused';"
```

### Every step ran twice

Not your pipeline. `POST /api/run-pipeline` calls the controller's `run()`
directly and then schedules the same call again inside `setImmediate`. It is a
bug in `apps/server/src/routes/index.ts`. Nothing you can configure around.

---

## Pipelines

### A pipeline does not appear

1. The directory must be under `apps/server/data/pipelines`.
2. It must contain a `.yaml` or `.yml` file. The loader prefers one named
   exactly `pipeline.yaml`. There is no `.ezpipeline.yaml` extension.
3. The YAML must parse:
   ```bash
   npx js-yaml apps/server/data/pipelines/Group/Name/pipeline.yaml
   ```
4. `id`, `appName`, `version`, `description` and `steps` must all be present.
5. Refresh targets in the UI, or restart the server.
6. Check the log:
   ```bash
   grep -i "yaml\|parse\|pipeline" apps/server/logs/app.log | tail -20
   ```

If it appears for you but not for a colleague, it is permissions, not
loading. `GET /api/targets` filters by `can_view`.

### A step fails on a missing directory

`cwd` is relative to the pipeline's `workspace/`, which starts empty. A step
that enters a checkout must run after the step that creates it.

And `cwd: root` is not the repository root. It resolves to `apps/server`.

### `cd` did not carry to the next step

Each step is a fresh shell. Chain inside one step with `&&`, or set `cwd` on
each step that needs it.

### `${VAR}` came through literally

The variable is not set. Add a debug step:

```yaml
- name: Debug env
  shell: /bin/bash
  run: env | sort
```

Then check, in this order:

1. Is there a `.env` in the pipeline directory? The file is found **by name**,
   as `.env` or `.env.<pipeline id>`.
2. The `env:` field in your YAML is not consulted. If you renamed the file and
   updated `env:` expecting that to work, it does not. Rename it back to
   `.env`.
3. `${VAR}` is the interpolated form; `$VAR` is left to the shell.
4. Some names cannot be overridden by a step at all: `CI`, `TERM`, `BUILD_ID`,
   `PIPELINE_ID`, `PIPELINE_NAME`, `TARGET_NAME` and the git prompt
   suppressors are applied after step `env`. See
   [Pipeline schema](pipeline-schema.md#environment-variable-precedence).

### A variable has a value from a different pipeline

Real, and not your mistake. Loading a pipeline's `.env` assigns onto the
server's own `process.env`, so values persist after the build and leak into
the next one. Restarting the server clears them. It is a bug in
`EZPipelineController.run()`.

### A step hangs forever

It is waiting on stdin, which is not connected to anything. EZPIPELINE
suppresses the common prompts (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=echo`,
`DEBIAN_FRONTEND=noninteractive`, `CI=true`), but anything else needs its own
non-interactive flag. Abort the build and add one.

### git clone fails to authenticate

Put a key in the pipeline's `resources/` and reference it. Files ending
`.pem` or `.key`, or named `id_rsa`, are chmod'd to `600` during the copy,
because `ssh` refuses a key with looser permissions and says so in a way that
reads like a network error.

```yaml
- name: Clone
  run: GIT_SSH_COMMAND="ssh -i ${RESOURCES/id_rsa}" git clone git@github.com:you/repo.git
```

Or a token from the pipeline's `.env`:

```yaml
run: git clone https://${GITHUB_TOKEN}@github.com/you/repo.git
```

### kubectl ran but nothing deployed

The `kubernetes` block runs `kubectl apply -f` and **catches every error into
a log line**. A failed apply does not fail the build. Check
`apps/server/logs/app.log` for the kubectl output.

It also does not wait for rollout and does not report status, whatever older
documentation claimed. If you want the build to depend on the rollout, add an
ordinary step:

```yaml
- name: Wait for rollout
  run: kubectl rollout status deployment/my-app -n production --timeout=5m
```

See [Kubernetes](kubernetes.md).

---

## Authentication

### Cannot log in

```bash
sqlite3 apps/server/data/app.db "SELECT id, username, is_admin FROM users;"
```

The password column is `password`, not `password_hash`.

If MFA enforcement is on and the account has no email address, login returns a
**restricted** token scoped to email setup, and every other route rejects it
with `emailSetupRequired`. That looks like a broken login and is not. Check:

```bash
curl -s localhost:5001/api/auth/config
# {"required":true,"mfaEnforced":true}
```

### The setup page redirects to login

A user exists. To start over:

```bash
npm run reset -- --menu     # choose 5, Reset Users/Database Only
```

Note the `--`. Without it, `npm run reset` performs a Smart Reset immediately,
with no prompt.

### Tokens expire too quickly

24 hours, hardcoded, no refresh. Changing it means editing the `expiresIn`
values in `routes/index.ts`.

### A user still has access after being deleted

They do not. The middleware re-reads the user row on every request, so
deleting an account invalidates its outstanding tokens immediately. If they
genuinely still have access, check `auth.required` in
`ezpipeline.config.json`: when it is `false` every request is treated as a
primary admin.

### Someone saw something they should not have

Likely, and possibly not a misconfiguration. Several routes have no
permission check at all, including artifact download, rollback, the user list
and reading anyone's permissions. The full list is in
[Permissions](permissions.md#where-nothing-is-checked).

---

## The AI assistant

### "The assistant has no Anthropic API key"

Set `ANTHROPIC_API_KEY` in the root `.env` and restart. There is deliberately
no field in the interface for it.

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:5001/api/ai/status
# configured: true
```

### Nothing appears in the chat window

Assistant output is Socket.IO. Check `/socket.io/` is reachable; behind a
proxy it needs an explicit upgrade rule.

### "That websocket is no longer connected"

The page reconnected with a new socket id between your request and the answer.
Reload.

### It refuses to roll back or delete something

Intentional. The assistant gets eleven of the sixteen MCP tools, and the five
it does not have are the destructive ones. Use the UI.

---

## Database

### Reading it

```bash
sqlite3 apps/server/data/app.db ".tables"
sqlite3 apps/server/data/app.db "PRAGMA table_info(users);"
```

Column names that differ from older documentation:

| Table | Documented as | Actually |
|---|---|---|
| `users` | `password_hash` | `password` |
| `builds` | `pipeline_name`, `completed_at`, `user_id` | `target`, `ended_at`, and no user column |
| `build_logs` | `created_at` | `timestamp` |
| `permissions` | `pipeline_name`, `access_level` | `target`, plus seven boolean columns |

### Pruning old build logs

```bash
sqlite3 apps/server/data/app.db \
  "DELETE FROM build_logs WHERE timestamp < datetime('now','-7 days');"
sqlite3 apps/server/data/app.db "VACUUM;"
```

The column is `timestamp`. The version of this command that used `created_at`
errored out, which at least failed loudly.

### Migration errors on boot

The seven migrations run on every start, each wrapped in a `try/catch` that
only logs a warning, so a failure does not stop the server and you have to
look:

```bash
grep -i migration apps/server/logs/app.log | tail -20
```

Migration 001 recreates the `permissions` table. It detects an
already-granular table and skips, which is the only thing preventing a restart
from wiping every permission. If you are debugging it, back up `app.db` first.

---

## Performance

### Disk filling up

Almost always `apps/server/data`. On the machine this was written on it was
1.5 GB, of which 381 MB was a downloaded azure-cli plugin, 138 MB was azcopy,
and 967 MB was one pipeline's checked-out repository.

```bash
du -sh apps/server/data/* | sort -h
du -sh apps/server/data/pipelines/*/*/versions 2>/dev/null | sort -h
```

Version artifacts prune themselves past 10 files or 1 GB **per pipeline**, so
ten pipelines can hold 10 GB legitimately. Workspaces are never pruned.

### The server gets slower over the course of a day

Check the SSE listener leak. The `/api/logs-stream` handler registers its
listeners as anonymous functions and then tries to remove them by a different
reference, so nothing is removed and listeners accumulate on every browser
disconnect. A long-lived server with a dashboard open in several tabs
accumulates them steadily. Restarting clears it. The fix is in
`apps/server/src/routes/index.ts`.

---

## Getting a useful bug report together

1. `apps/server/logs/app.log`, the last 100 lines.
2. `node --version` and your OS.
3. Whether you are on Docker or Node directly.
4. The pipeline YAML, with secrets removed.
5. Whether the account is an admin. Most authorization defects are invisible
   as an admin, because every check short-circuits.

---

[Back to the documentation index](README.md)
