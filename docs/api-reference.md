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

### Error shapes are not uniform

Three different shapes come out of this server, and a client has to handle
all three.

| Situation | Status | Body |
|---|---|---|
| A handler rejected the request | 4xx / 5xx | `{"error":"Human sentence"}` |
| No token, bad token, or user deleted | 401 / 403 | `text/plain`: `Unauthorized` / `Forbidden` |
| Unknown path under `/api` | 200 | the SPA's `index.html` |

The second and third are worth dwelling on.

**401 and 403 from the auth middleware are plain text, not JSON.** They come
from `res.sendStatus()` in `apps/server/src/middleware/auth.ts`, which sends
the status text as the body. Parsing them as JSON throws.

**A mistyped API path returns HTML with status 200.** The SPA catch-all in
`server.ts` serves `index.html` for any GET it does not recognise, and only
returns `{"error":"Not Found"}` when the request's `Accept` header excludes
HTML. A browser `fetch()` sending `Accept: */*` gets a 200 and a page of
HTML. Verified:

```
$ curl -s -o /dev/null -w "%{http_code} %{content_type}\n" localhost:5001/api/nope
200 text/html; charset=utf-8

$ curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
    -H "Accept: application/json" localhost:5001/api/nope
404 application/json; charset=utf-8
```

If you are writing a client, send `Accept: application/json`. Otherwise a typo
in a URL looks like a successful request.

