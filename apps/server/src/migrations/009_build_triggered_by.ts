import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

/**
 * Migration: remember who started a build.
 *
 * BuildHistory already exposed a `triggeredBy` field and the dashboard already
 * rendered it. It was hardcoded to the literal 'manual' for every row, because
 * there was nowhere to read a real value from: the builds table has no such
 * column, so the history could only ever repeat the same word.
 *
 * That is the trap this fixes. A field that always says "manual" is not a
 * missing feature, it is a WRONG one - it reads as a fact, and a run nobody
 * started looks exactly like a run somebody is sitting in front of.
 */
export function migrateBuildTriggeredBy() {
    const db = DatabaseService.getInstance().getDb();
    const logger = Logger.getInstance();

    try {
        const cols = db.prepare(`PRAGMA table_info(builds)`).all() as { name: string }[];
        if (cols.some(c => c.name === "triggered_by")) {
            logger.info("builds.triggered_by already exists, skipping migration");
            return true;
        }
        // Existing rows keep NULL rather than being backfilled with a guess:
        // nobody knows who started them, and inventing 'manual' is exactly the
        // untruth this migration exists to remove.
        db.exec(`ALTER TABLE builds ADD COLUMN triggered_by TEXT`);
        logger.info("✅ builds.triggered_by column added");
        return true;
    } catch (error) {
        logger.error("❌ build triggered_by migration failed", error);
        throw error;
    }
}
