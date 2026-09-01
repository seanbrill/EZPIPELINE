#!/usr/bin/env node
// Runs once, inside a container, before the server starts. Exits non-zero if
// the server would not have been able to start, and says why in a sentence a
// person can act on.
//
// Why this exists as a separate service rather than as code in server.ts: both
// things it checks fail LATE and OPAQUELY. Winston's file transport throws
// while the logger is being constructed, which is before the logger exists to
// report it, and better-sqlite3's ABI mismatch surfaces as a require() error
// naming a .node file and no cause. Catching them here means the failure has a
// name before anything else has run.
//
// It is NOT a schema migration step. EZPIPELINE runs its migrations in-process
// at boot (server.ts calls migrate001 through migrate007 against the same
// connection the app then uses), so splitting them into a service here would
// run them twice against the same file and buy nothing. Rejected on that basis.

import { mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Directories the server assumes already exist. On a first run against a fresh
// named volume none of them do, and the failures are not obvious:
//
//   apps/server/logs      winston's File transport does not create its parent
//                         directory. Logger.ts builds the logger at import
//                         time, so the process dies during module loading with
//                         ENOENT and no stack that mentions logging.
//   apps/server/data      better-sqlite3 opens app.db with SQLITE_CANTOPEN if
//                         the directory is missing, which reads like a
//                         permissions problem rather than a missing folder.
//   pipeline_workspace/PIPELINE_OUTPUT
//                         where EZPipelineController writes generated yaml and
//                         build artifacts. Created lazily in some code paths
//                         and not others.
//   apps/server/ai_sandbox
//                         ClaudeManager writes INSTRUCTIONS.md here on the
//                         first AI request.
const directories = [
  "apps/server/logs",
  "apps/server/data",
  "apps/server/data/pipelines",
  "apps/server/data/plugins",
  "apps/server/data/global",
  "apps/server/pipeline_workspace/PIPELINE_OUTPUT",
  "apps/server/ai_sandbox",
];

for (const relative of directories) {
  const absolute = join(root, relative);
  if (existsSync(absolute)) continue;
  mkdirSync(absolute, { recursive: true });
  console.log(`[init] created ${relative}`);
}

// The check this whole service is really here for.
//
// better-sqlite3 is a native module. It is compiled against the Node ABI and
// the libc of whatever installed it, so a node_modules built on a macOS host
// and bind-mounted into this Linux container fails at require() with a message
// about a missing or malformed .node file - naming neither the platform nor
// the reason. docker-compose.yml masks the host's node_modules with anonymous
// volumes to prevent exactly that, and this is the assertion that the masking
// is still working. If someone deletes those volume lines, they find out here
// with an explanation instead of thirty lines into a server stack trace.
const require = createRequire(import.meta.url);
let Database;
try {
  Database = require("better-sqlite3");
} catch (error) {
  console.error(
    "\n[init] better-sqlite3 could not be loaded inside the container.\n" +
      "\n" +
      "  This almost always means the host's node_modules reached the container.\n" +
      "  better-sqlite3 is a native module: the copy on your Mac is built for\n" +
      "  macOS and the wrong Node ABI, and cannot load on Linux.\n" +
      "\n" +
      "  Check that docker-compose.yml still carries the three anonymous volumes\n" +
      "  that mask node_modules over the bind mount:\n" +
      "\n" +
      "    - /app/node_modules\n" +
      "    - /app/apps/server/node_modules\n" +
      "    - /app/apps/client/node_modules\n" +
      "\n" +
      "  If they are there, rebuild the image: node scripts/docker.mjs rebuild\n" +
      "\n" +
      `  The underlying error was: ${error.message}\n`
  );
  process.exit(1);
}

// Loading the module is not proof it works - the binding can load and still
// fail on first use if it was built against a different SQLite. Opening the
// real database file and reading from it is.
const dbPath = join(root, "apps/server/data/app.db");
try {
  const db = new Database(dbPath);
  const { version } = db.prepare("select sqlite_version() as version").get();
  const fresh = db
    .prepare("select count(*) as n from sqlite_master where type = 'table'")
    .get().n === 0;
  db.close();
  console.log(
    `[init] sqlite ${version} ok at apps/server/data/app.db` +
      (fresh ? " (empty - the server will create its tables on boot)" : "")
  );
} catch (error) {
  console.error(
    `\n[init] could not open the database at ${dbPath}.\n` +
      `\n  ${error.message}\n` +
      "\n  If this says SQLITE_CANTOPEN, the ezpipeline_data volume is not\n" +
      "  mounted or is not writable by the container's user.\n"
  );
  process.exit(1);
}

console.log("[init] ready");