None of the 165 JSON error bodies carry a machine-readable code; they are
prose only. To branch on a specific failure you are matching on English. See
[the conventions note in Development](development.md#error-shapes).

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

Tokens are HS256, expire in 24 hours, and there is no refresh. The signing
secret is `JWT_SECRET`, which **falls back to the literal string
`ezpipeline-secret-key` when unset**. See
[Configuration](configuration.md#jwt_secret).

---

## Users

| Method | Path | Who can call it |
|---|---|---|
| GET | `/api/users` | **any logged-in user** |
| GET | `/api/users/me` | self |
| POST | `/api/users` | admin or `can_manage_users` |
| PATCH | `/api/users/:id` | admin, or self for own fields |
| DELETE | `/api/users/:id` | admin, not self, not the primary admin |

`GET /api/users` has no role check. Verified: a non-admin token returns the
full list with every username and email address.

```json
{"users":[{"id":1,"username":"Admin","email":"...","created_at":"2026-01-12 20:17:48",
 "isAdmin":true,"canManageUsers":false}]}
```

Note what is **not** there: no `display_name`. The column exists but this
route does not select it.

`POST /api/users` accepts only `{username, password, isAdmin}`. If you send
`displayName` or `canManageUsers` they are silently dropped, because the
INSERT lists three columns. It responds `{"message":"User created"}` with no
id, so you cannot learn the new user's id from the response. List users again.

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
| GET | `/api/users/:id/permissions` | **any logged-in user, for any user** |
| POST | `/api/users/:id/permissions` | admin, and not against the primary admin |

There is no read-side authorization here. Verified: a non-admin can read the
permission set of any account, including admins.

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
| DELETE | `/api/history/:pipeline` | |
| GET | `/api/builds/:id/logs` | No permission check |
| DELETE | `/api/builds/:id` | |
| POST | `/api/abort` | Body `{"id"}` |
| POST | `/api/builds/:id/abort` | No permission check |
| POST | `/api/builds/:id/approve` | Releases an `approval` step, no permission check |
| DELETE | `/api/clear-builds` | Empty 200 body, no permission check |
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
`env`, `kubernetes` and `filePath` from the object before sending it, so the
shell commands never reach a browser that is not allowed to edit them. This
one does work as advertised: it is the sanitisation
[Permissions](permissions.md) describes.

### POST /api/run-pipeline

Permitted if the caller has either legacy write access or the `run` flag.
Responds immediately with `{"message", "buildId"}`; the build itself runs
detached.

**This handler starts the pipeline twice.** It calls
`EZPipelineController.instance.run(...)` directly and then schedules the same
call again inside `setImmediate`. That is a bug in
`apps/server/src/routes/index.ts`, not a feature, and it is not fixed here
because this page's author does not own `apps/`. Expect duplicated step
output until it is.

`requireConfirmation` in a pipeline's YAML is honoured by the **browser
only**. This endpoint does not check it, so anything calling the API directly
bypasses the confirmation entirely.

---

## Versions and rollback

| Method | Path |
|---|---|
| GET | `/api/pipelines/:targetName/versions` |
| GET | `/api/pipelines/:targetName/versions/:filename/download` |
| DELETE | `/api/pipelines/:targetName/versions/:filename` |
| GET | `/api/pipelines/:targetName/rollback-plan` |
| POST | `/api/pipelines/:targetName/rollback` |

**None of these five check permissions.** They require a valid JWT and nothing
else. Any logged-in user can list, download and delete the build artifacts of
any pipeline, and can trigger a rollback, which executes the pipeline.

Verified against a running server with a non-admin token whose only grant was
on an unrelated pipeline:

```
$ curl -H "Authorization: Bearer $NONADMIN" \
    .../api/pipelines/8f7c3a2b-.../versions
200 {"versions":[{"name":"1.0.0.zip","size":210738390,...}]}

$ curl -r 0-64 -H "Authorization: Bearer $NONADMIN" \
    .../api/pipelines/8f7c3a2b-.../versions/1.0.0.zip/download
status=206 type=application/zip
```

The `viewResources` permission exists and is checked elsewhere. It is simply
not consulted here. Until that is fixed, treat "can log in" as "can read every
build artifact on the box".

`POST .../rollback` takes `{"version", "smartRollbackYaml"?}`. A trailing
`.zip` on the version is stripped for you.

---

## Configuration files

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config/files` | The file tree |
| POST | `/api/config/content` | Read a file. Body `{type, path, keysOnly?}` |
| POST | `/api/config/save` | Write a file, taking a backup first |
| POST | `/api/config/upload` | multipart, no permission check |
| POST | `/api/config/create-pipeline` | |
| POST | `/api/config/copy-pipeline` | |
| POST | `/api/config/create-folder` | |
| POST | `/api/config/delete-folder` | |
| POST | `/api/config/rename-folder` | |
| POST | `/api/config/move` | |
| GET | `/api/config/resources` | No permission check |
| DELETE | `/api/config/resources` | No permission check |
| GET | `/api/config/global-resources` | No permission check |
| POST | `/api/config/global-resources/upload` | No permission check |
| DELETE | `/api/config/global-resources/:name` | |

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

Both GETs return `[]` when the global env file does not exist, which is
indistinguishable from a file that exists and is empty. See
[the empty-array note in Development](development.md#never-return-an-empty-array-to-signal-failure).

---

## Schedules

| Method | Path | Who can call it |
|---|---|---|
| GET | `/api/schedules` | any logged-in user |
| GET | `/api/schedules/:target` | any logged-in user |
| POST | `/api/schedules` | admin |
| DELETE | `/api/schedules/:id` | **any logged-in user** |
| PATCH | `/api/schedules/:id/toggle` | **any logged-in user** |

Delete and toggle look guarded if you search the file, because there is an
admin check on both further down. It never runs. Each path is registered
twice, and Express uses the first handler that matched:

| Path | First registration | Second |
|---|---|---|
| `DELETE /schedules/:id` | line 175, no check, **this one runs** | line 1501, admin-only, dead |
| `PATCH /schedules/:id/toggle` | line 185, no check, **this one runs** | line 1555, admin-only, dead |

Reported, not fixed, for the same reason as above.

A database failure while listing schedules is swallowed inside
`SchedulerService` and surfaces as `200 {"schedules": []}`, so "the database is
broken" and "you have no schedules" look identical from outside.

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

Tokens are managed through the JWT-authenticated routes:

| Method | Path | Who |
|---|---|---|
| GET | `/api/agent-tokens` | **any logged-in user** |
| POST | `/api/agent-tokens` | **any logged-in user** |
| DELETE | `/api/agent-tokens/:id` | **any logged-in user** |

No admin check on any of the three. Any account that can log in can mint an
agent token.

---

## Real-time: SSE for builds, Socket.IO for everything else

This is the single most misdescribed part of the old documentation, so it is
spelled out.

### Build progress: Server-Sent Events

```
GET /api/logs-stream?token=<jwt>
```

The token goes in the query string because `EventSource` cannot set headers.
A small shim at the top of the handler copies it into an `Authorization`
header before the normal middleware runs.

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

Neither exists. There is no rate limit on `/api/login` or anywhere else, and
the API carries no version prefix.

---

[Back to the documentation index](README.md)
