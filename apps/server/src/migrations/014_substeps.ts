/**
 * Substeps (v2 Phase 4): the tree inside a step, and which node each log line
 * belongs to, so the run page can zoom into a step and scope its log.
 */
import { DatabaseService } from "../services/Database.js";

export function migrateSubsteps(): void {
  const db = DatabaseService.getInstance().getDb();
  const logs = (db.prepare(`PRAGMA table_info(build_logs)`).all() as Array<{ name: string }>).map((c) => c.name);
  if (!logs.includes("substep")) db.exec(`ALTER TABLE build_logs ADD COLUMN substep TEXT`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_substeps (
      build_id    TEXT NOT NULL,
      path        TEXT NOT NULL,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL,
      started_at  INTEGER,
      ended_at    INTEGER,
      done        INTEGER,
      total       INTEGER,
      unit        TEXT,
      source      TEXT NOT NULL,
      PRIMARY KEY (build_id, path)
    );
  `);
}
