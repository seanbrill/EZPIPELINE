import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

/**
 * Migration: git watches - run a pipeline when a branch moves.
 *
 * POLLING, NOT WEBHOOKS, and that is a constraint rather than a preference.
 * This server runs wherever its owner runs it, which is usually a laptop or a
 * box behind a home router with no inbound route from the internet. A webhook
 * needs the forge to reach US; a poll only needs us to reach the forge. So the
 * design that works for everybody is the one that asks.
 *
 * It asks cheaply: `git ls-remote <repo> <branch>` returns one line - the head
 * commit - without cloning, checking out, or fetching a single object. Storing
 * the sha we last saw turns "has anything changed" into a string comparison.
 *
 * last_sha is also what stops a restart re-triggering every watch: a fresh
 * process would otherwise see "no previous sha" and treat the current head as
 * new, deploying whatever happened to be there every time the server bounced.
 */
export function migrateGitWatches() {
    const db = DatabaseService.getInstance().getDb();
    const logger = Logger.getInstance();

    logger.info("Starting git watches table migration...");

    try {
        const tableExists = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='git_watches'
        `).get();

        if (tableExists) {
            logger.info("git_watches table already exists, skipping migration");
            return true;
        }

        db.exec(`
            CREATE TABLE git_watches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                -- The pipeline to run, by the same id POST /run-pipeline takes.
                pipeline_target TEXT NOT NULL,
                -- Kept alongside the target so the UI can group watches without
                -- parsing ids, and so a moved pipeline is visibly stale rather
                -- than silently orphaned.
                group_path TEXT,
                repo_url TEXT NOT NULL,
                branch TEXT NOT NULL DEFAULT 'main',
                poll_seconds INTEGER NOT NULL DEFAULT 60,
                enabled INTEGER NOT NULL DEFAULT 1,
                -- Pass approval gates automatically on PUSH-TRIGGERED runs.
                -- Off by default and confirmed in the UI before it can be
                -- switched on, because it converts a deliberate pause into no
                -- pause at all. Scoped to the watch rather than the pipeline so
                -- a manual run of the same pipeline still stops, and so dev can
                -- flow while prod keeps its gate.
                auto_approve INTEGER NOT NULL DEFAULT 0,
                -- The head commit at the last successful check. NULL means
                -- "never checked": the first check adopts whatever is there
                -- WITHOUT triggering, so enabling a watch does not immediately
                -- deploy a commit that was already live.
                last_sha TEXT,
                last_checked_at TEXT,
                last_triggered_at TEXT,
                last_triggered_sha TEXT,
                -- Last failure, so a watch that cannot reach its remote says so
                -- in the UI instead of looking merely quiet.
                last_error TEXT,
                created_by INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        db.exec(`
            CREATE INDEX git_watches_enabled_idx ON git_watches(enabled)
        `);

        logger.info("✅ git_watches table created successfully");
        return true;
    } catch (error) {
        logger.error("❌ git watches migration failed", error);
        throw error;
    }
}
