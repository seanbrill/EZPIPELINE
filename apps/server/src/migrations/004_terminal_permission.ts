import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

export function migrateTerminalPermission() {
    const db = DatabaseService.getInstance().getDb();
    const logger = Logger.getInstance();

    try {
        // Check if column exists
        const tableInfo = db.prepare("PRAGMA table_info(permissions)").all() as any[];
        const hasColumn = tableInfo.some(col => col.name === 'can_use_terminal');

        if (!hasColumn) {
            logger.info("[Migration] Adding can_use_terminal column to permissions table");
            db.exec("ALTER TABLE permissions ADD COLUMN can_use_terminal INTEGER DEFAULT 0");
            logger.info("[Migration] Terminal permission column added successfully");
        } else {
            logger.info("[Migration] Terminal permission column already exists, skipping");
        }
    } catch (error: any) {
        logger.error(`[Migration] Failed to add terminal permission: ${error.message}`);
        throw error;
    }
}
