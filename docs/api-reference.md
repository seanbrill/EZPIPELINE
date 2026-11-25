# API reference

Every HTTP route the server registers, grouped by what it is for.

This page was rebuilt by reading `apps/server/src/routes/` and then calling
the server. Where a previous version described an endpoint that does not
exist, it has been removed rather than left in place. Those removals are
listed at the bottom under [Endpoints that never existed](#endpoints-that-never-existed),
because a doc that confidently describes a missing route is worse than no doc
at all: you write a client against it and get a 404 you cannot explain.

---

## Base URL

| Where | URL |
|---|---|
| Development | `http://localhost:5001/api` |
| Production | `https://your-domain.com/api` |

The client does not proxy. In development the browser calls the server on
port 5001 directly and the server allows it with permissive CORS. There is no
Vite proxy configured, despite what older pages said. See
[Architecture](architecture.md#how-the-client-reaches-the-server).

---

## The two authentication schemes

Most routes take a **user JWT**:

```
Authorization: Bearer <token from POST /api/login>
```

The routes under `/api/agent` take an **agent token** instead: a separate
credential minted at `POST /api/agent-tokens`, meant for scripts rather than
people. A user JWT will not open them and an agent token will not open
anything else. See [Agent API](#agent-api).

### Errors

Every error is JSON with a non-2xx status.

| Situation | Status | Body |
|---|---|---|
| No token | 401 | `{"error":"not_signed_in","message":"Sign in first."}` |
| Expired or bad token, or the account was deleted | 401 | `{"error":"session_expired","message":"..."}` |
| Signed in, but not allowed | 403 | `{"error":"...","message":"..."}` or `{"error":"Sentence"}` |
| Unknown path under `/api` | 404 | `{"error":"not_found","message":"There is no GET /api/nope."}` |
| A handler rejected the request | 4xx / 5xx | see below |

Newer routes answer `{"error":"snake_case_code","message":"A sentence."}`:
branch on `error`, show `message`. Older routes put the sentence in `error`
and send no `message`. A client that shows `message` when there is one and
`error` otherwise reads both, which is what the app does.

A 401 always means "sign in again". The app signs out and shows the sign-in
page when it gets one.

---

## Authentication and setup

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/setup-status` | none | `{"initialized": true/false}` |
| GET | `/api/auth/config` | none | `{"required": bool, "mfaEnforced": bool}` |
| POST | `/api/setup` | none, first user only | Creates the primary admin |
| POST | `/api/login` | none | Four possible response shapes, below |
| GET | `/api/check-auth` | JWT | |
| POST | `/api/change-password` | JWT | Own password only |
| POST | `/api/auth/setup/email-challenge` | JWT | Sends a code to a new address |
| POST | `/api/auth/setup/email-verify` | JWT | Confirms it |
| POST | `/api/auth/mfa/verify` | none | Completes a login challenge |
| POST | `/api/auth/mfa/resend` | none | New code for a pending challenge |

### POST /api/setup

Works only while the `users` table is empty. The user it creates is the
**primary admin**, which is a stronger thing than an admin: nobody, including
other admins, can delete or demote them.

```json
{ "username": "admin", "password": "secret", "email": "you@example.com" }
```

`email` is optional here but becomes required later if MFA enforcement is
switched on. Responds `{"token", "username", "isAdmin"}` and logs you
straight in.

### POST /api/login

Send `{"username", "password"}`, optionally `deviceToken` for a remembered
device. What comes back depends on the system MFA setting and the user's own.

| Response contains | Meaning | What to do |
|---|---|---|
| `token` | Normal login | Store the token |
| `mfaRequired: true` | A code was emailed | Collect it, `POST /api/auth/mfa/verify` |
| `mfaSetupRequired: true` | MFA enforced, user has an email, not yet enrolled | Walk them through setup |
| `emailSetupRequired: true` | MFA enforced, user has no email | The token supplied is **restricted** |

That last token is scoped `setup-email` and the middleware rejects it on every
path except `/auth/setup/...`. It is a one-hour token whose only purpose is
letting someone attach an email address so they can then receive codes.

Ten wrong passwords for one account, or thirty from one address, within 15
minutes, and sign-in answers `429 too_many_attempts` with a `Retry-After`
header until the oldest of them is 15 minutes old. A right password clears the
account's count. An unknown username takes as long to refuse as a wrong
password.

Tokens are HS256 and last 24 hours, or 30 days with `"remember": true`. There
is no refresh. The signing secret is `JWT_SECRET`; outside development the
server will not start without one of at least 32 characters. See
[Configuration](configuration.md#jwt_secret).

---

## Users

| Method | Path | Who can call it |
|---|---|---|
| GET | `/api/users` | any logged-in user; the full list for admins and user managers |
| GET | `/api/users/me` | self |
| POST | `/api/users` | admin or `can_manage_users` |
| PATCH | `/api/users/:id` | admin, or self for own fields |
| DELETE | `/api/users/:id` | admin, not self, not the primary admin |

`GET /api/users` gives an admin or user manager everyone's account:

```json
{"users":[{"id":1,"username":"admin","email":"...","displayName":"Admin",
 "createdAt":"2026-01-12 20:17:48","isAdmin":true,"isPrimaryAdmin":true,
 "canManageUsers":false,"mfaEnabled":false,"lastSignIn":"2026-11-16 09:12:03"}]}
```

Anyone else gets `id`, `username` and `displayName` only, which is what a
picker needs; no email addresses.

`POST /api/users` takes `username` (2 to 40 letters, digits, dots, dashes or
underscores), `password` (12 characters or more), and optionally `email`,
`displayName`, and `isAdmin` and `canManageUsers` (both only from an admin).
It answers `{"message":"User created","id":7}`.

`GET /api/check-auth` returns the decoded JWT merged with the database row, so
the `user` object carries both shapes at once plus the JWT's own timestamps:

```json
{"status":"ok","user":{"username":"Admin","id":1,"isAdmin":true,"canManageUsers":false,
 "iat":1788239297,"exp":1788239897,"is_admin":1,"is_primary_admin":1,
 "can_manage_users":0,"display_name":"Admin","isPrimaryAdmin":true}}
```

Read the camelCase keys. The snake_case ones are the raw row and are not a
stable contract.

---

## Permissions

| Method | Path | Who can call it |
|---|---|---|
| GET | `/api/users/:id/permissions` | self, admins and user managers |
| POST | `/api/users/:id/permissions` | admin, and not against the primary admin |

The write is a **full replacement**, not a grant. The handler deletes every
row for that user and re-inserts what you send, so to revoke one pipeline you
resend the list without it. There is no delete endpoint, and there is no
"access level". The model is seven independent booleans per target:

```json
{ "permissions": [
    { "target": "pipeline:2b5d8f3e-...", "canView": true, "canRun": true,
      "canEditYaml": false, "canEditEnv": false, "canViewResources": false,
      "canUseClaude": false, "canUseTerminal": false }
] }
```

`target` is matched case-insensitively against both `pipeline:<id>` and the
bare id, and a target of `*` acts as a wildcard fallback. Two special targets
are not pipelines at all: `global-env` gates the global environment routes,
and terminal access is only ever checked against `*`.

See [Permissions](permissions.md) for what each flag actually gates.

---

## Pipelines and builds

| Method | Path | Notes |
|---|---|---|
| GET | `/api/targets` | Filtered and sanitised per user |
| POST | `/api/run-pipeline` | Body `{"target": "<id or appName>"}` |
| GET | `/api/builds` | Currently tracked builds, filtered |
| GET | `/api/builds/history` | Returns `{"history": [...]}` |
| GET | `/api/history/:pipeline` | Returns `{"builds": [...]}`, `all` for everything |
| DELETE | `/api/history/:pipeline` | Needs write access to the pipeline |
| GET | `/api/builds/:id/logs` | Needs `view` on the build's pipeline |
| DELETE | `/api/builds/:id` | Admins only |
| POST | `/api/builds/:id/abort` | Needs `run` on the build's pipeline |
| POST | `/api/builds/:id/approve` | Releases an `approval` step. Needs `run`, and works once |
| POST | `/api/builds/:id/rollback` | Starts a new run deploying that run's images. Needs `run` |
| DELETE | `/api/clear-builds` | Admins only. Empty 200 body |
| POST | `/api/logs-stream/ticket` | A one-time ticket for the stream |
| GET | `/api/logs-stream` | SSE, see below |

The two history routes disagree on their envelope key. `/api/builds/history`
gives you `{"history": [...]}` and `/api/history/:pipeline` gives you
`{"builds": [...]}`. Both hold the same entry shape:

```json
{"id":"28a57fd8-...","buildNumber":3,"pipelineName":"FileFreak.io UI Client Production",
 "pipelineId":"8f7c3a2b-...","group":"FileFreak/Client","status":"success",
 "startTime":"2026-02-18T21:35:57.457Z","endTime":"2026-02-18T21:36:34.333Z",
 "duration":36419,"triggeredBy":"manual","activeStep":"Done","steps":[...]}
```

### GET /api/targets

Returns pipelines the caller can view, each with a computed `permissions`
object. For a non-admin without `editYaml`, the handler strips `steps`,
`kubernetes` and `filePath` from the object before sending it, so the shell
commands never reach a browser that is not allowed to edit them. This is the
sanitisation [Permissions](permissions.md) describes.

### POST /api/run-pipeline

Permitted if the caller has either legacy write access or the `run` flag.
Responds immediately with `{"message", "buildId"}`; the build itself runs
detached, once.

A pipeline with `requireConfirmation: true` is refused with
`409 {"error":"confirmation_required"}` unless the body carries
`"confirmed": true`. The app sends it after the person confirms; a script
calling the API has to send it on purpose. The two rollback routes follow the
same rule.

---

## Versions and rollback

| Method | Path | Requires |
|---|---|---|
| GET | `/api/pipelines/:targetName/versions` | `view` |
| GET | `/api/pipelines/:targetName/versions/:filename/download` | `view` |
| DELETE | `/api/pipelines/:targetName/versions/:filename` | `editYaml` |
| GET | `/api/pipelines/:targetName/rollback-plan` | `view` |
| POST | `/api/pipelines/:targetName/rollback` | `run` |

Each permission is on the pipeline named in the path. A user whose grants are
on other pipelines gets 403.

`POST .../rollback` takes `{"version", "smartRollbackYaml"?, "confirmed"?}`.
A trailing `.zip` on the version is stripped for you. Prefer
`POST /api/builds/:id/rollback`, which redeploys the images a run recorded
rather than unpacking an archive.

---

## Configuration files

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config/files` | The file tree |
| POST | `/api/config/content` | Read a file. Body `{type, path, keysOnly?}` |
| POST | `/api/config/save` | Write a file, taking a backup first |
| POST | `/api/config/upload` | multipart. Needs `editYaml` on the folder it writes to |
| POST | `/api/config/create-pipeline` | |
| POST | `/api/config/copy-pipeline` | |
| POST | `/api/config/create-folder` | |
| POST | `/api/config/delete-folder` | |
| POST | `/api/config/rename-folder` | |
| POST | `/api/config/move` | |
| GET | `/api/config/resources` | `view` on the folder; env files admins only |
| DELETE | `/api/config/resources` | `editYaml` on the folder; env files admins only |
| GET | `/api/config/global-resources` | Admins only |
| POST | `/api/config/global-resources/upload` | Admins only |
| DELETE | `/api/config/global-resources/:name` | Admins only |

A global resource is copied into every pipeline's workspace, which is why all
three of its routes are for admins.

`POST /api/config/content` is the interesting one. `type` is `yaml` or `env`,
`path` is relative to the pipelines directory, and the permission required
depends on what you asked for:

- `type: "yaml"` needs `editYaml`
- `type: "env"` needs `editEnv`
- a path containing `/resources/` needs `viewResources`
- a file outside any pipeline bundle needs admin

Pass `keysOnly: true` with `type: "env"` and someone holding only `editYaml`
can read it, but values are blanked. The handler returns `KEY1=\nKEY2=`, keys
with empty values, so the existing client parser still finds them. That is the
mechanism behind the "keys, never values" claim in
[AI assistant](ai-assistant.md).

Every write through `/api/config/save` backs up the previous file to
`versions/<name>.<ISO timestamp>.bak` in the same directory first.

---

## Global environment

Mounted at `/api/global-env`. Every route requires a permission on the literal
target `global-env`.

| Method | Path | Requires |
|---|---|---|
| GET | `/api/global-env/keys` | `view` on `global-env` |
| GET | `/api/global-env/keys-with-values` | `editEnv` on `global-env` |
| POST | `/api/global-env/set` | `editEnv` on `global-env` |
| DELETE | `/api/global-env/:key` | `editEnv` on `global-env` |

The split is deliberate: seeing that `DEPLOY_KEY` exists is a lesser privilege
than seeing what it is set to.

`/keys` answers `{"keys": [...]}` and `/keys-with-values` answers
`{"variables": [...]}`. Before the first variable is set there is no file,
and both lists are empty. A file that cannot be read is a 500.

---

## Schedules

| Method | Path | Who can call it |
|---|---|---|
| GET | `/api/schedules` | anyone; lists the schedules of pipelines they can view |
| GET | `/api/schedules/:pipeline` | `view` on the pipeline |
| POST | `/api/schedules` | `run` on the pipeline |
| DELETE | `/api/schedules/:id` | `run` on the schedule's pipeline |
| PATCH | `/api/schedules/:id/toggle` | `run` on the schedule's pipeline |

Scheduling a pipeline is running it later, so it takes the same permission as
running it now. An unknown schedule id is a 404. If the database cannot be read, the
answer is a 500, never an empty list.

---

## Settings

| Method | Path | Who |
|---|---|---|
| GET / POST | `/api/settings/smtp` | admin |
| POST | `/api/settings/smtp/test` | admin |
| GET / POST | `/api/settings/security` | admin |
| GET / POST | `/api/settings/preferences` | any logged-in user |

`/api/settings/security` is where MFA enforcement is switched on, which is what
`mfaEnforced` in `GET /api/auth/config` reports.

---

## Plugins

| Method | Path | Who |
|---|---|---|
| GET | `/api/plugins` | any logged-in user |
| POST | `/api/plugins/:id/install` | admin |

The install route is **not JSON**. It sets `Content-Type: text/plain` with
chunked encoding and streams installer output as it happens, ending with a
literal `DONE` line on success or `ERROR: <message>` on failure. Read it as a
stream and check the last line. Do not call `res.json()` on it.

---

## System

| Method | Path | Who |
|---|---|---|
| POST | `/api/system/reset` | admin |
| GET | `/health` | none, and **not** under `/api` |

`/health` returns `{"status":"ok"}`. It already exists in
`apps/server/src/app.ts`. An older version of the deployment page told you to
add it, which would have given you two.

---

## AI assistant

| Method | Path | Notes |
|---|---|---|
| GET | `/api/ai/status` | Whether an API key is configured, and which model |
| POST | `/api/ai/action` | `{action, socketId, input?}` |
| POST | `/api/ai/setup` | Reports whether a key is configured |

`action` is `spawn`, `input`, `kill`, or the two legacy names `install` and
`login`, which now answer with an explanation rather than doing anything.
`socketId` is **required**: the answer streams over Socket.IO, so a request
that does not name a socket is refused rather than silently dropped.

`input` returns **202** immediately and streams the answer over
`claude-output`, `claude-success`, `claude-error`, `claude-exit` and
`claude-init-complete`. The `claude-` prefix is a legacy event name kept so the
existing client keeps working; the engine is the Anthropic API.

**These are the only routes in the codebase that return a machine-readable
error code**, in the shape the rest of the API is meant to move to:

```json
{"error":"anthropic_key_missing",
 "message":"The assistant has no Anthropic API key. Set ANTHROPIC_API_KEY ..."}
```

Codes in use here: `sockets_unavailable`, `socket_id_required`,
`socket_not_connected`, `action_required`, `input_required`,
`anthropic_key_missing`, `unknown_action`, `ai_action_failed`.

See [AI assistant](ai-assistant.md).

---

## Terminal

| Method | Path | Notes |
|---|---|---|
| GET | `/api/terminal/check-access` | `{"hasAccess": bool}` |
| POST | `/api/terminal/create` | `{socketId}` in, `{sessionId, success}` out |
| POST | `/api/terminal/input` | Owner only |
| POST | `/api/terminal/kill` | Owner or admin |

Access is admin, or `useTerminal` on the wildcard target `*`. It is never
checked per pipeline, so granting "Use Terminal" on a single pipeline grants
nothing.

Output arrives over Socket.IO as `terminal-output`, `terminal-exit` and
`terminal-error`.

---

## Agent API

Mounted at `/api/agent`. Authenticated with an **agent token**, not a JWT.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/agent/config?path=...` | Reads a pipeline YAML |
| POST | `/api/agent/config` | Writes one. Body `{path, content}` |

Both refuse any path containing `.env` or `/env/` with 403, and the write
additionally requires a `.yaml` or `.yml` extension. This is the one place in
the codebase where env files are blocked outright rather than gated by
permission.

The write rejects an empty `content` as a missing field, so you cannot blank a
file through this route.

Tokens are managed through the JWT-authenticated routes, by admins only:

| Method | Path | Who |
|---|---|---|
| GET | `/api/agent-tokens` | admin |
| POST | `/api/agent-tokens` | admin |
| DELETE | `/api/agent-tokens/:id` | admin |

---

## Real-time: SSE for builds, Socket.IO for everything else

This is the single most misdescribed part of the old documentation, so it is
spelled out.

### Build progress: Server-Sent Events

```
POST /api/logs-stream/ticket          -> {"ticket":"...","expiresIn":30}
GET  /api/logs-stream?ticket=<ticket>    text/event-stream
```

`EventSource` cannot set headers, so the browser first trades its session for
a ticket that works once and expires in seconds, and puts that in the URL.
The session token itself is never put in a URL, where proxies and browser
history would keep it. Anything that can set a header (curl, a script) can
send `Authorization: Bearer <token>` to `/api/logs-stream` instead.

Each message is `data: {"type": "<event>", "data": <build>}`, plus an initial
`{"type":"connected"}`. The event names use **underscores**:

| `type` | When |
|---|---|
| `connected` | On subscribe |
| `build_start` | A build began |
| `progress` | A step finished, percentage moved |
| `build_complete` | Finished |
| `build_error` | Failed |
| `build_aborted` | Cancelled |

`build_paused` is emitted internally when a build stops at an `approval` step
but is **not** forwarded to this stream, so a UI watching only SSE cannot see
a build enter the waiting state. That is a gap in
`apps/server/src/routes/index.ts`, not something you have configured wrongly.

There is no `build:log` event and never has been. Log lines reach the browser
because `Logger` registers the same SSE response as a log client, not as a
distinct build event.

### Socket.IO

Used only by the AI assistant and the terminal, on the events listed in those
sections. The server registers exactly one handler on connection, for
`disconnect`. There is no `authenticate` event and no `subscribe:build` event.
Sending either does nothing.

---

## Endpoints that never existed

Previous versions of this page documented these. None of them are registered.
All six return 404, verified against a running server.

| Documented as | Reality |
|---|---|
| `POST /api/abort-pipeline` | Use `POST /api/abort` or `POST /api/builds/:id/abort` |
| `POST /api/rollback` | Use `POST /api/pipelines/:targetName/rollback` |
| `POST /api/upload-yaml` | Use `POST /api/config/upload` |
| `POST /api/upload-env` | Use `POST /api/config/save` with `type: "env"` |
| `GET` / `POST /api/env/:targetName` | Use `POST /api/config/content` and `/api/config/save` |
| `DELETE /api/pipelines/:id` | Use `POST /api/config/delete-folder` |
| `DELETE /api/users/:userId/permissions/:permissionId` | Resend the full set to `POST /api/users/:id/permissions` |

The old page also described a `read` / `write` / `admin` access-level model.
That model was replaced by the seven granular flags and nothing in the code
still speaks it, apart from a compatibility shim that maps `read` to `canView`
and `write` to `canEditYaml`.

---

## Rate limiting and versioning

`POST /api/login` is rate limited: after 10 failed attempts on one account, or
30 from one address, within 15 minutes, it answers
`429 {"error":"too_many_attempts"}` with a `Retry-After` header in seconds. A
successful login clears the count for that account. Nothing else is limited.

The API carries no version prefix.

---

[Back to the documentation index](README.md)
