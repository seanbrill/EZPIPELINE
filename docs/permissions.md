# Permissions and access control

EZPIPELINE's permission model exists to answer one question: can this person
run this pipeline without also being able to change what it does? Editing a
pipeline's YAML means editing shell commands that run on the server, so "can
deploy" and "can rewrite the deploy script" have to be separable. That is why
there are seven independent flags rather than three access levels.

Every route that reads or changes a pipeline checks the flag its action needs;
[Which routes check what](#which-routes-check-what) lists them.

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

**Use Claude lets the assistant act for you, never beyond you.** Each tool
call is checked against the pipeline it touches: the assistant can read or
change a pipeline's YAML only where you have `editYaml` and Use Claude, set its
variables only where you have `editEnv` and Use Claude, and it lists only the
pipelines and builds you can view. Global variables follow your `global-env`
permissions. See [AI assistant](ai-assistant.md#what-it-cannot-do).

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
what you sent, so the list you send is the whole of what they can do. To
revoke one pipeline, send the list without it. Read the current set first and
change that, as the People screen does.

Only admins can write permissions, and not against the primary admin.
`GET /api/users/:id/permissions` answers for yourself, or for anyone if you
are an admin or manage users.

---

## What the interface does with them

The client hides what you cannot use, and the server makes sure hiding is not
the only protection.

**Tabs disappear.** Without `editYaml` the Code tab is not rendered.

**Data is stripped server-side.** `GET /api/targets` computes the caller's
flags per pipeline and, for a non-admin without `editYaml`, removes `steps`,
`kubernetes` and `filePath` from the object before serialising it. The
commands are not hidden in the browser, they never arrive. This is the part of
the model that is implemented most carefully, and it does work: verified by
calling `/api/targets` with tokens for two different users.

**Buttons disable.** Run and similar actions are hidden or disabled without
the matching flag, and the server checks again on the request.

---

## Which routes check what

Each permission is checked against the pipeline the request is about; for a
build, schedule or version, that is the pipeline it belongs to.

| Needs | Routes |
|---|---|
| `view` | the pipeline, its builds and their logs, its versions, its schedules, its rollback plan |
| `run` | run, abort, approve, both rollbacks, and adding, removing or pausing a schedule |
| `editYaml` | reading and saving the YAML, uploading into the pipeline's folder, deleting a version |
| `editEnv` | reading values from and writing the pipeline's `.env` |
| `viewResources` | reading files under the pipeline's `resources/` |
| admin | users' admin flags, agent tokens, global resources, clearing all builds, deleting a single build, settings |

`GET /api/users` answers anyone signed in, but only admins and user managers
see other people's emails. The [API reference](api-reference.md) lists the
requirement beside every route.

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
