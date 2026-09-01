import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

/**
 * Migration: Add can_manage_users column to users table
 */
export function migrateCanManageUsers() {
    const dbService = DatabaseService.getInstance();
    const db = dbService.getDb();
    const logger = Logger.getInstance();

    logger.info("Starting can_manage_users migration...");

    try {
        // Check if column already exists
        const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
        const columnExists = tableInfo.some((col: any) => col.name === 'can_manage_users');

        if (columnExists) {
            logger.info("can_manage_users column already exists, skipping migration");
            return true;
        }

        // Add can_manage_users column
        db.exec(`ALTER TABLE users ADD COLUMN can_manage_users INTEGER DEFAULT 0`);

        logger.info("✅ can_manage_users column added successfully");
        return true;
    } catch (error) {
        logger.error(`❌ can_manage_users migration failed: ${error}`);
        throw error;
    }
}
