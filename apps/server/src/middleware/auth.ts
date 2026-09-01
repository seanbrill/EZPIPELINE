import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Resolved once, and it refuses a placeholder outside development.
import { JWT_SECRET as SECRET } from "../config/secret.js";

export interface AuthRequest extends Request {
    user?: any;
}

import { AUTH_CONFIG } from "../config/index.js";
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
        res.sendStatus(401);
        return;
    }

    jwt.verify(token, SECRET, (err: any, decoded: any) => {
        if (err) {
            res.sendStatus(403);
            return;
        }

        try {
            // Verify user exists in DB (Handles DB reset case)
            const db = DatabaseService.getInstance().getDb();
            const user = db.prepare("SELECT id, username, is_admin, is_primary_admin, can_manage_users, display_name FROM users WHERE id = ?").get(decoded.id) as any;

            if (!user) {
                res.sendStatus(401); // User no longer exists
                return;
            }

            // Check Restricted Scope (Email Setup)
            if (decoded.scope === 'setup-email') {
                // Allow only Setup routes (using originalUrl to catch /api/auth/setup/...)
                if (!req.originalUrl.includes('/auth/setup/')) {
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
            res.sendStatus(500);
        }
    });
};
