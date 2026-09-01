# Development

Working on EZPIPELINE itself: getting a loop running, where things live, how
to add the four things people usually need to add, and the conventions this
codebase is being brought to.

---

## Getting a loop running

```bash
npm install
npm run init
npm run start
```

Server on 5001 under `tsx watch`, client on 5000 under Vite with HMR. See
[Setup](setup.md) for prerequisites; the important one is **Node 20 or
newer**, because `better-sqlite3` 12.5 has no prebuilt binary for Node 18.

Run the halves separately when you only care about one:

```bash
npm run dev:server
npm run dev:client
```

Typecheck without emitting:

```bash
cd apps/server && npx tsc --noEmit
cd apps/client && npx tsc --noEmit -p tsconfig.app.json
```

Both are clean as of this writing.

---

## Where things live

```
apps/server/src/
  server.ts          entry point: migrations, routes, Socket.IO, static files
  app.ts             the Express app: CORS, JSON, logging, /health
  routes/
    index.ts         most of the API. ~1,970 lines
    ai.ts            assistant
    agent.ts         agent-token API
    terminal.ts      interactive shell
    globalEnv.ts     global environment
  controllers/
    EZPipelineController.ts   pipeline discovery and execution. ~1,200 lines
    ConfigController.ts       file tree, reads, writes, scaffolding
    SystemController.ts
    Logger.ts                 Winston, redaction, SSE log clients
  services/          one class each, mostly singletons
  middleware/auth.ts
  migrations/        001..007
  config/index.ts    reads ezpipeline.config.json and .env
  types/

apps/client/src/
  pages/             DashboardPage, LoginPage, SettingsPage, SetupPage, DocsPage
  components/
  contexts/          Auth, Theme, Toast, Confirmation, Preferences
  config/api.ts      the API base URL
  data/documentation/  the in-app docs, see the warning below
```

### Dead files, so you do not go looking

| Path | Status |
|---|---|
| `apps/server/src/index.ts` | Zero bytes |
| `apps/server/src/types/yaml/index.ts` | Stale `EZPIPELINEYAML`. Only `KubernetesConfig` is imported from it |
| `apps/server/src/services/ClaudeManager.ts` | Nothing imports it since the assistant moved to the Anthropic API |
| `apps/server/ai_sandbox/` | The old CLI install and its `INSTRUCTIONS.md`. Not loaded |
| `apps/client/dist/` | Stale. The client builds into `apps/server/public` |

### The in-app docs are a second copy

`apps/client/src/data/documentation/*.ts` holds the documentation shown at
`/docs` in the running app, as hardcoded TypeScript strings. It is **not**
generated from this `docs/` directory.

So there are two documentation corpora that can disagree:

| Corpus | Read by |
|---|---|
| `docs/*.md` | Humans, and the AI assistant's `read_documentation` tool |
| `apps/client/src/data/documentation/*.ts` | The in-app Docs page |

This documentation pass corrected the first. The second still carries the old
claims, including `LOG_LEVEL` and `LOG_FILE` as working variables. Reconciling
them means editing `apps/client`, which this page's author does not own; it is
in the handover notes.

---

## Conventions

These are the standards this repository is being brought to. They are notch.fm's,
and the code is partway there.

### Relative imports carry `.js`

The server is ESM TypeScript. Relative imports must end in `.js`, referring to
the emitted file:

```ts
import { DatabaseService } from "./services/Database.js";   // yes
import { KubernetesConfig } from "../types/yaml";           // no
```

Two imports currently break this, both in
`apps/server/src/controllers/EZPipelineController.ts`:

```ts
import { KubernetesConfig } from "../types/yaml";
import { Build } from "../types/other";
```

They do not fail today because both are type-only, so TypeScript erases them
and no runtime import is emitted. Verified: neither appears in the compiled
output. They become real breakage the moment either module gains a value
export.

### Error shapes

An error should be a stable machine-readable code **with a human sentence
alongside**:

```ts
res.status(503).json({
  error: "anthropic_key_missing",
  message: "The assistant has no Anthropic API key. Set ANTHROPIC_API_KEY ...",
});
```

A bare code the interface cannot explain is a bug. So is a bare sentence, for
the opposite reason: nothing can branch on it.

`routes/ai.ts` does this correctly. The other route files do not: across
`apps/server/src` there are 165 JSON error responses and **none** carry a
code. They are prose only, so a client that needs to distinguish "wrong
password" from "user not found" is matching on English.

The client currently just displays `data.error` in a toast, at 27 call sites,
so this is not causing bugs today. It is the thing to fix when you touch a
route: add the code, keep the message.

### Never return an empty array to signal failure

An empty array means "there are no results". A failure means "I do not know".
Collapsing the second into the first destroys the difference and the caller
cannot recover it.

Current violations:

| Location | What it does |
|---|---|
| `SchedulerService.getAllSchedules()` | Catches a DB error, logs, returns `[]` |
| `SchedulerService.getSchedulesForPipeline()` | The same |
| `ConfigController.getGlobalEnvKeys()` | Returns `[]` when the file is missing |
| `ConfigController.getGlobalEnvKeysWithValues()` | The same |
| `ConfigController.getFiles()` and two loaders in `EZPipelineController` | Return `[]` for a missing directory |

The first two are the serious ones, and they have a visible consequence: the
route handler around them has a `try/catch` returning 500, which can never
fire, because the service already swallowed the error. A broken database
surfaces to the browser as `200 {"schedules": []}` and the UI says you have no
schedules.

Throw instead, and let the caller decide.

`AnthropicAssistant.ts` is the model here. Every tool returns a labelled
outcome, with a comment saying why: a tool answering `[]` on failure would be
indistinguishable from one answering "nothing matched", and the model would
confidently report the wrong one.

