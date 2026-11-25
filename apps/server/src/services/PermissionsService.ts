import { DatabaseService } from "./Database.js";
import Logger from "../controllers/Logger.js";
import { AUTH_CONFIG } from "../config/index.js";

export interface GranularPermission {
    target: string;
    canView: boolean;
    canRun: boolean;
    canEditYaml: boolean;
    canEditEnv: boolean;
    canViewResources: boolean;
    canUseClaude: boolean;
    canUseTerminal: boolean;
}

export type PermissionType = 'view' | 'run' | 'editYaml' | 'editEnv' | 'viewResources' | 'useClaude' | 'useTerminal';

/** "A/B/C" → ["A/B/C", "A/B", "A"]. */
const ancestors = (g: string) => {
    const parts = g.split("/").filter(Boolean);
    return parts.map((_, i) => parts.slice(0, parts.length - i).join("/"));
};

/**
 * The grant that decides for a target, most specific first:
 *   1. one on the pipeline itself ("pipeline:<id>" or the bare id),
 *   2. one on its group, then each group above it ("group:<path>" or the bare path),
 *   3. the wildcard "*".
 * A pipeline grant overrides its group's, so a group can give its members a
 * default and one pipeline can still be locked down or opened up.
 * `groupOf` names a pipeline's group; for a target that is a group, the
 * groups above it are tried after the group itself.
 */
export function resolveGrant(perms: GranularPermission[], target: string, groupOf: (t: string) => string | null): GranularPermission | null {
    const t = target.toLowerCase();
    const by = (names: string[]) => {
        for (const n of names) {
            const hit = perms.find((p) => p.target.toLowerCase() === n);
            if (hit) return hit;
        }
        return null;
    };
    const exact = by([`pipeline:${t}`, t, `group:${t}`]);
    if (exact) return exact;
    const g = groupOf(target);
    const chain = g ? ancestors(g) : ancestors(target).slice(1);
    for (const a of chain) {
        const hit = by([`group:${a.toLowerCase()}`, a.toLowerCase()]);
        if (hit) return hit;
    }
    return perms.find((p) => p.target === "*") ?? null;
}

export class PermissionsService {
    /** Set at startup (services/access.ts): which group a pipeline is filed in. */
    public static groupOf: (target: string) => string | null = () => null;
    private static instance: PermissionsService;
    private db = DatabaseService.getInstance();
    private logger = Logger.getInstance();

    private constructor() {
        // Schema is now managed by migration
    }

    public static getInstance(): PermissionsService {
        if (!PermissionsService.instance) {
            PermissionsService.instance = new PermissionsService();
        }
        return PermissionsService.instance;
    }

    public isPrimaryAdmin(userId: number): boolean {
        if (!AUTH_CONFIG.required) return true;
        const db = this.db.getDb();
        const user = db.prepare("SELECT is_primary_admin FROM users WHERE id = ?").get(userId) as any;
        return user?.is_primary_admin === 1;
    }

    public isAdmin(userId: number): boolean {
        if (!AUTH_CONFIG.required) return true;
        const db = this.db.getDb();
        const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as any;
        return user?.is_admin === 1;
    }

    public canModifyUser(actorId: number, targetUserId: number): boolean {
        if (this.isPrimaryAdmin(targetUserId) && actorId !== targetUserId) {
            return false;
        }
        return this.isAdmin(actorId);
    }

    public getUserPermissions(userId: number): GranularPermission[] {
        const db = this.db.getDb();
        const rows = db.prepare(`
            SELECT target, can_view, can_run, can_edit_yaml, can_edit_env, can_view_resources, can_use_claude, can_use_terminal 
            FROM permissions 
            WHERE user_id = ?
        `).all(userId) as any[];

        return rows.map(row => ({
            target: row.target,
            canView: row.can_view === 1,
            canRun: row.can_run === 1,
            canEditYaml: row.can_edit_yaml === 1,
            canEditEnv: row.can_edit_env === 1,
            canViewResources: row.can_view_resources === 1,
            canUseClaude: row.can_use_claude === 1,
            canUseTerminal: row.can_use_terminal === 1
        }));
    }

    public setUserPermissions(userId: number, permissions: GranularPermission[]) {
        const db = this.db.getDb();
        const insert = db.prepare(`
            INSERT INTO permissions (user_id, target, can_view, can_run, can_edit_yaml, can_edit_env, can_view_resources, can_use_claude, can_use_terminal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const deleteStmt = db.prepare("DELETE FROM permissions WHERE user_id = ?");

        db.transaction(() => {
            deleteStmt.run(userId);
            for (const p of permissions) {
                insert.run(
                    userId,
                    p.target,
                    p.canView ? 1 : 0,
                    p.canRun ? 1 : 0,
                    p.canEditYaml ? 1 : 0,
                    p.canEditEnv ? 1 : 0,
                    p.canViewResources ? 1 : 0,
                    p.canUseClaude ? 1 : 0,
                    p.canUseTerminal ? 1 : 0
                );
            }
        })();

        this.logger.info(`Permissions updated for user ${userId}`);
    }

    public checkPermission(userId: number, target: string, permission: PermissionType): boolean {
        if (!AUTH_CONFIG.required) return true;
        if (this.isAdmin(userId)) return true;

        const bestMatch = resolveGrant(this.getUserPermissions(userId), target, PermissionsService.groupOf);
        if (!bestMatch) return false;

        switch (permission) {
            case 'view': return bestMatch.canView;
            case 'run': return bestMatch.canRun;
            case 'editYaml': return bestMatch.canEditYaml;
            case 'editEnv': return bestMatch.canEditEnv;
            case 'viewResources': return bestMatch.canViewResources;
            case 'useClaude': return bestMatch.canUseClaude;
            case 'useTerminal': return bestMatch.canUseTerminal;
            default: return false;
        }
    }

    /**
     * Legacy compatibility: check read/write access
     * Maps to new permission model:
     * - read -> canView
     * - write -> canEditYaml
     */
    public checkAccess(userId: number, target: string, requiredAccess: "read" | "write"): boolean {
        if (requiredAccess === 'read') {
            return this.checkPermission(userId, target, 'view');
        } else {
            return this.checkPermission(userId, target, 'editYaml');
        }
    }
}
