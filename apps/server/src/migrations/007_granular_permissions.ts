
import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

export const migrateGranularPermissions = () => {
    const db = DatabaseService.getInstance().getDb();
    try {
        // Add new columns if they don't exist
        const columns = db.prepare("PRAGMA table_info(permissions)").all() as any[];
        const hasViewResources = columns.some(c => c.name === 'can_view_resources');

        if (!hasViewResources) {
            db.prepare("ALTER TABLE permissions ADD COLUMN can_view_resources INTEGER DEFAULT 0").run();
            Logger.getInstance().info("[Migration] Added can_view_resources to permissions table");
        }

    } catch (error) {
        Logger.getInstance().error("[Migration] Failed to add granular permissions columns", error);
        throw error;
    }
};
