import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

/**
 * Migration: Add Schedules Table
 * 
 * Creates a table for storing pipeline schedule configurations
 */
export function migrateSchedules() {
    const dbService = DatabaseService.getInstance();
    const db = dbService.getDb();
    const logger = Logger.getInstance();

    logger.info("Starting schedules table migration...");

    try {
        // Check if table already exists
        const tableExists = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='schedules'
        `).get();

        if (tableExists) {
            logger.info("Schedules table already exists, skipping migration");
            return true;
        }

        // Create schedules table
        db.exec(`
            CREATE TABLE schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pipeline_target TEXT NOT NULL,
                cron_expression TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                created_by INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_run TEXT,
                next_run TEXT,
                FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        logger.info("✅ Schedules table created successfully");
        return true;
    } catch (error) {
        logger.error("❌ Schedules migration failed", error);
        throw error;
    }
}
