# Permissions and access control

EZPIPELINE's permission model exists to answer one question: can this person
run this pipeline without also being able to change what it does? Editing a
pipeline's YAML means editing shell commands that run on the server, so "can
deploy" and "can rewrite the deploy script" have to be separable. That is why
there are seven independent flags rather than three access levels.

Read [Where nothing is checked](#where-nothing-is-checked) before you rely on
this model. Several parts of the API do not consult it at all.

---

## Roles

### Primary admin

The first user created during setup. Marked `is_primary_admin` in the
database. Nobody, including other admins, can delete or demote them. This
exists so an instance cannot be locked out of itself.

### Admin

`is_admin = 1`. Bypasses every permission check in `PermissionsService`, sees
every pipeline, manages users, changes global settings, installs plugins.

### User manager

`can_manage_users = 1` without `is_admin`. Can create and update users, but
cannot grant admin. A separate flag from the seven pipeline permissions.

### Standard user

Sees nothing until permissions are granted. A new account with no rows in the
`permissions` table gets an empty pipeline list, not an error.

---

## The seven flags

Each is an independent boolean on a `(user_id, target)` row. There is no
implication between them: `can_run` without `can_view` is a legal, if odd,
combination, and `can_view` does **not** imply `can_run`.

| Permission | Column | `PermissionType` | What it gates |
|---|---|---|---|
| View | `can_view` | `view` | Seeing the pipeline at all, its history and status |
| Run | `can_run` | `run` | Triggering builds |
| Edit YAML | `can_edit_yaml` | `editYaml` | The Code tab. **This is shell command access** |
| Edit environment | `can_edit_env` | `editEnv` | The Environment tab, and reading `.env` values |
| View resources | `can_view_resources` | `viewResources` | Files under a pipeline's `resources/` |
| Use Claude | `can_use_claude` | `useClaude` | The AI assistant |
| Use terminal | `can_use_terminal` | `useTerminal` | An interactive shell on the host |

Two of these are much larger than they look.

**Edit YAML is remote code execution.** Anyone who can change a step's `run`
value can make the server execute anything, as the server's user. It is not a
content permission, it is a privilege grant.

**Use terminal is a shell on the host.** There is no way to narrow it: the
terminal routes only ever check this flag against the wildcard target, so it is
all-or-nothing across the whole instance.

**Use Claude is roughly `editYaml` plus `editEnv` everywhere.** The assistant
can read and write pipeline YAML, read env keys and set env values, and the
tools do not filter by the calling user's per-pipeline permissions. It used to
be worse: under the old Claude Code CLI engine it was effectively shell access
on the host, because that process ran with `--dangerously-skip-permissions`.
That is no longer the case. See
[AI assistant](ai-assistant.md#what-changed-and-why-it-matters).

The code name is `view`, not `read`. An older version of this page listed
`read` / `can_view`; there is no `read` value in the `PermissionType` union.

---

## Targets

The `target` column is a string, matched case-insensitively in this order:

1. exact match on `pipeline:<id>` or on the bare id
2. failing that, a row with target `*`, used as a wildcard fallback

Two targets are not pipelines:

| Target | Meaning |
|---|---|
| `global-env` | Gates `/api/global-env/*`. `view` lists key names, `editEnv` reveals values and allows writes |
| `*` | Wildcard. Also the **only** target consulted for terminal access |

That last point is a real limitation rather than a design choice: the terminal
routes check `useTerminal` against `"*"` and nothing else. Granting "Use
Terminal" on one pipeline in the UI therefore grants nothing. To give someone
terminal access you must give them a wildcard row.

---

## Granting and revoking

There is one endpoint and it **replaces the whole set**:

```
POST /api/users/:id/permissions
{ "permissions": [ { "target": "...", "canView": true, ... } ] }
```

The handler deletes every row for that user inside a transaction and inserts
what you sent. To revoke one pipeline, send the list without it. There is no
per-permission delete endpoint, and any client that sends a partial list will
silently strip everything it left out.

Only admins can write permissions, and not against the primary admin.

**Reading is not restricted.** `GET /api/users/:id/permissions` checks only
that you are logged in, so any user can enumerate any other user's grants.
Verified against a running server with a non-admin token.

---

## What the interface does with them

The client hides what you cannot use, and the server makes sure hiding is not
the only protection.

**Tabs disappear.** Without `editYaml` the Code tab is not rendered.

**Data is stripped server-side.** `GET /api/targets` computes the caller's
flags per pipeline and, for a non-admin without `editYaml`, removes `steps`,
`env`, `kubernetes` and `filePath` from the object before serialising it. The
commands are not hidden in the browser, they never arrive. This is the part of
the model that is implemented most carefully, and it does work: verified by
calling `/api/targets` with tokens for two different users.

**Buttons disable.** Run and similar actions are hidden or disabled without
the matching flag, and the server checks again on the request.

---

## Where nothing is checked

The flags above are only as good as the routes that consult them. Roughly a
third of the API does not. These are the consequential ones, all verified by
reading the handlers, and the first two also verified over HTTP against a
running server:

| Route | Who can actually call it |
|---|---|
| `GET /api/pipelines/:target/versions` | any logged-in user, any pipeline |
| `GET /api/pipelines/:target/versions/:file/download` | any logged-in user, any pipeline |
| `DELETE /api/pipelines/:target/versions/:file` | any logged-in user |
| `POST /api/pipelines/:target/rollback` | any logged-in user. **This runs a pipeline** |
| `GET /api/users` | any logged-in user, full list with emails |
| `GET /api/users/:id/permissions` | any logged-in user, any user |
| `POST /api/agent-tokens` | any logged-in user |
| `DELETE /api/schedules/:id` | any logged-in user |
| `PATCH /api/schedules/:id/toggle` | any logged-in user |
| `POST /api/builds/:id/approve` | any logged-in user |
| `GET /api/builds/:id/logs` | any logged-in user |

The two schedule routes are the strangest, because an admin check for both
*was* written. It sits at lines 1501 and 1555 of
`apps/server/src/routes/index.ts` and never executes, because unguarded
handlers for the same paths are registered at lines 175 and 185 and Express
uses the first match.

`viewResources` is the permission that ought to cover artifact download. It
exists, and `/api/config/content` consults it. The versions routes do not.

All of the above are reported as code changes needed in `apps/`. They are not
fixed here because the author of this documentation does not own that
directory.

---

## Turning authentication off entirely

`ezpipeline.config.json` has:

```json
"auth": { "required": true, "defaultUser": { "username": "admin", "isAdmin": true } }
```

Set `required` to `false` and the auth middleware stops verifying tokens and
injects a synthetic primary admin into every request. `PermissionsService`
short-circuits every check to `true`. This is one switch that removes all
authentication and all authorization at once, for everyone who can reach the
port. It is not a development-only flag and nothing warns you.

---

## Persistence and migration

Permissions live in the `permissions` table and survive restarts. Migration
001 converted an older `access` column of `read` / `write` strings into the
granular flags, mapping `read` to view plus run, and `write` to everything. It
detects an already-granular table and skips rather than re-running, which is
what stops it destroying the data on the second boot.

A compatibility shim, `checkAccess()`, still speaks the old vocabulary
internally: `read` maps to `canView` and `write` maps to `canEditYaml`. Some
routes still call it. It is not exposed in the API.

---

[Back to the documentation index](README.md)
