# Troubleshooting

Symptoms, what causes them, and what to do. Grouped by where the symptom
shows up.

Two facts that save time:

- **The database is `app.db` in the data folder** (`apps/server/data/app.db`
  unless you moved it). `sqlite3` aimed at a wrong name creates a new empty
  file and shows you nothing.
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
lsof -ti:5173 | xargs kill -9
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

`JWT_SECRET` changed. Every token signed with the old one stopped working,
which is correct: everyone signs in again. In development with no
`JWT_SECRET`, the secret is fixed and a restart signs nobody out.

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

### An API call answered 404 `not_found`

The path is wrong, or the method is: the message names both, for example
`There is no GET /api/whatever.`

### Every request answers 401

Your sign-in expired (tokens last 24 hours) or the server's `JWT_SECRET`
changed. The app sends you to sign in; a script needs a fresh token from
`POST /api/login`.

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
until someone with `run` on the pipeline approves it; the run page shows the
pause and the Approve button. To find paused builds directly:

```bash
sqlite3 apps/server/data/app.db \
  "SELECT id, target, status, active_step FROM builds WHERE status='paused';"
```

---

## Pipelines

### A step failed: where to look

The run page opens with a card that says why. It names the step (or the
substep, such as `3.2.1 Push to the registry`) and the exit code, and shows
the last lines the step printed. It also gives the folder it ran in, the
shell and the command as the pipeline wrote it. **Jump to the error** opens
that step's log at the first error line.

The log has the same facts under the step's output:

```
✗ Step "Deploy" failed: exit code 127
  meaning  a command was not found. It is not installed on this server, or not on the PATH the step sees.
  command  kubectl apply -f k8s/
  folder   /data/pipelines/Web/deploy/workspace
  shell    /bin/sh
  ran for  1.2s
  not set  KUBECONFIG: no env layer sets it, so the shell reads an empty value
  PATH     /usr/local/bin:/usr/bin:/bin
```

| You see | It means |
|---|---|
| exit code 127 | A command was not found. Install it on the server (or in the Docker image), or add its folder to `PATH`. The block shows the `PATH` the step had. |
| exit code 126 | The command was found but could not be run: it is not executable (`chmod +x`), or permission was denied. |
| exit code 137, or stopped by SIGKILL | Killed. If nobody cancelled the run, the system usually ran out of memory. |
| stopped by SIGTERM | The run was cancelled, or something asked the process to stop. |
| could not start | The shell or the folder does not exist. A `shell:` must be an absolute path on the server. |
| not set / empty | The command reads a variable that no env layer sets, or that is set to nothing. Set it on the pipeline's Environment tab, its group, or the global env. A variable the script assigns itself is not listed. |

Values are never shown: the command is printed as written, with variable
names, and anything that looks secret is redacted. If a run fails before its
first step (the pipeline file will not parse, say), the log says so and the
run is marked failed.

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

A relative `cwd` is relative to the pipeline's `workspace/`, which starts
empty. A step that enters a checkout must run after the step that creates it.

And `cwd: root` is not the repository root. It is the server's own folder;
the editor marks it.

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
2. If you renamed the file, rename it back to `.env`. A file name in the YAML
   does not change which file is read; the editor marks an `env:` field as
   unused.
3. `${VAR}` is the interpolated form; `$VAR` is left to the shell.
4. Some names cannot be overridden by a step at all: `CI`, `TERM`, `BUILD_ID`,
   `PIPELINE_ID`, `PIPELINE_NAME`, `TARGET_NAME` and the git prompt
   suppressors are applied after step `env`. See
   [Pipeline schema](pipeline-schema.md#environment-variable-precedence).

### A variable has the wrong value

The same name is set in more than one place, and the innermost wins: the
pipeline's `.env` beats its group's `.env.group`, which beats the global
`.env.global`. The Environment tab shows each variable with the layer it
comes from. See
[Pipeline schema](pipeline-schema.md#environment-variable-precedence).

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

### The Kubernetes step failed

A `kubernetes:` block becomes the pipeline's last step, named "Deploy to
Kubernetes", and it is an ordinary step: its `kubectl` output is in the run's
log and a failed apply or rollout fails the build. Check that the server's
user has a kubeconfig with the `context` you named, and that the files exist
in the workspace when the step runs. See [Kubernetes](kubernetes.md).

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
npm run reset              # choose 5, Reset Users/Database Only
```

Or have an admin set a new password for the account:
`POST /api/users/:id/password`. See [Authentication](authentication.md#resetting-someone-elses-password).

### Tokens expire too quickly

They last 24 hours, with no refresh, and the app sends you to sign in when one
runs out. The length is the `expiresIn` in `routes/index.ts`.

### A user still has access after being deleted

They do not. The middleware re-reads the user row on every request, so
deleting an account invalidates its outstanding tokens immediately. If they
genuinely still have access, check `auth.required` in
`ezpipeline.config.json`: when it is `false` every request is treated as a
primary admin.

### Someone saw something they should not have

Check what they were granted: `GET /api/users/:id/permissions`, or their row
in People. A `*` target grants its flags on every pipeline. Admins see
everything. The audit log (Settings, admins only) shows what each account did.
[Permissions](permissions.md#which-routes-check-what) lists what each flag
opens.

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

The column is `timestamp`.

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
