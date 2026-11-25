/**
 * Each log line's level, so an error line is still marked as one when the run is
 * opened later (it was only marked on the live stream, then lost).
 */
import { DatabaseService } from "../services/Database.js";

export function migrateLogLevel(): void {
  const db = DatabaseService.getInstance().getDb();
  const logs = (db.prepare(`PRAGMA table_info(build_logs)`).all() as Array<{ name: string }>).map((c) => c.name);
  if (!logs.includes("level")) db.exec(`ALTER TABLE build_logs ADD COLUMN level TEXT`);
}
