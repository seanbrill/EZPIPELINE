# Authentication

How EZPIPELINE decides who you are. For what you are then allowed to do, see
[Permissions](permissions.md).

---

## The short version

Password checked with bcrypt, then a 24 hour HS256 JWT, kept in the browser's
`localStorage`, sent as `Authorization: Bearer`. Optionally an emailed
six-digit code in front of that. Separately, long-lived **agent tokens** for
scripts.

One thing to get right before anything else: **set `JWT_SECRET`**. Without it
the server signs tokens with a string committed to this repository, and anyone
who knows it can mint an admin token. Nothing warns you. See
[Configuration](configuration.md#jwt_secret).

---

## The first user

The setup page works only while the `users` table is empty.

```
POST /api/setup
{ "username": "admin", "password": "secret", "email": "you@example.com" }
```

The account created is the **primary admin**, flagged `is_primary_admin` in
the database. It is stronger than an ordinary admin in exactly one way: no
one, including other admins, can delete or demote it. That exists so an
instance cannot be locked out of itself.

`email` is optional here, and becomes necessary later if you enforce MFA,
because codes have nowhere else to go.

Check the state:

```bash
curl -s localhost:5001/api/setup-status
# {"initialized": true}      false means no users exist yet
```

---

## Logging in

```
POST /api/login
{ "username": "...", "password": "...", "deviceToken": "..." }
```

`deviceToken` is optional and identifies a device previously marked as
trusted.

The response depends on the system MFA setting and the account's own state,
and there are four shapes. A client that handles only the first will appear to
break for some users.

| Response contains | Meaning | What to do |
|---|---|---|
| `token`, `username`, `isAdmin`, `canManageUsers` | Normal login | Store the token |
| `mfaRequired: true` | A code was emailed | Collect it, `POST /api/auth/mfa/verify` |
| `mfaSetupRequired: true` | MFA enforced, account has an email but has not enrolled | Walk them through setup |
| `emailSetupRequired: true` | MFA enforced, account has **no** email | The `token` given is restricted |

That last token is scoped `setup-email`, lives one hour, and the middleware
rejects it on every path except `/auth/setup/...`. Its only purpose is letting
someone attach an email address so they can then receive codes. From the
outside it looks like a login that half worked; it is deliberate.

Passwords are bcrypt with 10 rounds, and at least 12 characters.

Failed sign-ins are limited: 10 on one account, or 30 from one address, within
15 minutes, and the next attempt answers `429 too_many_attempts` with a
`Retry-After` header. A successful sign-in clears the account's count. A
username that does not exist takes as long to refuse as a wrong password, so
the timing does not say which accounts exist.

---

## Multi-factor, by email

Not TOTP. There is a `mfa_secret` column that suggests otherwise; the
implemented flow is a six-digit numeric code sent by SMTP.

1. Login sees MFA is enforced and the account is enrolled.
2. A six-digit code is generated, stored on the user row with a **ten minute**
   expiry, and emailed.
3. The response is `{mfaRequired: true, username, emailMasked}`. There is no
   token yet.
4. `POST /api/auth/mfa/verify` with the code returns the real token.
5. `POST /api/auth/mfa/resend` sends a new one.

Trusted devices live in the `user_devices` table. A matching `deviceToken`
skips the challenge and its `last_used_at` is refreshed.

Enforcement is system-wide, set under Settings, stored as `mfa_enforced` in
the `settings` table, and reported by `GET /api/auth/config`.

MFA needs working SMTP. Configure it under Settings, or through the `SMTP_*`
variables in `.env`, and use the test button before you enforce it. Enforcing
MFA with broken email locks everyone out, including you.

---

## Tokens

| | |
|---|---|
| Algorithm | HS256 |
| Lifetime | 24 hours, hardcoded |
| Refresh | none |
| Storage | browser `localStorage` |
| Secret | `JWT_SECRET`, falling back to a constant in the repository |

The payload carries `username`, `id`, `isAdmin` and `canManageUsers`.

On every protected request the middleware verifies the signature **and
re-reads the user row from the database**. Two useful consequences:

- Deleting a user invalidates their outstanding tokens immediately. There is
  no revocation list because none is needed.
- The claims in the token are not trusted for authorization. `isAdmin` is
  recomputed from the row.

The merged result is what `GET /api/check-auth` returns, which is why it
contains both camelCase and snake_case keys plus the JWT's own `iat` and
`exp`. Read the camelCase ones.

### Storage

`localStorage`, so the token is readable by any script running on the page.
`httpOnly` cookies would be better and are not implemented.

---

## Agent tokens

A second, separate credential for scripts. They authenticate **only** the
routes under `/api/agent`, and a user JWT does not open those routes.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/agent-tokens` | List them |
| POST | `/api/agent-tokens` | Mint one. The value is shown once |
| DELETE | `/api/agent-tokens/:id` | Revoke |

Stored hashed in the `agent_tokens` table, with a name, a scope string and a
`last_used_at` that is updated on each use.

All three are for admins only.

What an agent token can reach is narrow, and narrower than a user JWT:

```
GET  /api/agent/config?path=...     read a pipeline YAML
POST /api/agent/config              write one
```

Both refuse any path containing `.env` or `/env/` outright, and the write also
requires a `.yaml` or `.yml` extension. This is the only place in the codebase
where environment files are blocked entirely rather than gated by permission.

---

## Managing users

| Method | Path | Who |
|---|---|---|
| GET | `/api/users` | anyone signed in; everyone else's email only for admins and user managers |
| POST | `/api/users` | admin or `can_manage_users` |
| PATCH | `/api/users/:id` | admin, or self |
| POST | `/api/users/:id/password` | admin, for someone else |
| DELETE | `/api/users/:id` | admin, not self, not the primary admin |
| POST | `/api/change-password` | self, with the current password |

`POST /api/users` takes `username`, `password`, and optionally `email`,
`displayName`, `isAdmin` and `canManageUsers` (those two only from an admin).
It answers `{"message":"User created","id":7}`.

### Resetting someone else's password

There is no reset by email. An admin sets a new one:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"newPassword":"at-least-twelve-characters"}' \
  localhost:5001/api/users/7/password
```

Give it to the person by a channel you trust, and have them change it under
Account. Nobody can set the primary admin's password but the primary admin.

---

## Turning authentication off

```json
"auth": { "required": false }
```

in `ezpipeline.config.json`. The middleware then stops verifying anything and
injects a synthetic primary admin into every request, while
`PermissionsService` short-circuits every check to `true`.

One switch, both layers, everyone who can reach the port. Nothing in the
interface indicates it is off.

---

## What is not built in

| | |
|---|---|
| Password reset by email | Not built. An admin sets a new password, above |
| Token refresh | None. Tokens last 24 hours, then you sign in again |
| `httpOnly` cookie storage | No. The token is kept in `localStorage` |
| TOTP or hardware MFA | Not built. Codes are sent by email |
| SSO, OIDC, LDAP | None |

Sign-ins and every change made through the API are recorded in the audit log,
which admins read under Settings (`GET /api/admin/audit`).

---

## The tables

Dumped from a live database, not transcribed.

**users**

| Column | Notes |
|---|---|
| `id` | PK |
| `username` | unique, not null |
| `password` | bcrypt hash. Not `password_hash` |
| `email` | |
| `mfa_enabled` | |
| `mfa_secret` | present, unused |
| `mfa_code`, `mfa_expires` | the current emailed code |
| `is_admin` | |
| `is_primary_admin` | migration 001 |
| `display_name` | migration 001 |
| `can_manage_users` | migration 003 |
| `pending_email` | migration 005 |
| `created_at` | |

**user_devices**: trusted devices, `device_token`, `last_used_at`.

**agent_tokens**: `name`, `token_hash`, `scopes`, `created_at`,
`last_used_at`.

**settings**: key/value. `mfa_enforced` lives here.

**permissions**: see
[Permissions](permissions.md). There is no `access_level` column.

---

## Hardening checklist

- [ ] `JWT_SECRET` set to a long random value
- [ ] `auth.required` is `true`
- [ ] HTTPS everywhere
- [ ] SMTP tested **before** MFA is enforced
- [ ] `chmod 600 apps/server/data/app.db`
- [ ] You know `useTerminal` is a shell on the host, and `useClaude` is edit
      access to every pipeline's YAML and environment
- [ ] You have read [which routes check what](permissions.md#which-routes-check-what)

---

[Back to the documentation index](README.md)
