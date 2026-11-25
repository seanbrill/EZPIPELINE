import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Resolved once, and it refuses a placeholder outside development.
import { JWT_SECRET as SECRET } from "../config/secret.js";

export interface AuthRequest extends Request {
    user?: any;
}

import { AUTH_CONFIG } from "../config/index.js";
import { lookupToken, levelAllows, PREFIX as TOKEN_PREFIX } from '../services/apiTokens.js';
import { DatabaseService } from "../services/Database.js";

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    // 1. Check if auth is disabled globally
    if (!AUTH_CONFIG.required) {
        // Mock a super-admin user
        (req as AuthRequest).user = {
            id: 1, // Mock ID
            username: AUTH_CONFIG.defaultUser.username,
            isAdmin: true,
            isPrimaryAdmin: true
        };
        next();
        return;
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        res.status(401).json({ error: "not_signed_in", message: "Sign in first." });
        return;
    }

    // A personal API token: acts as its owner, limited by its level.
    if (token.startsWith(TOKEN_PREFIX)) {
        try {
            const row = lookupToken(token);
            if (!row) { res.status(401).json({ error: "That token is not valid or has expired." }); return; }
            const pathOnly = req.originalUrl.split('?')[0];
            if (!levelAllows(row.level, req.method, pathOnly)) {
                res.status(403).json({ error: `A "${row.level}" token cannot do that.` });
                return;
            }
            const db = DatabaseService.getInstance().getDb();
            const user = db.prepare("SELECT id, username, is_admin, is_primary_admin, can_manage_users, display_name, mfa_enabled FROM users WHERE id = ?").get(row.user_id) as any;
            if (!user) { res.status(401).json({ error: "session_expired", message: "The account behind that token no longer exists." }); return; }
            (req as AuthRequest).user = {
                ...user,
                isAdmin: user.is_admin === 1,
                isPrimaryAdmin: user.is_primary_admin === 1,
                canManageUsers: user.can_manage_users === 1,
                viaToken: { id: row.id, level: row.level },
            } as any;
            next();
        } catch {
            res.status(500).json({ error: "server_error", message: "The server could not check that token." });
        }
        return;
    }

    jwt.verify(token, SECRET, (err: any, decoded: any) => {
        // 401, not 403: the person is not signed in any more, which is what
        // the client acts on by sending them back to sign in.
        if (err) {
            res.status(401).json({ error: "session_expired", message: "Your sign-in has expired. Sign in again." });
            return;
        }

        try {
            // Verify user exists in DB (Handles DB reset case)
            const db = DatabaseService.getInstance().getDb();
            const user = db.prepare("SELECT id, username, is_admin, is_primary_admin, can_manage_users, display_name, mfa_enabled FROM users WHERE id = ?").get(decoded.id) as any;

            if (!user) {
                res.status(401).json({ error: "session_expired", message: "That account no longer exists." });
                return;
            }

            // Check Restricted Scope (Email Setup)
            if (decoded.scope === 'setup-email') {
                // Allow only Setup routes (using originalUrl to catch /api/auth/setup/...)
                // The path only: includes() on originalUrl also matched a query
                // string, so "/api/plugins?x=/auth/setup/" got through.
                const pathOnly = req.originalUrl.split('?')[0];
                if (!/^\/api\/auth\/setup\/[^/]+$/.test(pathOnly)) {
                    res.status(403).json({ error: "Restricted access. Complete email setup first.", emailSetupRequired: true });
                    return;
                }
            }

            // Refresh user data from DB
            (req as AuthRequest).user = {
                ...decoded,
                ...user,
                isAdmin: user.is_admin === 1,
                isPrimaryAdmin: user.is_primary_admin === 1,
                canManageUsers: user.can_manage_users === 1
            };
            next();
        } catch (e) {
            // DB Error (e.g. during reset/restart)
            res.status(500).json({ error: "server_error", message: "The server could not check your sign-in." });
        }
    });
};
