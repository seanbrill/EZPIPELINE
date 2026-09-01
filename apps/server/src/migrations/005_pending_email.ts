
import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

export const migratePendingEmail = () => {
    const db = DatabaseService.getInstance().getDb();
    try {
        const tableInfo = db.pragma("table_info(users)") as any[];
        const hasColumn = tableInfo.some(col => col.name === "pending_email");

        if (!hasColumn) {
            Logger.getInstance().info("[Migration] Adding pending_email column to users table");
            db.prepare("ALTER TABLE users ADD COLUMN pending_email TEXT").run();
            Logger.getInstance().info("[Migration] Pending email column added successfully");
        } else {
            Logger.getInstance().info("pending_email column already exists, skipping migration");
        }
    } catch (error) {
        Logger.getInstance().error("[Migration] Failed to add pending_email column", error);
        throw error;
    }
};