### Comments explain why, and what was rejected

Not what the syntax does. The density is high on purpose. The newer files in
`services/` and the Docker files are the reference.

There is a variety to avoid, and this codebase has some of it: thinking-aloud
left in place. `ConfigController.copyPipelineBundle` is eight lines of
reasoning ending in `throw new Error("Use copyPipelineBundleFromPath
instead")`, and the `keysOnly` branch in `routes/index.ts` works through three
options in comments before picking one. Keep the conclusion and the rejected
alternative; delete the deliberation.

### No em dashes

Anywhere: code, comments, documentation, UI copy. Use a spaced hyphen. A sweep
removed 2,369 of them from notch.fm because they read as machine-written.

EZPIPELINE is currently clean. Verified across `apps/server/src`,
`apps/client/src`, `scripts/`, `docs/` and `README.md`: zero U+2014 and zero
U+2013.

### Never let the interface assert something the code cannot deliver

The clearest past failure was `docs/ai-assistant.md`, which promised strict
filesystem sandboxing for an agent running with
`--dangerously-skip-permissions`. The promise was enforced by a paragraph of
prompt text. The rule applies to error messages, UI labels and documentation
equally.

---

## How to add things

### Adding an API endpoint

1. Add the handler in `apps/server/src/routes/index.ts`, or the relevant
   sub-router.
2. **Check permissions in the handler.** Roughly a third of existing routes do
   not, and it is the single most common defect in this codebase. Use
   `PermissionsService.getInstance().checkPermission(userId, target, perm)`.
3. Return `{error: "snake_case_code", message: "sentence"}` on failure.
4. Update [API reference](api-reference.md).

**Check the path is not already registered.** `routes/index.ts` registers four
paths twice, and Express silently uses the first match. The admin guards on
`DELETE /schedules/:id` and `PATCH /schedules/:id/toggle` are dead code because
of it. To check:

```bash
grep -n '^router\.\(get\|post\|put\|patch\|delete\)' apps/server/src/routes/index.ts \
  | sed 's/^\([0-9]*\):router\.\([a-z]*\)("\([^"]*\)".*/\2 \3/' \
  | sort | uniq -d
```

### Adding a migration

There is **no migration runner** and no `migrations/index.ts`. Older
documentation said to "add it to the migration runner"; there is nothing to
add it to.

1. Create `apps/server/src/migrations/008_your_change.ts` exporting one named
   function.
2. Import it in `apps/server/src/server.ts` and call it inside its own
   `try/catch`, following the seven already there.

```ts
import { migrateYourChange } from "./migrations/008_your_change.js";

try {
    migrateYourChange();
} catch (e) {
    Logger.getInstance().warn(`Your change migration skipped or already applied: ${e}`);
}
```

Migrations must be idempotent. They run on every boot and the `catch` only
logs. The established pattern is to inspect `PRAGMA table_info(...)` and
return early if the change is already present. Migration 001 is worth reading
before you write a destructive one: it drops and recreates the `permissions`
table, and the check that stops it doing that a second time is the only thing
standing between a restart and total permission loss.

Note also that `services/Database.ts` creates tables inline with
`CREATE TABLE IF NOT EXISTS` and a run of bare `ALTER TABLE` calls wrapped in
empty `catch` blocks. New columns can go either there or in a migration; the
existing split is historical, not principled.

### Adding a page

1. Component under `apps/client/src/pages/`.
2. Route in `apps/client/src/App.tsx`.
3. Navigation if it needs it.

### Changing pipeline execution

`apps/server/src/controllers/EZPipelineController.ts`:

| Method | What it does |
|---|---|
| `run()` | The main loop |
| `runCommandLive()` | Spawns a step and streams its output |
| `interpolateEnv()` | `${VAR}` and `${RESOURCES/file}` |
| `deployToKubernetes()` | `kubectl apply` |
| `generateRollbackPlan()` | Decides which steps a rollback skips |

Two known bugs in here, both reported and neither fixed by this pass:

- A pipeline's `.env` is loaded by assigning onto the server's own
  `process.env`, so values leak into subsequent builds.
- The `EZPIPELINEYAML` interface is declared here **and** in `types/yaml`,
  and the two disagree. This one is authoritative.

---

## Testing

There is no test suite. No Jest, no Vitest, no Playwright, no test script in
any `package.json`. Testing is manual.

Saying so plainly is more useful than a "Future: Automated Testing" heading
that has been there since the beginning.

What to exercise by hand when you change something:

- Log in, log out, and log in as a **non-admin**. Most authorization defects
  in this codebase are invisible when you test as an admin, because
  `PermissionsService` short-circuits every check for them.
- Run a pipeline and watch the SSE stream. Progress arrives on
  `/api/logs-stream`, not over Socket.IO.
- Try a route with no token and with a garbage token. Note that 401 and 403
  come back as `text/plain`, not JSON.

A useful trick for the non-admin case, on a development instance: the JWT
secret falls back to a known string, so you can mint a token for any user id
without knowing their password.

```bash
node -e 'console.log(require("jsonwebtoken").sign(
  {username:"someone",id:2,isAdmin:false},
  process.env.JWT_SECRET || "ezpipeline-secret-key",
  {expiresIn:"10m"}))'
```

That this works at all is the argument for setting `JWT_SECRET` in anything
that is not a laptop.

---

## Contributing

Branch, change, test by hand, commit with a conventional prefix
(`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`), push, open a PR.

If you change an API route, update [API reference](api-reference.md) in the
same commit. That page drifted far enough from the code to document six
endpoints that had never existed, and it drifted one commit at a time.

---

[Back to the documentation index](README.md)
