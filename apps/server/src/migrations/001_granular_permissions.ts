import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

/**
 * Migration: Granular Permissions System
 * 
 * Changes:
 * 1. Add is_primary_admin and display_name to users table
 * 2. Recreate permissions table with granular flags
 * 3. Migrate existing permissions to new format
 */
export function migrateToGranularPermissions() {
    const dbService = DatabaseService.getInstance();
    const db = dbService.getDb();
    const logger = Logger.getInstance();

    logger.info("Starting granular permissions migration...");

    try {
        // Start transaction
        db.exec("BEGIN TRANSACTION");

        // 1. Add new columns to users table
        logger.info("Adding new columns to users table...");

        // Check if columns already exist
        const userTableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
        const hasPrimaryAdmin = userTableInfo.some((col: any) => col.name === 'is_primary_admin');
        const hasDisplayName = userTableInfo.some((col: any) => col.name === 'display_name');

        if (!hasPrimaryAdmin) {
            db.exec(`ALTER TABLE users ADD COLUMN is_primary_admin INTEGER DEFAULT 0`);
            logger.info("Added is_primary_admin column");
        }

        if (!hasDisplayName) {
            db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
            logger.info("Added display_name column");
        }

        // 2. Set first user as primary admin
        const firstUser = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as any;
        if (firstUser) {
            db.prepare("UPDATE users SET is_primary_admin = 1 WHERE id = ?").run(firstUser.id);
            logger.info(`Set user ${firstUser.id} as primary admin`);
        }

        // 3. Backup old permissions
        logger.info("Backing up existing permissions...");

        // Check if table exists
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='permissions'").get();
        let oldPermissions: any[] = [];

        if (tableCheck) {
            // CRITICAL FIX: Check if table is ALREADY granular. If so, SKIP migration to prevent data loss.
            const permColumns = db.prepare("PRAGMA table_info(permissions)").all() as any[];
            const isGranular = permColumns.some(c => c.name === 'can_edit_yaml');
            if (isGranular) {
                logger.info("Permissions table is already granular. Skipping destructive migration.");
                db.exec("COMMIT");
                return true;
            }

            oldPermissions = db.prepare("SELECT * FROM permissions").all();
            logger.info(`Backed up ${oldPermissions.length} permission records`);
            // 4. Drop old permissions table
            db.exec("DROP TABLE IF EXISTS permissions");
            logger.info("Dropped old permissions table");
        } else {
            logger.info("No existing permissions table found, skipping backup/drop");
        }

        // 5. Create new permissions table with granular flags
        logger.info("Creating new permissions table...");
        db.exec(`
            CREATE TABLE permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                target TEXT NOT NULL,
                
                -- Granular permissions
                can_view INTEGER DEFAULT 0,
                can_run INTEGER DEFAULT 0,
                can_edit_yaml INTEGER DEFAULT 0,
                can_edit_env INTEGER DEFAULT 0,
                can_use_claude INTEGER DEFAULT 0,
                
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, target)
            )
        `);
        logger.info("Created new permissions table");

        // 6. Migrate old permissions to new format
        let migratedCount = 0;
        if (oldPermissions.length > 0) {
            logger.info("Migrating old permissions...");
            const insert = db.prepare(`
                INSERT INTO permissions (user_id, target, can_view, can_run, can_edit_yaml, can_edit_env, can_use_claude)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            for (const oldPerm of oldPermissions as any[]) {
                // Migration logic:
                // - "read" access -> can_view=1, can_run=1
                // - "write" access -> all permissions=1
                // - "none" access -> all permissions=0
                // Skip if column access doesn't exist (safety check)
                if (!oldPerm.access) continue;

                let canView = 0, canRun = 0, canEditYaml = 0, canEditEnv = 0, canUseClaude = 0;

                if (oldPerm.access === 'read') {
                    canView = 1;
                    canRun = 1;
                } else if (oldPerm.access === 'write') {
                    canView = 1;
                    canRun = 1;
                    canEditYaml = 1;
                    canEditEnv = 1;
                    canUseClaude = 1;
                }

                try {
                    insert.run(
                        oldPerm.user_id,
                        oldPerm.target,
                        canView,
                        canRun,
                        canEditYaml,
                        canEditEnv,
                        canUseClaude
                    );
                    migratedCount++;
                } catch (e) {
                    logger.warn(`Failed to migrate permission for user ${oldPerm.user_id}, target ${oldPerm.target}: ${e}`);
                }
            }
            logger.info(`Migrated ${migratedCount} permissions to new format`);
        } else {
            logger.info("No old permissions to migrate");
        }

        logger.info(`Migrated ${migratedCount} permissions to new format`);

        // Commit transaction
        db.exec("COMMIT");
        logger.info("✅ Granular permissions migration completed successfully");

        return true;
    } catch (error) {
        // Rollback on error
        db.exec("ROLLBACK");
        logger.error("❌ Migration failed, rolled back changes", error);
        throw error;
    }
}
