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

Server on 5001 under `tsx watch`, client on 5173 under Vite with HMR (both from
`ports` in `ezpipeline.config.json`). See
[Setup](setup.md) for prerequisites; the important one is **Node 20 or
newer**, because `better-sqlite3` 12.5 has no prebuilt binary for Node 18.

Run the halves separately when you only care about one:

```bash
npm run dev:server
npm run dev:client
```

Typecheck without emitting, and run the tests:

```bash
cd apps/server && npx tsc --noEmit
cd apps/client && npx tsc --noEmit -p tsconfig.app.json
NODE_ENV=development npm test        # from the repository root
```

---

## Where things live

```
apps/server/src/
  server.ts          entry point: migrations, routes, Socket.IO, static files
  app.ts             the Express app: CORS, JSON, logging, /health
  routes/
    index.ts         most of the API. ~2,750 lines
    ai.ts            assistant
    agent.ts         agent-token API
    terminal.ts      interactive shell
    globalEnv.ts     global environment
  controllers/
    EZPipelineController.ts   pipeline discovery and execution. ~1,900 lines
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
  data/documentation/  the in-app docs, see below
```

### The in-app docs

`apps/client/src/data/documentation/*.ts` holds the pages shown at `/docs` in
the running app. They are written separately from this `docs/` directory, so
a change to behaviour means updating both until the app reads `docs/*.md`
directly, which is planned.

| Corpus | Read by |
|---|---|
| `docs/*.md` | People, the website's docs pages, and the assistant's `read_documentation` tool |
| `apps/client/src/data/documentation/*.ts` | The in-app Docs page |

---

## Conventions

### Relative imports carry `.js`

The server is ESM TypeScript. Relative imports end in `.js`, naming the
emitted file, and a folder is imported by its `index.js`:

```ts
import { DatabaseService } from "./services/Database.js";   // yes
import { Build } from "../types/other/index.js";            // yes
import { fieldWarnings } from "./pipelineFile";             // no
```

To check: `grep -rnE "from ['\"]\.\.?/[^'\"]*['\"]" apps/server/src --include='*.ts' | grep -v "\.js['\"]"`
prints nothing.

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

The client shows `message` when there is one and `error` otherwise
(`apps/client/src/lib/api.ts`), so older routes that put a sentence in `error`
still read well. When you touch one, give it a code and move the sentence to
`message`.

### Never return an empty array to signal failure

An empty array means "there are no results". A failure means "I do not know".
Collapsing the second into the first destroys the difference and the caller
cannot recover it.

`SchedulerService` rethrows a database error, so the route answers 500.
A missing global env file or pipelines folder is different: it really does
mean there is nothing, and an empty list is the true answer.

`AnthropicAssistant.ts` is the model here. Every tool returns a labelled
outcome, with a comment saying why: a tool answering `[]` on failure would be
indistinguishable from one answering "nothing matched", and the model would
confidently report the wrong one.

### Comments explain why, and what was rejected

Not what the syntax does. The density is high on purpose. The newer files in
`services/` and the Docker files are the reference.

Thinking-aloud is the variety to avoid: comments that work through options
before picking one. Keep the conclusion and the rejected alternative; delete
the deliberation.

### No em dashes

Anywhere: code, comments, documentation, UI copy. Use a spaced hyphen. A sweep
removed 2,369 of them from notch.fm because they read as machine-written.

To check: `grep -rn $'\u2014\|\u2013' apps/*/src scripts docs README.md`
prints nothing.

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
2. **Check permissions in the handler.** Use `requirePipeline(perm)` for a
   route with the pipeline in its path, or
   `PermissionsService.getInstance().checkPermission(userId, target, perm)`.
   Test it as a non-admin: an admin passes every check.
3. Return `{error: "snake_case_code", message: "sentence"}` on failure.
4. Update [API reference](api-reference.md).

**Check the path is not already registered.** Express uses the first handler
that matches, so a second registration of the same path never runs. This
prints nothing today and should keep printing nothing:

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
| `generateRollbackPlan()` | Decides which steps a zip rollback skips |

What a pipeline file may contain, and what loading one does with it
(including turning a `kubernetes:` block into its last step), is
`services/pipelineFile.ts`. The env layers are built per run and never written
into the server's `process.env`.

---

## Testing

```bash
NODE_ENV=development npm test
```

Runs `apps/server/test/*.test.ts` under Node's own test runner through `tsx`.
They cover the pipeline file rules, env layering, permissions inheritance,
substeps, git credentials, build status and setup. A new behaviour gets a test
beside them. The site (`apps/site`) and the desktop app (`apps/desktop`) have
their own `npm test`.

What to exercise by hand as well:

- Sign in as a **non-admin**. Most authorization mistakes are invisible to an
  admin, because `PermissionsService` lets admins through every check. Make
  the account under Settings, give it one pipeline, and sign in as it.
- Run a pipeline and watch the SSE stream. Progress arrives on
  `/api/logs-stream`, not over Socket.IO.
- Call a route with no token and with a garbage token: both answer 401 with
  JSON.

---

## Contributing

Branch, change, test by hand, commit with a conventional prefix
(`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`), push, open a PR.

If you change an API route, update [API reference](api-reference.md) in the
same commit. It drifts one commit at a time otherwise.

---

[Back to the documentation index](README.md)
