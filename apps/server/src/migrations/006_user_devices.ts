
import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

export const migrateUserDevices = () => {
    const db = DatabaseService.getInstance().getDb();
    try {
        // Create user_devices table
        db.prepare(`
            CREATE TABLE IF NOT EXISTS user_devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                device_token TEXT NOT NULL,
                device_name TEXT,
                last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `).run();

        // Index for faster lookups
        db.prepare("CREATE INDEX IF NOT EXISTS idx_user_devices_token ON user_devices(device_token)").run();
        db.prepare("CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id)").run();

        Logger.getInstance().info("[Migration] user_devices table created/verified");
    } catch (error) {
        Logger.getInstance().error("[Migration] Failed to create user_devices table", error);
        throw error;
    }
};
