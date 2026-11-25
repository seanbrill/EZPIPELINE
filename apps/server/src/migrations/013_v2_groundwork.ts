// The server half of the v2 redesign, in one migration because the screens
// that need it arrive together.
//
//   builds.auto_approve     A git watch's "approve gates for me" used to live
//                           only on the in-memory Build. approveBuild rebuilds
//                           the Build from this table, so the flag survived the
//                           first gate and was gone by the second.
//   builds.approvals        JSON: one {step, by, at, auto} per gate passed, so
//                           a run can say who let it through.
//   build_logs.step_index   Which step printed the line. The run page shows a
//   build_logs.stream       step's own output, and substep markers (Phase 4)
//                           are read per step.
//   audit_events            Who changed what, and when.
//   commits                 Commit details known BEFORE a run, from a bare
//                           cache clone a git watch keeps, so a card can show a
//                           subject while the run is still queued.
import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

function columns(table: string): string[] {
  const db = DatabaseService.getInstance().getDb();
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

export function migrateV2Groundwork(): void {
  const db = DatabaseService.getInstance().getDb();
  const logger = Logger.getInstance();

  const builds = columns("builds");
  if (!builds.includes("auto_approve")) db.exec(`ALTER TABLE builds ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0`);
  if (!builds.includes("approvals")) db.exec(`ALTER TABLE builds ADD COLUMN approvals TEXT`);

  const logs = columns("build_logs");
  if (!logs.includes("step_index")) db.exec(`ALTER TABLE build_logs ADD COLUMN step_index INTEGER`);
  if (!logs.includes("stream")) db.exec(`ALTER TABLE build_logs ADD COLUMN stream TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_build_logs_build ON build_logs(build_id, id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         TEXT NOT NULL,
      user_id    INTEGER,
      username   TEXT,
      action     TEXT NOT NULL,
      target     TEXT,
      ip         TEXT,
      status     INTEGER,
      detail     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_events(at);
    CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target);

    -- Small per-user state the UI keeps on the server so it follows the
    -- person between browsers: e.g. when they last read notifications.
    CREATE TABLE IF NOT EXISTS user_state (
      user_id    INTEGER NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS commits (
      repo        TEXT NOT NULL,
      sha         TEXT NOT NULL,
      subject     TEXT NOT NULL,
      body        TEXT,
      author      TEXT,
      authored_at TEXT,
      files       INTEGER,
      insertions  INTEGER,
      deletions   INTEGER,
      parents     TEXT,
      PRIMARY KEY (repo, sha)
    );
  `);
  logger.info("✅ v2 groundwork: approvals, step-tagged logs, audit_events, commits");
}
