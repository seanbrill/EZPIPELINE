import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import * as fs from "fs";
import crypto from "crypto";
import EZPipelineController from "../controllers/EZPipelineController.js";
import Logger from "../controllers/Logger.js";
import { runActionChain } from "../services/ActionRunner.js";
import { ProvenanceService } from "../services/ProvenanceService.js";
import { DatabaseService } from "../services/Database.js";
import { GitWatchService } from "../services/GitWatchService.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { VersioningService } from "../services/VersioningService.js";
import { ConfigController } from "../controllers/ConfigController.js";
import { Build } from "../types/other/index.js";
import { authenticateToken } from "../middleware/auth.js";
import { PermissionsService, PermissionType } from "../services/PermissionsService.js";
import { BuildService } from "../services/BuildService.js";
import { AgentService } from "../services/AgentService.js";
import { SchedulerService } from "../services/SchedulerService.js";
import { PluginManager } from "../services/PluginManager.js";
import { EmailService } from "../services/EmailService.js";
import { MailService, PROVIDERS, providerById } from "../services/mail/index.js";
import { SettingsService } from "../services/SettingsService.js";
import globalEnvRouter from "./globalEnv.js";
import groupEnvRouter from "./groupEnv.js";
import gitCredentialsRouter from "./gitCredentials.js";
import { DATA_DIR, PORT, PUBLIC_DIR, EMAIL_CONFIG, PIPELINES_DIR, AUTH_CONFIG } from "../config/index.js";

// ... (existing imports)

const router = Router();
const configController = ConfigController.getInstance();
const permissionsService = PermissionsService.getInstance();
const buildService = BuildService.getInstance();
const scheduler = SchedulerService.getInstance();
const pluginManager = PluginManager.getInstance();
import { SystemController } from "../controllers/SystemController.js";
const systemController = SystemController.getInstance(); // Initialize
// Resolved once, and it refuses a placeholder outside development.
import { JWT_SECRET as SECRET } from "../config/secret.js";
// NOT inside global/resources. Global resources are copied into every
// pipeline's workspace, and a staging directory living inside them meant every
// half-finished upload was copied along with them.
const globalUpload = multer({ dest: path.join(DATA_DIR, 'tmp_uploads') });

// Mount global env routes
router.use("/global-env", authenticateToken, globalEnvRouter);
router.use("/group-env", authenticateToken, groupEnvRouter);
// Beside group-env deliberately: same scope, same permission, and the
// argument for scoping an environment variable to a group is stronger
// still for a deploy key.
router.use("/git-credentials", authenticateToken, gitCredentialsRouter);

// ... (existing endpoints)

// Routes consolidated below to ensure permissions filtering


// Build History endpoint
// Build History endpoint (Global or Group, filtered)
router.get("/builds/history", authenticateToken, (req, res) => {
    const { group } = req.query;
    const user = (req as any).user;
    const history = EZPipelineController.instance.getBuildHistory(group as string | undefined);

    // Filter accessible
    const allowed = history.filter(h =>
        permissionsService.checkAccess(user.id, h.pipelineId, 'read') ||
        (h.pipelineName && permissionsService.checkAccess(user.id, h.pipelineName, 'read'))
    );
    res.json({ history: allowed });
});

// Clear Build History (Admin Only)
router.delete("/builds/history", authenticateToken, (req, res) => {
    const { group } = req.query;
    const user = (req as any).user;

    if (!user.isAdmin) {
        res.status(403).json({ error: "Only admins can clear bulk history" });
        return;
    }

    EZPipelineController.instance.clearBuildHistory(group as string | undefined);
    res.json({ message: "History cleared" });
});

// History Routes (Pipeline Specific)
router.get("/history/:pipeline", authenticateToken, (req, res) => {
    const { pipeline } = req.params;
    const user = (req as any).user;

    const allBuilds = EZPipelineController.instance.getBuildHistory();

    if (pipeline !== 'all') {
        const p = EZPipelineController.instance.targets.find(t => t.id === pipeline || t.appName === pipeline);
        const hasAccess = permissionsService.checkAccess(user.id, pipeline, 'read') ||
            (p && permissionsService.checkAccess(user.id, p.id, 'read')) ||
            (p && p.appName && permissionsService.checkAccess(user.id, p.appName, 'read'));
        if (!hasAccess) {
            res.status(403).json({ error: "Access denied" });
            return;
        }
        const filtered = allBuilds.filter(b => b.pipelineId === pipeline);
        res.json({ builds: filtered });
    } else {
        // 'all' keyword requests? Filter everything.
        const allowed = allBuilds.filter(h =>
            permissionsService.checkAccess(user.id, h.pipelineId, 'read') ||
            (h.pipelineName && permissionsService.checkAccess(user.id, h.pipelineName, 'read'))
        );
        res.json({ builds: allowed });
    }
});

router.delete("/history/:pipeline", authenticateToken, (req, res) => {
    const { pipeline } = req.params;
    const user = (req as any).user;

    const p = EZPipelineController.instance.targets.find(t => t.id === pipeline || t.appName === pipeline);
    const hasAccess = permissionsService.checkAccess(user.id, pipeline, 'write') ||
        (p && permissionsService.checkAccess(user.id, p.id, 'write')) ||
        (p && p.appName && permissionsService.checkAccess(user.id, p.appName, 'write'));

    if (!hasAccess) {
        res.status(403).json({ error: "Access denied" });
        return;
    }
    buildService.clearBuildHistory(pipeline);
    res.json({ message: "History cleared" });
});

router.delete("/builds/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const user = (req as any).user;

    // TODO: Ideally look up build's pipeline to check granular write permission.
    // For now, restrict single build deletion to Admins for safety.
    if (!user.isAdmin) {
        res.status(403).json({ error: "Only admins can delete individual builds" });
        return;
    }

    buildService.deleteBuild(id);
    res.json({ message: "Build deleted" });
});

// System Routes
router.post("/system/reset", authenticateToken, (req, res) => {
    const user = (req as any).user;
    // Only admin
    if (!permissionsService.checkAccess(user.id, 'system', 'write')) {
        res.status(403).json({ error: "Access denied" });
        return;
    }
    systemController.reset(req, res);
});

// A BUILD LOG IS THE BUILD'S OUTPUT, not a public record. It carries whatever
// the pipeline printed: paths, hostnames, resource ids, and whatever a script
// echoed before somebody thought better of it. This route was authenticated
// and not authorised, so any signed-in account could read any pipeline's
// output by id - which is the reason artifacts in this install are trimmed
// before they are written and the credential cache lives outside the
// workspace. `view` is the same permission the pipeline's page needs.
router.get("/builds/:id/logs", authenticateToken, (req, res) => {
    const { id } = req.params;
    const user = (req as any).user;
    const build = buildService.getBuild(id);
    if (!build) {
        res.status(404).json({ error: "No such build." });
        return;
    }
    if (!permissionsService.checkPermission(user.id, build.target, 'view')) {
        res.status(403).json({ error: "You do not have permission to read that build." });
        return;
    }
    const logs = buildService.getBuildLogs(id);
    const messages = logs.map((l: any) => l.message);
    res.json({ logs: messages });
});

// Schedule Routes
// ── Git watches: run a pipeline when a branch moves ─────────────────────────
//
// Polling, not webhooks: this server usually has no inbound route from the
// internet, so the forge cannot call us. See migrations/008_git_watches.ts.

router.get("/git-watches", authenticateToken, (req, res) => {
    try {
        const db = DatabaseService.getInstance().getDb();
        const watches = db.prepare(`SELECT * FROM git_watches ORDER BY id DESC`).all();
        res.json({ watches });
    } catch (e) {
        Logger.getInstance().error(`Failed to list git watches: ${e}`);
        res.status(500).json({ error: "Failed to list git watches" });
    }
});

/** Check a repo/branch is reachable BEFORE saving a watch that never fires. */
router.post("/git-watches/probe", authenticateToken, async (req, res) => {
    const { repoUrl, branch } = req.body ?? {};
    if (!repoUrl || !branch) {
        res.status(400).json({ error: "repoUrl and branch are required" });
        return;
    }
    const result = await GitWatchService.getInstance().probe(String(repoUrl), String(branch));
    res.json(result);
});

router.post("/git-watches", authenticateToken, (req, res) => {
    const user = (req as any).user;
    const { pipelineTarget, groupPath, repoUrl, branch, pollSeconds, autoApprove } = req.body ?? {};

    if (!pipelineTarget || !repoUrl) {
        res.status(400).json({ error: "pipelineTarget and repoUrl are required" });
        return;
    }
    // The floor is not politeness to the forge, it is this server: every watch
    // holds the tick while its ls-remote runs, so a 1-second poll would spend
    // the loop on one repository.
    const poll = Math.max(15, Number(pollSeconds) || 60);

    try {
        const db = DatabaseService.getInstance().getDb();
        const info = db.prepare(`
            INSERT INTO git_watches
                (pipeline_target, group_path, repo_url, branch, poll_seconds, auto_approve, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(pipelineTarget),
            groupPath ? String(groupPath) : null,
            String(repoUrl),
            String(branch || "main"),
            poll,
            autoApprove ? 1 : 0,
            user?.id ?? null
        );
        Logger.getInstance().info(
            `Git watch ${info.lastInsertRowid} created for ${pipelineTarget} (${repoUrl}#${branch || "main"})` +
            (autoApprove ? " with AUTO-APPROVE enabled" : "")
        );
        res.json({ id: info.lastInsertRowid });
    } catch (e) {
        Logger.getInstance().error(`Failed to create git watch: ${e}`);
        res.status(500).json({ error: "Failed to create git watch" });
    }
});

router.patch("/git-watches/:id", authenticateToken, (req, res) => {
    const { enabled, autoApprove, pollSeconds, branch } = req.body ?? {};
    try {
        const db = DatabaseService.getInstance().getDb();
        const sets: string[] = [];
        const vals: any[] = [];
        if (enabled !== undefined) { sets.push("enabled = ?"); vals.push(enabled ? 1 : 0); }
        if (autoApprove !== undefined) { sets.push("auto_approve = ?"); vals.push(autoApprove ? 1 : 0); }
        if (pollSeconds !== undefined) { sets.push("poll_seconds = ?"); vals.push(Math.max(15, Number(pollSeconds) || 60)); }
        if (branch !== undefined) {
            // Changing the branch invalidates the remembered sha: the new
            // branch's head is a different question, and comparing against the
            // old one would fire a deploy for a commit that is not new.
            sets.push("branch = ?"); vals.push(String(branch));
            sets.push("last_sha = NULL");
        }
        if (!sets.length) { res.status(400).json({ error: "nothing to update" }); return; }
        vals.push(req.params.id);
        db.prepare(`UPDATE git_watches SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
        res.json({ ok: true });
    } catch (e) {
        Logger.getInstance().error(`Failed to update git watch: ${e}`);
        res.status(500).json({ error: "Failed to update git watch" });
    }
});

router.delete("/git-watches/:id", authenticateToken, (req, res) => {
    try {
        const db = DatabaseService.getInstance().getDb();
        db.prepare(`DELETE FROM git_watches WHERE id = ?`).run(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        Logger.getInstance().error(`Failed to delete git watch: ${e}`);
        res.status(500).json({ error: "Failed to delete git watch" });
    }
});

router.get("/schedules/:target", authenticateToken, (req, res) => {
    const { target } = req.params;
    const s = scheduler.getSchedulesForPipeline(target);
    res.json({ schedules: s });
});

router.post("/schedules", authenticateToken, (req, res) => {
    const { pipelineTarget, cronExpression } = req.body;
    const user = (req as any).user;
    if (!permissionsService.checkAccess(user.id, pipelineTarget, 'write')) {
        res.status(403).json({ error: "Access denied" });
        return;
    }
    try {
        const id = scheduler.addSchedule(pipelineTarget, cronExpression, user.id);
        res.json({ id });
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

router.delete("/schedules/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        scheduler.removeSchedule(Number(id));
        res.json({ message: "Schedule removed" });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.patch("/schedules/:id/toggle", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { enabled } = req.body;
    try {
        scheduler.toggleSchedule(Number(id), enabled);
        res.json({ message: "Schedule updated" });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});



router.get("/setup-status", (req, res) => {
    if (!AUTH_CONFIG.required) {
        res.json({ initialized: true });
        return;
    }
    const initialized = DatabaseService.getInstance().hasUsers();
    res.json({ initialized });
});

router.post("/setup", (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password) {
        res.status(400).json({ error: "Username and password required" });
        return;
    }

    const dbService = DatabaseService.getInstance();
    if (dbService.hasUsers()) {
        res.status(403).json({ error: "Setup already completed" });
        return;
    }

    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const db = dbService.getDb();

        // Check if this is the first user (redundant with hasUsers() check above but safe)
        // Actually hasUsers() checked count > 0. If we are here, count is 0. So this is the first user -> Admin.

        const insert = db.prepare("INSERT INTO users (username, password, email, mfa_enabled, is_admin, is_primary_admin, display_name) VALUES (?, ?, ?, 0, 1, 1, ?)");
        insert.run(username, hashedPassword, email || null, username);

        // Auto-login after setup
        const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
        const user = stmt.get(username) as any;
        const token = jwt.sign({
            username: user.username,
            id: user.id,
            isAdmin: true,
            isPrimaryAdmin: true,
            canManageUsers: true,
            displayName: user.display_name
        }, SECRET, { expiresIn: '24h' });

        Logger.getInstance().info(`First user '${username}' created as Admin with MFA enabled.`);
        res.json({ token, username: user.username, isAdmin: true });
    } catch (e: any) {
        Logger.getInstance().error("Setup failed", e);
        res.status(500).json({ error: e.message || "Setup failed" });
    }
});

// Auth Config Endpoint
router.get("/auth/config", (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let mfaEnforced = false;
    try {
        const val = SettingsService.getInstance().get('mfa_enforced');
        mfaEnforced = val === 'true';
    } catch (e: any) {
        // Ignore error, default false
    }

    res.json({
        required: AUTH_CONFIG.required,
        mfaEnforced
    });
});

router.post("/login", async (req, res) => {
    const { username, password, deviceToken } = req.body;
    try {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
        const user = stmt.get(username) as any;

        if (!user || !bcrypt.compareSync(password, user.password)) {
            res.status(401).json({ error: "Invalid credentials" });
            return;
        }

        const isAdmin = user.is_admin === 1;
        const canManageUsers = user.can_manage_users === 1;

        // Check System MFA Enforcement
        const mfaEnforced = SettingsService.getInstance().get('mfa_enforced') === 'true';
        const mfaEnabled = user.mfa_enabled === 1;

        // Check Trusted Device
        let isTrustedDevice = false;
        if (mfaEnforced && mfaEnabled && deviceToken) {
            const device = db.prepare("SELECT id FROM user_devices WHERE user_id = ? AND device_token = ?").get(user.id, deviceToken) as any;
            if (device) {
                isTrustedDevice = true;
                db.prepare("UPDATE user_devices SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(device.id);
            }
        }

        // 1. User has MFA Enabled (Challenge ONLY if Enforced AND NOT Trusted)
        if (mfaEnforced && mfaEnabled && !isTrustedDevice) {
            if (!user.email) {
                res.status(403).json({ error: "MFA is enabled but no email is configured. Please contact admin." });
                return;
            }

            // Generate Code
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expires = new Date(Date.now() + 10 * 60000).toISOString();

            const update = db.prepare("UPDATE users SET mfa_code = ?, mfa_expires = ? WHERE id = ?");
            update.run(code, expires, user.id);

            // Send Email
            await EmailService.getInstance().sendMFACode(user.email, code);

            res.json({
                mfaRequired: true,
                username: user.username,
                emailMasked: user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3")
            });
            return;
        }

        // 2. System Enforced MFA but User NOT Enabled (Force Setup)
        if (mfaEnforced && !mfaEnabled) {
            const token = jwt.sign({
                username: user.username,
                id: user.id,
                isAdmin,
                canManageUsers
            }, SECRET, { expiresIn: '24h' });

            if (!user.email) {
                // Issue RESTRICTED Token for Setup Only
                const setupToken = jwt.sign({
                    username: user.username,
                    id: user.id,
                    isAdmin,
                    scope: 'setup-email'
                }, SECRET, { expiresIn: '1h' });

                res.json({
                    token: setupToken,
                    username: user.username,
                    isAdmin,
                    emailSetupRequired: true
                });
                return;
            }

            // Force MFA Setup (Has email but Enforced)
            res.json({
                token,
                username: user.username,
                isAdmin,
                canManageUsers,
                mfaSetupRequired: true
            });
            return;
        }

        // 3. Standard Login
        const token = jwt.sign({
            username: user.username,
            id: user.id,
            isAdmin,
            canManageUsers
        }, SECRET, { expiresIn: '24h' });
        res.json({ token, username: user.username, isAdmin, canManageUsers });

    } catch (e: any) {
        Logger.getInstance().error(`Login failed: ${e.message}`);
        res.status(500).json({ error: "Login failed" });
    }
});

// Email Setup Routes
router.post("/auth/setup/email-challenge", authenticateToken, async (req, res) => {
    const { email } = req.body;
    const user = (req as any).user;

    if (!email || !email.includes('@')) {
        res.status(400).json({ error: "Invalid email" });
        return;
    }

    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60000).toISOString();

        const db = DatabaseService.getInstance().getDb();
        db.prepare("UPDATE users SET pending_email = ?, mfa_code = ?, mfa_expires = ? WHERE id = ?")
            .run(email, code, expires, user.id);

        await EmailService.getInstance().sendMFACode(email, code);
        res.json({ message: "Verification code sent" });
    } catch (e: any) {
        Logger.getInstance().error("Failed to send setup code", e);
        res.status(500).json({ error: "Failed to send code" });
    }
});

router.post("/auth/setup/email-verify", authenticateToken, (req, res) => {
    const { code } = req.body;
    const user = (req as any).user;

    try {
        const db = DatabaseService.getInstance().getDb();
        const dbUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as any;

        if (!dbUser.mfa_code || !dbUser.mfa_expires) {
            res.status(400).json({ error: "No code pending" });
            return;
        }

        if (new Date(dbUser.mfa_expires) < new Date()) {
            res.status(400).json({ error: "Code expired" });
            return;
        }

        if (dbUser.mfa_code !== code) {
            res.status(401).json({ error: "Invalid code" });
            return;
        }

        // SUCCESS: Verify Email + Auto-Enable MFA + Clear Restricted State
        db.prepare(`
            UPDATE users 
            SET email = pending_email, 
                pending_email = NULL, 
                mfa_enabled = 1, 
                mfa_code = NULL, 
                mfa_expires = NULL 
            WHERE id = ?
        `).run(user.id);

        // Issue FULL Token
        const token = jwt.sign({
            username: user.username,
            id: user.id,
            isAdmin: user.isAdmin,
            canManageUsers: dbUser.can_manage_users === 1
        }, SECRET, { expiresIn: '24h' });

        res.json({
            token,
            username: user.username,
            isAdmin: user.isAdmin,
            success: true
        });

    } catch (e: any) {
        Logger.getInstance().error("Setup verify failed", e);
        res.status(500).json({ error: "Verification failed" });
    }
});

router.post("/auth/mfa/verify", (req, res) => {
    const { username, code, rememberMe } = req.body;
    try {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
        const user = stmt.get(username) as any;

        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }

        if (!user.mfa_code || !user.mfa_expires) {
            res.status(400).json({ error: "No MFA code pending" });
            return;
        }

        if (new Date(user.mfa_expires) < new Date()) {
            res.status(400).json({ error: "MFA code expired" });
            return;
        }

        if (user.mfa_code !== code) {
            res.status(401).json({ error: "Invalid MFA code" });
            return;
        }

        // Success - clear code
        const update = db.prepare("UPDATE users SET mfa_code = NULL, mfa_expires = NULL WHERE id = ?");
        update.run(user.id);

        // Issue Device Token if requested
        let deviceToken: string | undefined;
        if (rememberMe) {
            deviceToken = uuidv4();
            db.prepare("INSERT INTO user_devices (user_id, device_token, device_name) VALUES (?, ?, ?)").run(user.id, deviceToken, 'Browser');
        }

        const isAdmin = user.is_admin === 1;
        const canManageUsers = user.can_manage_users === 1;
        const token = jwt.sign({
            username: user.username,
            id: user.id,
            isAdmin,
            canManageUsers
        }, SECRET, { expiresIn: '24h' });
        res.json({ token, username: user.username, isAdmin, canManageUsers, deviceToken });

    } catch (e) {
        Logger.getInstance().error(`MFA verify failed: ${e}`);
        res.status(500).json({ error: "Verification failed" });
    }
});

router.post("/auth/mfa/resend", async (req, res) => {
    const { username } = req.body;
    try {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
        const user = stmt.get(username) as any;

        if (!user || !user.mfa_enabled || !user.email) {
            // Don't reveal user existence/status too much, but need to be practical
            res.status(400).json({ error: "Cannot send code" });
            return;
        }

        // Generate Code (Reuse logic or make minimal func?)
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60000).toISOString();

        const update = db.prepare("UPDATE users SET mfa_code = ?, mfa_expires = ? WHERE id = ?");
        update.run(code, expires, user.id);

        const emailService = EmailService.getInstance();
        await emailService.sendMFACode(user.email, code);

        res.json({ message: "Code sent" });

    } catch (e) {
        Logger.getInstance().error(`MFA resend failed: ${e}`);
        res.status(500).json({ error: "Failed to resend code" });
    }
});

router.get("/check-auth", authenticateToken, (req, res) => {
    res.json({ status: "ok", user: (req as any).user });
});

router.post("/change-password", authenticateToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = (req as any).user;

    if (!newPassword) {
        res.status(400).json({ error: "New password required" });
        return;
    }

    // If currentPassword is provided, validate it
    if (currentPassword) {
        try {
            const db = DatabaseService.getInstance().getDb();
            const stmt = db.prepare("SELECT password FROM users WHERE id = ?");
            const userRecord = stmt.get(user.id) as any;

            if (!userRecord || !bcrypt.compareSync(currentPassword, userRecord.password)) {
                res.status(401).json({ error: "Current password is incorrect" });
                return;
            }
        } catch (e) {
            res.status(500).json({ error: "Failed to verify current password" });
            return;
        }
    }

    try {
        const db = DatabaseService.getInstance().getDb();
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        const stmt = db.prepare("UPDATE users SET password = ? WHERE id = ?");
        stmt.run(hashedPassword, user.id);
        res.json({ message: "Password updated" });
    } catch (e) {
        res.status(500).json({ error: "Failed to update password" });
    }
});

// Get Current User Profile
router.get("/users/me", authenticateToken, (req, res) => {
    const currentUser = (req as any).user;
    try {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("SELECT id, username, email, is_admin as isAdmin, mfa_enabled FROM users WHERE id = ?");
        const user = stmt.get(currentUser.id) as any;

        if (user) {
            res.json({
                ...user,
                isAdmin: user.isAdmin === 1,
                mfaEnabled: user.mfa_enabled === 1
            });
        } else {
            res.status(404).json({ error: "User not found" });
        }
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

// Update user (display name, admin status, MFA, email)
router.patch("/users/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { displayName, email, isAdmin, canManageUsers, mfaEnabled } = req.body;
    const currentUser = (req as any).user;

    // Check if current user can modify target user
    // Allow users to modify themselves (MFA, Display Name, Email)
    const isSelf = parseInt(id) === currentUser.id;

    if (!isSelf && !permissionsService.canModifyUser(currentUser.id, Number(id))) {
        res.status(403).json({ error: "Cannot modify this user" });
        return;
    }

    // Only admins can change admin status
    if (isAdmin !== undefined && !currentUser.isAdmin) {
        res.status(403).json({ error: "Only admins can change admin status" });
        return;
    }

    // Prevent demoting primary admin
    if (isAdmin === false && permissionsService.isPrimaryAdmin(Number(id))) {
        res.status(403).json({ error: "Cannot demote primary admin" });
        return;
    }

    try {
        const db = DatabaseService.getInstance().getDb();
        const updates: string[] = [];
        const values: any[] = [];

        if (displayName !== undefined) {
            updates.push("display_name = ?");
            values.push(displayName);
        }

        if (req.body.username !== undefined) {
            updates.push("username = ?");
            values.push(req.body.username);
        }

        if (email !== undefined) {
            updates.push("email = ?");
            values.push(email);
        }

        if (isAdmin !== undefined && currentUser.isAdmin) {
            updates.push("is_admin = ?");
            values.push(isAdmin ? 1 : 0);
        }

        if (canManageUsers !== undefined && currentUser.isAdmin) {
            updates.push("can_manage_users = ?");
            values.push(canManageUsers ? 1 : 0);
        }

        if (mfaEnabled !== undefined) {
            updates.push("mfa_enabled = ?");
            values.push(mfaEnabled ? 1 : 0);
        }

        if (updates.length === 0) {
            res.status(400).json({ error: "No updates provided" });
            return;
        }

        values.push(id);
        const stmt = db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`);
        stmt.run(...values);

        res.json({ message: "User updated" });
    } catch (e: any) {
        if (e.message.includes("UNIQUE constraint failed: users.username")) {
            res.status(400).json({ error: "Username already taken" });
            return;
        }
        Logger.getInstance().error("Failed to update user", e);
        res.status(500).json({ error: "Failed to update user" });
    }
});

// Permission Management Routes
router.get("/users/:id/permissions", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        const perms = permissionsService.getUserPermissions(Number(id));
        res.json({ permissions: perms });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch permissions" });
    }
});

router.post("/users/:id/permissions", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { permissions } = req.body; // Array of GranularPermission

    const currentUser = (req as any).user;

    // Check if current user can modify target user
    if (!permissionsService.canModifyUser(currentUser.id, Number(id))) {
        res.status(403).json({ error: "Cannot modify this user's permissions" });
        return;
    }

    try {
        permissionsService.setUserPermissions(Number(id), permissions);
        res.json({ message: "Permissions updated" });
    } catch (e) {
        res.status(500).json({ error: "Failed to update permissions" });
    }
});

router.get("/targets", authenticateToken, (req, res) => {
    const user = (req as any).user;
    const targets = EZPipelineController.instance.targets;

    // Filter targets based on user permissions
    // Admin sees all? checkAccess usually handles admin check internally via service logic?
    // Let's rely on permissionsService.checkAccess which should handle admin override if implemented, 
    // BUT usually checkAccess(user, target, 'read') is the standard way.
    // However, permissionsService might default to deny.
    // Let's check if user is Admin optimization? 
    // permissionsService usually checks isAdmin.

    const allowedTargets = targets.filter(t => {
        // We use t.id as the target identifier for permissions, fallback to name
        return permissionsService.checkAccess(user.id, t.id, 'read') ||
            (t.appName && permissionsService.checkAccess(user.id, t.appName, 'read'));
    }).map(t => {
        // PERMISSIONS CHECK FOR SANITIZATION
        // Calculate granular permissions for this target
        const canEditYaml = permissionsService.checkPermission(user.id, t.id, 'editYaml') ||
            (t.appName && permissionsService.checkPermission(user.id, t.appName, 'editYaml'));

        const canEditEnv = permissionsService.checkPermission(user.id, t.id, 'editEnv') ||
            (t.appName && permissionsService.checkPermission(user.id, t.appName, 'editEnv'));

        const canViewResources = permissionsService.checkPermission(user.id, t.id, 'viewResources') ||
            (t.appName && permissionsService.checkPermission(user.id, t.appName, 'viewResources'));

        const canUseClaude = permissionsService.checkPermission(user.id, t.id, 'useClaude') ||
            (t.appName && permissionsService.checkPermission(user.id, t.appName, 'useClaude'));

        const canUseTerminal = permissionsService.checkPermission(user.id, t.id, 'useTerminal') ||
            (t.appName && permissionsService.checkPermission(user.id, t.appName, 'useTerminal'));

        const canRun = permissionsService.checkPermission(user.id, t.id, 'run') ||
            (t.appName && permissionsService.checkPermission(user.id, t.appName, 'run'));

        // Construct permissions object
        const permissions = {
            canEditYaml,
            canEditEnv,
            canViewResources,
            canUseClaude,
            canUseTerminal,
            canRun
        };

        // IF NOT ADMIN AND NO EDIT YAML => SANITIZE
        if (!user.isAdmin && !canEditYaml) {
            const { steps, env, kubernetes, filePath, ...safe } = t;
            return { ...safe, permissions };
        }

        return { ...t, permissions };
    });

    Logger.getInstance().info(`API /targets hit by ${user.username}. Serving ${allowedTargets.length} / ${targets.length} targets.`);
    res.json({ targets: allowedTargets });
});

router.get("/builds", authenticateToken, (req, res) => {
    const user = (req as any).user;
    const allBuilds = EZPipelineController.instance.builds;
    const allowed = allBuilds.filter(b => {
        const p = EZPipelineController.instance.targets.find(t => t.id === b.target);
        return permissionsService.checkAccess(user.id, b.target, 'read') ||
            (p && p.appName && permissionsService.checkAccess(user.id, p.appName, 'read'));
    });
    res.json({ builds: allowed });
});

router.post("/run-pipeline", authenticateToken, (req, res) => {
    const { target } = req.body;
    const user = (req as any).user;
    Logger.getInstance().info(`Received run-pipeline request for target: ${target} by user ${user.username}`);

    if (!target) {
        res.status(400).json({ error: "Target is required" });
        return;
    }

    // RE-READ THE DEFINITIONS FROM DISK BEFORE RUNNING ONE.
    //
    // `targets` is built once at boot and refreshed only by the handful of
    // routes that write pipeline files. Edit a pipeline.yaml any other way -
    // by hand, by a deploy script, by copying one in - and the file on disk is
    // correct while this process keeps executing the version it read at
    // startup. Nothing anywhere says so.
    //
    // It cost a full deploy: the pipeline had been changed to build its images
    // in ACR, the file on disk said so, and the run built them locally anyway
    // for the wrong architecture. The pipeline's own drift check passed,
    // because it compares the file against the repository - and the file was
    // right. The stale copy was in here.
    //
    // A directory scan per run is nothing next to a build, and it makes the
    // definition on disk the definition that runs.
    EZPipelineController.instance.refreshTargets();

    const p = EZPipelineController.instance.targets.find(t => t.id === target || t.appName === target);
    const hasAccess = permissionsService.checkAccess(user.id, target, 'write') ||
        (p && permissionsService.checkAccess(user.id, p.id, 'write')) ||
        (p && p.appName && permissionsService.checkAccess(user.id, p.appName, 'write'));

    // Check RUN permission specifically if available, or fall back to general access checks
    const canRun = permissionsService.checkPermission(user.id, target, 'run') ||
        (p && permissionsService.checkPermission(user.id, p.id, 'run')) ||
        (p && p.appName && permissionsService.checkPermission(user.id, p.appName, 'run'));

    // Allow if they have write access OR specific run access
    if (!hasAccess && !canRun) {
        res.status(403).json({ error: "Access denied" });
        return;
    }

    // Find pipeline
    const pipeline = EZPipelineController.instance.targets.find(t => t.id === target || t.appName === target);
    if (!pipeline) {
        res.status(404).json({ error: "Pipeline not found" });
        return;
    }

    // Start build tracking (Sync)
    const build = EZPipelineController.instance.start_build(pipeline);

    // Use id as target
    const pipelineTarget = pipeline.id;

    // ONE run per request.
    //
    // This started the same build TWICE: once here, and again from a
    // setImmediate below that awaited run(target, build) with the same build
    // object. Both executed, concurrently, in the same workspace.
    //
    // It was hard to see because it mostly looked like a logging fault - every
    // line appeared twice - and the pipelines it was tried on were idempotent
    // enough to survive it. The notch.fm provisioning pipeline was not: the two
    // runs raced on `git clone` into one directory, so one reported "destination
    // path already exists" and the other a genuine SSH failure, and neither
    // error was about the real problem. Two concurrent `az deployment group
    // create` calls against one resource group were next.
    //
    // pipeline.id rather than the request's `target`, which may be an appName.
    EZPipelineController.instance.run(pipelineTarget, build, {
      // The person, not the word "manual". Every row said manual before,
      // including the ones nobody started.
      triggeredBy: user?.username ? String(user.username) : 'manual',
    }).catch(e => {
        Logger.getInstance().error(`Pipeline run failed for ${pipelineTarget}`, e);
    });

    res.json({
        message: `Pipeline run initiated for target: ${target}`,
        buildId: build.id
    });
});

// Config Management Routes
router.get("/config/files", authenticateToken, (req, res) => {
    try {
        const user = (req as any).user;
        const files = configController.getFiles();

        // Filter based on Read Permission
        const allowedTargets = EZPipelineController.instance.targets.filter(t => {
            const byId = permissionsService.checkAccess(user.id, t.id, 'read');
            const byName = t.appName && permissionsService.checkAccess(user.id, t.appName, 'read');
            return byId || byName;
        });
        const allowedIds = new Set(allowedTargets.map(t => t.id));

        const filterTree = (nodes: any[]): any[] => {
            return nodes.map(node => {
                if (node.type === 'pipeline') {
                    if (node.id && allowedIds.has(node.id)) return node;
                    return null;
                }
                if (node.type === 'directory') {
                    const children = node.children ? filterTree(node.children) : [];
                    // Two different reasons a directory can end up with no
                    // children here, and they need opposite answers.
                    //
                    // Emptied BY THIS FILTER means you may not see what is
                    // inside, so the directory itself stays hidden: showing it
                    // would leak that pipelines exist.
                    //
                    // Empty ON DISK means there is nothing to hide, and it must
                    // show. It used to be dropped, which made a newly created
                    // group impossible to see: a new group is empty by
                    // definition, so it vanished the moment it was made. The
                    // create call succeeded every time and the folder simply
                    // never appeared, which reads as "it will not let me create
                    // a folder".
                    const hadNone = (node.children || []).length === 0;
                    if (children.length > 0 || hadNone) return { ...node, children };
                    return null;
                }
                // Hide raw files to prevent information leakage
                return null;
            }).filter(n => n !== null);
        };

        const filteredYaml = filterTree(files.yaml);
        res.json({ ...files, yaml: filteredYaml });
    } catch (e) {
        Logger.getInstance().error("Failed to get config files", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/config/content", authenticateToken, (req, res) => {
    const { type, path: reqPath } = req.body;
    const user = (req as any).user;

    try {
        if (!reqPath || (type !== 'yaml' && type !== 'env')) {
            res.status(400).json({ error: "Invalid request" });
            return;
        }

        const fullPath = path.resolve(PIPELINES_DIR, reqPath);

        // Prevent Path Traversal
        if (!fullPath.startsWith(path.resolve(PIPELINES_DIR))) {
            res.status(403).json({ error: "Invalid path" });
            return;
        }

        // Identify Pipeline ownership
        const pipeline = EZPipelineController.instance.targets.find(t => {
            if (!t.filePath) return false;
            const pDir = path.dirname(path.resolve(PIPELINES_DIR, t.filePath));
            const rel = path.relative(pDir, fullPath);
            return !rel.startsWith('..') && !path.isAbsolute(rel);
        });

        // Determine Required Permission
        let requiredPerm: PermissionType = 'editYaml'; // Default strictly to editYaml for code
        let isKeysOnly = false;

        if (type === 'env') {
            requiredPerm = 'editEnv';
            if (req.body.keysOnly) {
                isKeysOnly = true;
                // If asking for keys only, we allow editYaml to suffice if they don't have editEnv
                // BUT we must check editEnv first. Logic:
                // If they have editEnv -> Good.
                // If they don't -> Check editYaml. If yes -> Good (but content stripped).
                // If neither -> 403.
                // Simplified: We check specific permissions later.
            }
        } else if (reqPath.includes('/resources/') || reqPath.includes('\\resources\\')) {
            requiredPerm = 'viewResources';
        }

        if (pipeline) {
            // Check primary permission
            let hasAccess = PermissionsService.getInstance().checkPermission(user.id, pipeline.id, requiredPerm) ||
                (pipeline.appName && PermissionsService.getInstance().checkPermission(user.id, pipeline.appName, requiredPerm));

            // If access denied for ENV, but it's KeysOnly request, check if they have editYaml
            if (!hasAccess && type === 'env' && isKeysOnly) {
                const canEditYaml = PermissionsService.getInstance().checkPermission(user.id, pipeline.id, 'editYaml') ||
                    (pipeline.appName && PermissionsService.getInstance().checkPermission(user.id, pipeline.appName, 'editYaml'));
                if (canEditYaml) {
                    hasAccess = true;
                }
            }

            if (!hasAccess) {
                res.status(403).json({ error: "Permission denied for this resource" });
                return;
            }
        } else {
            // File not in a pipeline bundle - Admin only
            if (!user.isAdmin) {
                res.status(403).json({ error: "Access denied" });
                return;
            }
        }

        const content = fs.readFileSync(fullPath, 'utf-8');

        if (isKeysOnly && type === 'env') {
            // Parse keys only
            const keys = content.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#') && l.includes('='))
                .map(l => l.split('=')[0]);

            // Return dummy content or specific keys object? 
            // Client expects { content } usually. Let's return keys as content for now? 
            // Or better, change response structure? 
            // Client looks for `data.content`. If we request keysOnly, we probably expect structured data.
            // But existing client code might expect string.
            // Let's look at client usage: `const vars = data.content.split('\n')...`
            // If we return just keys joined by newlines, client logic `l.includes('=')` will fail to find anything.
            // Client logic: `.filter(l => l && !l.startsWith('#') && l.includes('='))`
            // If we return "KEY1\nKEY2", filter will kill them.
            // We should return "KEY1=\nKEY2=" (empty values) so client parses keys but sees empty values.
            // This is safe.
            const safeContent = keys.map(k => `${k}=`).join('\n');
            res.json({ content: safeContent });
            return;
        }

        res.json({ content });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to read config file: ${reqPath}`, e);
        res.status(404).json({ error: e.message || "File not found" });
    }
});

router.post("/config/create-pipeline", authenticateToken, (req, res) => {
    const { group, name } = req.body;
    const user = (req as any).user;

    // Check permission - need WRITE access to the Group or Admin
    if (!user.isAdmin) {
        // Fallback to checking permission on the group name itself
        // This assumes permissions can be assigned to 'Group' strings or '*'
        if (!permissionsService.checkAccess(user.id, group, 'write') && !permissionsService.checkAccess(user.id, '*', 'write')) {
            res.status(403).json({ error: "Access denied" });
            return;
        }
    }

    try {
        configController.createPipelineBundle(group, name, user.username);
        EZPipelineController.instance.refreshTargets();
        res.json({ message: "Pipeline bundle created successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to create pipeline bundle: ${name}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post("/config/copy-pipeline", authenticateToken, (req, res) => {
    const { sourceId, group, name } = req.body;
    const user = (req as any).user;

    // Permission check
    if (!permissionsService.checkAccess(user.id, sourceId, 'read')) {
        res.status(403).json({ error: "Access denied to source pipeline" });
        return;
    }
    // Write access to group
    if (!user.isAdmin) {
        if (!permissionsService.checkAccess(user.id, group, 'write') && !permissionsService.checkAccess(user.id, '*', 'write')) {
            res.status(403).json({ error: "Access denied to target group" });
            return;
        }
    }

    try {
        // Resolve sourceID to path using EZPipelineController
        const sourcePipeline = EZPipelineController.instance.targets.find(t => t.id === sourceId || t.appName === sourceId);
        if (!sourcePipeline || !sourcePipeline.filePath) {
            res.status(404).json({ error: "Source pipeline not found" });
            return;
        }

        // Calculate the root folder of the pipeline bundle
        // filePath is usually "Folder/Name/pipeline.yaml"
        // We want "Folder/Name"
        const sourcePath = path.dirname(sourcePipeline.filePath);

        configController.copyPipelineBundleFromPath(sourcePath, group, name, user.username);
        EZPipelineController.instance.refreshTargets();
        res.json({ message: "Pipeline duplicated successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to copy pipeline bundle`, e);
        res.status(500).json({ error: e.message });
    }
});

// Fix shadowing of 'path' module
router.post("/config/save", authenticateToken, (req, res) => {
    const { type, path: reqPath, content } = req.body;
    const user = (req as any).user;

    // Check permission - need WRITE
    // We need to resolve path to pipeline name if possible, or key off folder?
    // Since path is like "MyPipeline.yaml" or "Folder/Pipeline.yaml"
    // And permissions targets are "pipeline:TargetName" or "group:GroupName"
    // We can extract group/folder for permission check.

    // For simplicity, let's assume 'group:General' or '*' checks.
    // If it's a specific pipeline, we need to know its Target Name.
    // Usually filename == target name (without extension).

    let targetName = reqPath.split('/').pop()?.replace('.yaml', '').replace('.env', '') || '';
    if (!targetName) targetName = 'unknown';

    // Also check folder?
    // If I have write access to Group, I should be able to write files in it.

    // Check permission logic:
    let requiredPerm: PermissionType = 'editYaml';
    if (type === 'env') {
        requiredPerm = 'editEnv';
    }

    // Identify pipeline by path matching
    const pipeline = EZPipelineController.instance.targets.find(t => {
        if (!t.filePath) return false;
        const pDir = path.dirname(path.resolve(PIPELINES_DIR, t.filePath));
        const fullPath = path.resolve(PIPELINES_DIR, reqPath);
        const rel = path.relative(pDir, fullPath);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
    });

    let hasAccess = false;
    if (pipeline) {
        hasAccess = permissionsService.checkPermission(user.id, pipeline.id, requiredPerm) ||
            (!!pipeline.appName && permissionsService.checkPermission(user.id, pipeline.appName, requiredPerm));
    } else {
        // Fallback checks
        // 1. Target Name
        if (permissionsService.checkAccess(user.id, targetName, 'write')) hasAccess = true;

        // 2. Group extraction
        // If the path contains slashes, the first part is the group.
        const parts = reqPath.split('/');
        let group = "General";
        if (parts.length > 1) {
            group = parts[0];
        }

        if (permissionsService.checkAccess(user.id, group, 'write')) hasAccess = true;
    }

    if (!user.isAdmin && !hasAccess) {
        res.status(403).json({ error: `Permission denied (${requiredPerm} required)` });
        return;
    }

    try {
        if (type !== 'yaml' && type !== 'env') {
            res.status(400).json({ error: "Invalid type" });
            return;
        }
        configController.saveFileContent(type, reqPath, content);
        EZPipelineController.instance.refreshTargets();
        res.json({ message: "File saved successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to save config file: ${reqPath}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post("/config/create-folder", authenticateToken, (req, res) => {
    const { type, path } = req.body;
    // Check permission - Creating a folder is like creating a group.
    // Need global write or admin
    const user = (req as any).user;
    if (!user.isAdmin && !permissionsService.checkAccess(user.id, "*", 'write')) {
        res.status(403).json({ error: "Access denied" });
        return;
    }

    try {
        if (type !== 'yaml' && type !== 'env') {
            res.status(400).json({ error: "Invalid type" });
            return;
        }
        configController.createFolder(type, path);
        res.json({ message: "Folder created successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to create folder: ${path}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post("/config/delete-folder", authenticateToken, (req, res) => {
    const { type, path } = req.body;
    // Check permission
    const user = (req as any).user;
    if (!user.isAdmin && !permissionsService.checkAccess(user.id, "*", 'write')) {
        res.status(403).json({ error: "Access denied" });
        return;
    }

    try {
        if (type !== 'yaml' && type !== 'env') {
            res.status(400).json({ error: "Invalid type" });
            return;
        }
        configController.deleteFolder(type, path);
        EZPipelineController.instance.refreshTargets();
        res.json({ message: "Folder deleted successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to delete folder: ${path}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post("/config/move", authenticateToken, (req, res) => {
    const { type, currentPath, newPath } = req.body;
    // Check permission
    const user = (req as any).user;
    if (user.id !== 1 && !permissionsService.checkAccess(user.id, "*", 'write')) {
        res.status(403).json({ error: "Access denied" });
        return;
    }

    try {
        if (type !== 'yaml' && type !== 'env') {
            res.status(400).json({ error: "Invalid type" });
            return;
        }
        configController.moveFile(type, currentPath, newPath);
        EZPipelineController.instance.refreshTargets();
        res.json({ message: "File moved successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to move file: ${currentPath} -> ${newPath}`, e);
        res.status(500).json({ error: e.message });
    }
});

// Global Resources Routes
router.get("/config/global-resources", authenticateToken, (req, res) => {
    try {
        const resources = configController.getGlobalResources();
        res.json({ files: resources });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post("/config/global-resources/upload", authenticateToken, globalUpload.single('file'), (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
    }

    try {
        configController.saveGlobalResource(req.file.path, req.file.originalname);
        res.json({ message: "File uploaded successfully", name: req.file.originalname });
    } catch (e: any) {
        Logger.getInstance().error("Failed to save global resource", e);
        res.status(500).json({ error: "Failed to save file" });
    }
});

router.delete("/builds/history", authenticateToken, (req, res) => {
    const user = (req as any).user;
    if (!permissionsService.isAdmin(user.id)) {
        res.status(403).json({ error: "Only admins can clear history" });
        return;
    }
    const group = req.query.group as string | undefined;

    try {
        EZPipelineController.instance.clearBuildHistory(group);
        res.json({ message: group ? `Build history for group '${group}' cleared` : "All build history cleared" });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ── Group-scoped resources ──────────────────────────────────────────────────
//
// A deploy key every notch.fm pipeline needs belongs here rather than copied
// into each pipeline, where the copies drift, or instance-wide, where
// FileFreak's pipelines can read it.
//
// The group is a PATH - FileFreak/Client, Notch.fm/Infra - and reaches these
// routes percent-encoded, the same way /api/group-env takes it. Express
// matches the raw path, so %2F stays out of the way of the router and
// req.params.group comes back decoded.

router.get("/config/group-resources/:group", authenticateToken, (req, res) => {
    try {
        res.json({ files: configController.getGroupResources(req.params.group) });
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

router.post("/config/group-resources/:group/upload", authenticateToken, globalUpload.single('file'), (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
    }
    try {
        configController.saveGroupResource(req.params.group, req.file.path, req.file.originalname);
        res.json({ message: "File uploaded successfully", name: req.file.originalname });
    } catch (e: any) {
        // multer already wrote the temp file, and a rejected name or group
        // means nothing moved it. Left alone it accumulates in tmp_uploads.
        try { fs.unlinkSync(req.file.path); } catch { /* already gone */ }
        Logger.getInstance().error("Failed to save group resource", e);
        res.status(400).json({ error: e.message });
    }
});

router.delete("/config/group-resources/:group/:name", authenticateToken, (req, res) => {
    const user = (req as any).user;
    if (!permissionsService.isAdmin(user.id)) {
        res.status(403).json({ error: "Only admins can delete group resources" });
        return;
    }
    try {
        configController.deleteGroupResource(req.params.group, req.params.name);
        res.json({ message: "Resource deleted" });
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

router.delete("/config/global-resources/:name", authenticateToken, (req, res) => {
    const { name } = req.params;
    const user = (req as any).user;
    if (!user.isAdmin) {
        res.status(403).json({ error: "Only admins can delete global resources" });
        return;
    }

    try {
        configController.deleteGlobalResource(name);
        res.json({ message: "Resource deleted" });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Rename folder/group
router.post("/config/rename-folder", authenticateToken, (req, res) => {
    const { type, oldPath, newPath } = req.body;
    const user = (req as any).user;

    // Only admins can rename groups
    if (!permissionsService.isAdmin(user.id)) {
        res.status(403).json({ error: "Only admins can rename groups" });
        return;
    }

    try {
        if (type !== 'yaml' && type !== 'env') {
            res.status(400).json({ error: "Invalid type" });
            return;
        }

        // Use moveFile to rename the folder
        configController.moveFile(type, oldPath, newPath);
        EZPipelineController.instance.refreshTargets();
        res.json({ message: "Folder renamed successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to rename folder: ${oldPath} -> ${newPath}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post("/abort", authenticateToken, (req, res) => {
    const { id } = req.body;
    setImmediate(() => {
        try {
            EZPipelineController.instance.abort(Number(id));
            res.end("ok");
        } catch (e) {
            res.end((e as Error).message);
        }
    });
});

// ── Log stream tickets ──────────────────────────────────────────────────────
//
// EventSource CANNOT SET HEADERS. That is a real browser limitation, and the
// usual workaround - putting the session JWT in the query string - is what was
// here:
//
//     new EventSource(`/api/logs-stream?token=${token}`)
//
// A URL is not a private place. It goes into this server's access log, into any
// proxy in front of it, into browser history, and into the Referer of anything
// the page then loads. That token is a long-lived admin session, so a single
// log line hands somebody the whole application.
//
// A TICKET fixes it without fighting the browser. The client asks for one over
// a normal authenticated request - headers work fine there - and gets back a
// random string that is good for thirty seconds and exactly one connection.
// The ticket still appears in the URL, and it does not matter: by the time
// anybody reads that log line it has expired and been spent.
interface StreamTicket {
    userId: number | string;
    expiresAt: number;
}
const STREAM_TICKETS = new Map<string, StreamTicket>();
/** Long enough to survive a slow page, short enough that a logged URL is stale. */
const TICKET_TTL_MS = 30_000;

function issueStreamTicket(userId: number | string): string {
    // Swept on issue rather than on a timer: this map is only touched when
    // somebody opens a stream, so a background interval would be a wakeup
    // doing nothing on an idle server.
    const now = Date.now();
    for (const [k, v] of STREAM_TICKETS) if (v.expiresAt <= now) STREAM_TICKETS.delete(k);

    const ticket = crypto.randomBytes(32).toString("base64url");
    STREAM_TICKETS.set(ticket, { userId, expiresAt: now + TICKET_TTL_MS });
    return ticket;
}

/** Spend a ticket. Deleted on read, so a replay of the same URL gets nothing. */
function consumeStreamTicket(ticket: string): StreamTicket | null {
    const found = STREAM_TICKETS.get(ticket);
    if (!found) return null;
    STREAM_TICKETS.delete(ticket);
    return found.expiresAt > Date.now() ? found : null;
}

router.post("/logs-stream/ticket", authenticateToken, (req, res) => {
    const user = (req as any).user;
    res.json({ ticket: issueStreamTicket(user.id), expiresIn: TICKET_TTL_MS / 1000 });
});

router.get("/logs-stream", (req: Request, res: Response, next: NextFunction) => {
    // A ticket is the supported way in. The Authorization header still works
    // for anything that can set one - curl, a test, a future non-EventSource
    // client - but the SESSION TOKEN is no longer accepted from the query
    // string, which is the whole point.
    const ticket = typeof req.query.ticket === "string" ? req.query.ticket : null;
    if (ticket && !req.headers.authorization) {
        const claim = consumeStreamTicket(ticket);
        if (!claim) {
            res.status(401).json({ error: "Stream ticket is expired or already used" });
            return;
        }
        (req as any).user = { id: claim.userId };
        (req as any).ticketAuthenticated = true;
    }
    next();
}, (req: Request, res: Response, next: NextFunction) => {
    if ((req as any).ticketAuthenticated) return next();
    return authenticateToken(req, res, next);
}, (req, res) => {
    const logger = Logger.getInstance();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to log stream' })}\n\n`);

    logger.addClient(res);

    // Event Listeners for Pipeline Progress
    const sendEvent = (event: string, data: any) => {
        res.write(`data: ${JSON.stringify({ type: event, data })}\n\n`);
    };

    const controller = EZPipelineController.instance;

    controller.on("build_start", (build: any) => sendEvent("build_start", build));
    controller.on("progress", (build: any) => sendEvent("progress", build));
    controller.on("build_complete", (build: any) => sendEvent("build_complete", build));
    controller.on("build_error", (build: any) => sendEvent("build_error", build));
    controller.on("build_aborted", (build: any) => sendEvent("build_aborted", build));

    // Cleanup listeners on disconnect
    req.on("close", () => {
        controller.off("build_start", sendEvent);
        controller.off("progress", sendEvent);
        controller.off("build_complete", sendEvent);
        controller.off("build_error", sendEvent);
        controller.off("build_aborted", sendEvent);
    });
});

router.delete("/clear-builds", authenticateToken, (req, res) => {
    EZPipelineController.instance.clear_builds();
    res.end();
});

// User Management Routes
router.get("/users", authenticateToken, (req, res) => {
    try {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("SELECT id, username, email, created_at, is_admin as isAdmin, can_manage_users as canManageUsers FROM users");
        const users = stmt.all();
        // Convert to boolean
        const usersMapped = users.map((u: any) => ({
            ...u,
            isAdmin: u.isAdmin === 1,
            canManageUsers: u.canManageUsers === 1
        }));
        res.json({ users: usersMapped });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

router.post("/users", authenticateToken, (req, res) => {
    const { username, password, isAdmin } = req.body;
    const currentUser = (req as any).user;

    // Check if user has permission to create users
    if (!currentUser.isAdmin && !currentUser.canManageUsers) {
        res.status(403).json({ error: "You don't have permission to create users" });
        return;
    }

    // Only admins can create other admins
    if (isAdmin && !currentUser.isAdmin) {
        res.status(403).json({ error: "Only admins can create admin users" });
        return;
    }

    if (!username || !password) {
        res.status(400).json({ error: "Username and password required" });
        return;
    }

    try {
        const db = DatabaseService.getInstance().getDb();
        const hashedPassword = bcrypt.hashSync(password, 10);
        const stmt = db.prepare("INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)");
        stmt.run(username, hashedPassword, isAdmin ? 1 : 0);
        res.json({ message: "User created" });
    } catch (e: any) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ error: "Username already exists" });
        } else {
            res.status(500).json({ error: "Failed to create user" });
        }
    }
});

router.delete("/users/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const currentUser = (req as any).user;

    if (parseInt(id) === currentUser.id) {
        res.status(400).json({ error: "Cannot delete yourself" });
        return;
    }

    // Protect primary admin from deletion
    if (permissionsService.isPrimaryAdmin(Number(id))) {
        res.status(403).json({ error: "Cannot delete primary admin" });
        return;
    }

    // Check if current user can modify target user
    if (!permissionsService.canModifyUser(currentUser.id, Number(id))) {
        res.status(403).json({ error: "Insufficient permissions to delete this user" });
        return;
    }

    try {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("DELETE FROM users WHERE id = ?");
        stmt.run(id);
        res.json({ message: "User deleted" });
    } catch (e) {
        res.status(500).json({ error: "Failed to delete user" });
    }
});

// Agent Token Management
const agentService = AgentService.getInstance();

router.get("/agent-tokens", authenticateToken, (req, res) => {
    try {
        const tokens = agentService.listTokens();
        res.json({ tokens });
    } catch (e) {
        res.status(500).json({ error: "Failed to list tokens" });
    }
});

router.post("/agent-tokens", authenticateToken, async (req, res) => {
    const { name } = req.body;
    if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
    }
    try {
        const result = await agentService.createToken(name);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: "Failed to create token" });
    }
});

router.delete("/agent-tokens/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        agentService.deleteToken(Number(id));
        res.json({ message: "Token revoked" });
    } catch (e) {
        res.status(500).json({ error: "Failed to revoke token" });
    }
});

// Schedule Management Routes
router.get("/schedules", authenticateToken, (req, res) => {
    try {
        const schedules = scheduler.getAllSchedules();
        res.json({ schedules });
    } catch (e) {
        Logger.getInstance().error(`Failed to get schedules: ${e}`);
        res.status(500).json({ error: "Failed to get schedules" });
    }
});

router.get("/schedules/:pipeline", authenticateToken, (req, res) => {
    const { pipeline } = req.params;
    try {
        const schedules = scheduler.getSchedulesForPipeline(pipeline);
        res.json({ schedules });
    } catch (e) {
        Logger.getInstance().error(`Failed to get schedules for pipeline: ${e}`);
        res.status(500).json({ error: "Failed to get schedules" });
    }
});

router.post("/schedules", authenticateToken, (req, res) => {
    const { pipelineTarget, cronExpression } = req.body;
    const user = (req as any).user;

    // Check if user has permission to run the pipeline
    if (!permissionsService.checkPermission(user.id, pipelineTarget, 'run')) {
        res.status(403).json({ error: "You don't have permission to schedule this pipeline" });
        return;
    }

    try {
        const scheduleId = scheduler.addSchedule(pipelineTarget, cronExpression, user.id);
        res.json({ scheduleId, message: "Schedule created successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to create schedule: ${e}`);
        res.status(400).json({ error: e.message || "Failed to create schedule" });
    }
});

router.delete("/schedules/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const user = (req as any).user;

    // Only admins or the creator can delete schedules
    if (!permissionsService.isAdmin(user.id)) {
        res.status(403).json({ error: "Only admins can delete schedules" });
        return;
    }

    try {
        scheduler.removeSchedule(Number(id));
        res.json({ message: "Schedule deleted successfully" });
    } catch (e) {
        Logger.getInstance().error(`Failed to delete schedule: ${e}`);
        res.status(500).json({ error: "Failed to delete schedule" });
    }
});

// Plugin Management Routes
router.get("/plugins", authenticateToken, async (req, res) => {
    try {
        const plugins = await pluginManager.refreshPlugins();
        res.json({ plugins });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch plugins" });
    }
});

router.post("/plugins/:id/install", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const user = (req as any).user;
    if (!user.isAdmin) {
        res.status(403).json({ error: "Only admins can install plugins" });
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked'
    });

    try {
        await pluginManager.installPlugin(id, (log) => {
            res.write(log);
        });
        res.write("\nDONE\n");
        res.end();
    } catch (e: any) {
        res.write(`\nERROR: ${e.message}\n`);
        res.end();
    }
});

router.patch("/schedules/:id/toggle", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { enabled } = req.body;
    const user = (req as any).user;

    // Only admins can toggle schedules
    if (!permissionsService.isAdmin(user.id)) {
        res.status(403).json({ error: "Only admins can toggle schedules" });
        return;
    }

    try {
        scheduler.toggleSchedule(Number(id), enabled);
        res.json({ message: `Schedule ${enabled ? 'enabled' : 'disabled'} successfully` });
    } catch (e) {
        Logger.getInstance().error(`Failed to toggle schedule: ${e}`);
        res.status(500).json({ error: "Failed to toggle schedule" });
    }
});

// Resource Management
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const type = req.body.type === 'env' ? 'env' : 'yaml';
            const subPath = req.body.path || '';

            let dest;
            if (type === 'yaml') {
                // Use the correct PIPELINES_DIR from config
                dest = path.resolve(PIPELINES_DIR, subPath);
            } else {
                dest = path.resolve(process.cwd(), type, subPath);
            }

            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        }
    })
});

router.post("/config/upload", authenticateToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) throw new Error("No file uploaded");
        Logger.getInstance().info(`File uploaded: ${req.file.path}`);
        if (req.file.filename.endsWith('.yaml') || req.file.filename.endsWith('.yml')) {
            EZPipelineController.instance.refreshTargets();
        }
        res.json({ message: "File uploaded successfully", path: req.file.path });
    } catch (e: any) {
        Logger.getInstance().error("Upload failed", e);
        res.status(500).json({ error: e.message });
    }
});

router.get("/config/resources", authenticateToken, (req, res) => {
    try {
        const type = (req.query.type as "yaml" | "env") || "yaml";
        const subPath = (req.query.path as string) || "";
        const files = configController.listFiles(type, subPath);
        res.json({ files });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete("/config/resources", authenticateToken, (req, res) => {
    try {
        const { type, path } = req.body;
        if (!path) {
            res.status(400).json({ error: "Path is required" });
            return;
        }
        configController.deleteFile(type || 'yaml', path);
        if (path.endsWith('.yaml') || path.endsWith('.yml')) {
            EZPipelineController.instance.refreshTargets();
        }
        res.json({ message: "File deleted successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to delete resource: ${path}`, e);
        res.status(500).json({ error: e.message });
    }
});


// Build Approval and Abort Routes
//
// BOTH OF THESE USED TO BE authenticateToken AND NOTHING ELSE, which meant any
// account that could sign in could release anybody's manual gate or kill
// anybody's running deploy. A gate that anyone can open is not a gate, and it
// is why pipelines in this install grew defensive workarounds - whatif-gate.py
// protects a destructive plan with an exit code rather than with a manual
// approval, precisely because the approval could not be trusted.
//
// The permission is `canRun` on the build's own pipeline: releasing a gate
// resumes a run, and aborting stops one. Both are the same authority as
// starting it, so neither should need a different grant.
//
// Admins and single-user installs are unaffected - checkPermission returns
// true for an admin, and for every caller when AUTH_CONFIG.required is off.

/**
 * The pipeline a build belongs to, or null if there is no such build.
 *
 * `builds.target` is the pipeline name, and it is the only link between a
 * build id and anything the permission model knows about.
 */
function pipelineOfBuild(buildId: string): string | null {
    const build = buildService.getBuild(buildId);
    return (build?.target as string | undefined) ?? null;
}

/**
 * Refuse unless this user may run that build's pipeline.
 *
 * A MISSING BUILD IS A 404 AND NOT AN APPROVAL. The order matters: looking the
 * build up first means an unknown id can never fall through to the controller,
 * which would otherwise be asked to approve something nobody can name.
 */
function mayControlBuild(req: any, res: any, buildId: string): boolean {
    const user = req.user;
    const pipeline = pipelineOfBuild(buildId);
    if (!pipeline) {
        res.status(404).json({ error: "No such build." });
        return false;
    }
    if (!permissionsService.checkPermission(user.id, pipeline, 'run')) {
        Logger.getInstance().warn(
            `Denied: ${user.username} tried to control build ${buildId} on ${pipeline}`
        );
        res.status(403).json({ error: `You do not have permission to run ${pipeline}.` });
        return false;
    }
    return true;
}

router.post("/builds/:id/approve", authenticateToken, (req, res) => {
    try {
        const buildId = req.params.id; // UUID
        if (!mayControlBuild(req, res, buildId)) return;
        EZPipelineController.instance.approveBuild(buildId);
        res.json({ message: "Build approved and resumed." });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to approve build ${req.params.id}`, e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * Press an anytime action on a build.
 *
 * An `action` step never runs as part of the pipeline: it sits on the build
 * and waits. This is the press. See services/ActionRunner.ts for why the
 * chain stops at the first failure.
 *
 * GUARDED THE SAME WAY A RUN IS. "Merge develop into main and deploy
 * production" is at least as consequential as starting the pipeline, so it
 * takes the same permission, not a lesser one because it looks like a button.
 */
router.post("/builds/:id/action", authenticateToken, async (req, res) => {
    try {
        const buildId = req.params.id;
        if (!mayControlBuild(req, res, buildId)) return;

        const stepName = typeof req.body?.step === "string" ? req.body.step : "";
        if (!stepName) {
            res.status(400).json({ error: "which step? send { step: <name> }" });
            return;
        }

        const controller = EZPipelineController.instance;
        // Read from disk, not from the copy loaded at boot: an action edited in
        // the UI should be the one that runs, and a stale chain here would do
        // the old thing while the screen showed the new one.
        controller.refreshTargets();

        const build = BuildService.getInstance().getBuild(buildId);
        if (!build) {
            res.status(404).json({ error: "No such build." });
            return;
        }
        const pipeline = controller.targets.find((t) => t.id === build.target);
        const step = pipeline?.steps.find((s) => s.name === stepName);
        if (!pipeline || !step) {
            res.status(404).json({ error: `No step "${stepName}" on this pipeline.` });
            return;
        }
        if (step.type !== "action") {
            res.status(400).json({ error: `"${stepName}" is not an anytime action.` });
            return;
        }
        const actions = Array.isArray(step.actions) ? step.actions : [];
        if (actions.length === 0) {
            res.status(400).json({ error: `"${stepName}" has no actions configured.` });
            return;
        }

        // The repository this pipeline watches AND the group it belongs to, so
        // a merge does not have to name what a watch already knows, and a git
        // write can find the credential configured for this group rather than
        // falling back to whatever the server host happens to have.
        let defaultRepoUrl: string | undefined;
        let group: string | undefined;
        try {
            const row = DatabaseService.getInstance()
                .getDb()
                .prepare(`SELECT repo_url, group_path FROM git_watches WHERE pipeline_target = ? LIMIT 1`)
                .get(build.target) as { repo_url?: string; group_path?: string } | undefined;
            defaultRepoUrl = row?.repo_url;
            group = row?.group_path ?? undefined;
        } catch {
            /* a watch is optional; the action can still name its own repo */
        }

        const actor = (req as any).user?.username ?? "someone";
        const result = await runActionChain(actions as any, {
            buildId,
            pipelineTarget: build.target,
            actor,
            defaultRepoUrl,
            group,
            pipelineExists: (t) => controller.targets.some((x) => x.id === t),
            startPipeline: (t, triggeredBy, autoApprove) => {
                controller.run(t, undefined, { triggeredBy, autoApprove });
            },
        });

        res.status(result.ok ? 200 : 500).json(result);
    } catch (e: any) {
        Logger.getInstance().error(`Action failed on build ${req.params.id}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post("/builds/:id/abort", authenticateToken, (req, res) => {
    try {
        const buildId = req.params.id; // UUID or number
        if (!mayControlBuild(req, res, buildId)) return;
        EZPipelineController.instance.abort(buildId);
        res.json({ message: "Build aborted." });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to abort build ${req.params.id}`, e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * Roll a pipeline back to what an earlier run deployed.
 *
 * WHAT THIS IS NOT: re-running the old build. That would rebuild from source
 * and produce a NEW image, which is not a rollback - it is a rerun that
 * happens to start from older code, and it fails the moment a dependency has
 * moved underneath it.
 *
 * What it does is start the pipeline again with the earlier run's IMAGE TAG
 * pinned, so the deploy step points the runtime at an image that already
 * exists in the registry. Nothing is rebuilt and nothing is copied - the
 * registry is already the artifact store, which is why EZPIPELINE does not
 * need to be one.
 *
 * THE PIPELINE HAS TO MEET IT HALF WAY, and that is stated rather than hidden:
 * EZPIPELINE sets the variables, and a pipeline decides what to do with them.
 * One that ignores EZP_IMAGE_TAG will simply rebuild, which is a no-op rollback
 * rather than a broken one. ci-cd/pipelines/deploy-dev.yaml in notch.fm is the
 * reference implementation.
 */
router.post("/builds/:id/rollback", authenticateToken, async (req, res): Promise<void> => {
    try {
        const buildId = req.params.id;
        if (!mayControlBuild(req, res, buildId)) return;

        const db = DatabaseService.getInstance().getDb();
        const build = db.prepare(
            "SELECT id, target, build_number, status, commit_sha FROM builds WHERE id = ?"
        ).get(buildId) as { id: string; target: string; build_number: number; status: string; commit_sha: string | null } | undefined;
        if (!build) { res.status(404).json({ error: "No such build." }); return; }
        if (build.status !== "success") {
            // A failed run's images may exist but were never proved to work.
            // Offering them is offering a rollback to something that was
            // rejected the first time.
            res.status(400).json({ error: "Only a successful run can be rolled back to." });
            return;
        }

        const artifacts = ProvenanceService.getInstance().artifactsFor(build.id);
        const targets = artifacts.filter((a) => ProvenanceService.isRollbackable(a));
        if (targets.length === 0) {
            res.status(400).json({
                error: "That run recorded no image with a fixed tag, so there is nothing to point at. " +
                    "Images tagged only `latest` cannot be rolled back to, because that tag has since moved.",
            });
            return;
        }

        // ONE TAG IS THE COMMON CASE and the useful one: a pipeline that tags
        // every image it builds with the same commit sha. When a run produced
        // several different tags there is no single answer, so the references
        // are passed whole and the pipeline decides.
        const tags = [...new Set(targets.map((a) => a.tag).filter(Boolean) as string[])];
        const envOverrides: Record<string, string> = {
            EZP_ROLLBACK: "1",
            EZP_ROLLBACK_FROM_BUILD: String(build.build_number),
            EZP_IMAGE_REFS: targets.map((a) => a.reference).join(","),
        };
        if (tags.length === 1) envOverrides.EZP_IMAGE_TAG = tags[0]!;
        if (build.commit_sha) envOverrides.EZP_ROLLBACK_COMMIT = build.commit_sha;

        const user = (req as any).user?.username ?? "unknown";
        void EZPipelineController.instance.run(build.target, undefined, {
            triggeredBy: `rollback to #${build.build_number} by ${user}`,
            envOverrides,
        });

        res.json({
            message: `Rolling back to build #${build.build_number}.`,
            tag: tags.length === 1 ? tags[0] : null,
            references: targets.map((a) => a.reference),
        });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to roll back to build ${req.params.id}`, e);
        res.status(500).json({ error: e.message });
    }
});

// Versioning & Rollback Routes
router.get("/pipelines/:targetName/versions", authenticateToken, (req, res) => {
    try {
        const { targetName } = req.params;
        const pipelineDir = EZPipelineController.instance.resolvePipelineDir(targetName);
        const versionsDir = path.join(pipelineDir, "versions");

        if (!fs.existsSync(versionsDir)) {
            res.json({ versions: [] });
            return;
        }

        const files = fs.readdirSync(versionsDir);
        const versions = files.filter(f => f.endsWith('.zip') || f.endsWith('.tar.gz')).map(f => {
            const stats = fs.statSync(path.join(versionsDir, f));
            return {
                name: f,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime
            };
        }).sort((a, b) => b.modified.getTime() - a.modified.getTime()); // Newest first

        res.json({ versions });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to list versions for ${req.params.targetName}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.delete("/pipelines/:targetName/versions/:filename", authenticateToken, (req, res) => {
    try {
        const { targetName, filename } = req.params;
        // Security check: filename should be just a name
        if (filename.includes('/') || filename.includes('\\')) throw new Error("Invalid filename");

        const pipelineDir = EZPipelineController.instance.resolvePipelineDir(targetName);
        const filePath = path.join(pipelineDir, "versions", filename);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ message: "Version deleted successfully" });
        } else {
            res.status(404).json({ error: "Version file not found" });
        }
    } catch (e: any) {
        Logger.getInstance().error(`Failed to delete version ${req.params.filename}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.get("/pipelines/:targetName/versions/:filename/download", authenticateToken, (req, res) => {
    try {
        const { targetName, filename } = req.params;
        if (filename.includes('/') || filename.includes('\\')) throw new Error("Invalid filename");

        const pipelineDir = EZPipelineController.instance.resolvePipelineDir(targetName);
        const filePath = path.join(pipelineDir, "versions", filename);

        if (fs.existsSync(filePath)) {
            res.download(filePath);
        } else {
            res.status(404).json({ error: "Version file not found" });
        }
    } catch (e: any) {
        Logger.getInstance().error(`Failed to download version ${req.params.filename}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.get("/pipelines/:targetName/rollback-plan", authenticateToken, (req, res) => {
    try {
        const { targetName } = req.params;
        const plan = EZPipelineController.instance.generateRollbackPlan(targetName);
        res.json({ plan });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to generate rollback plan for ${req.params.targetName}`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post("/pipelines/:targetName/rollback", authenticateToken, async (req, res) => {
    try {
        const { targetName } = req.params;
        const { version, smartRollbackYaml } = req.body;

        if (!version) {
            res.status(400).json({ error: "Version is required" });
            return;
        }

        // Version comes as "1.0.0" or "1.0.0.zip"?
        // UI likely sends "1.0.0". Controller expects "1.0.0".
        // Controller looks for `${version}.zip`.
        // If filename is passed complete (e.g. "1.0.0.zip"), we should strip extension?
        // Let's assume UI sends exact string that was in valid list (filename).
        // If list returned "1.0.0.zip", user sends "1.0.0.zip".
        // Controller does: `path.join(versionsDir, ${version}.zip)`.
        // So we need to strip extension if present.

        let versionTag = version;
        if (version.endsWith('.zip')) {
            versionTag = version.replace('.zip', '');
        }

        await EZPipelineController.instance.rollback(targetName, versionTag, smartRollbackYaml);
        res.json({ message: "Rollback initiated successfully" });
    } catch (e: any) {
        Logger.getInstance().error(`Failed to rollback ${req.params.targetName}`, e);
        res.status(500).json({ error: e.message });
    }
});

// Settings Routes
// ── Mail ────────────────────────────────────────────────────────────────────
//
// Provider-agnostic. These replaced three SMTP-only routes, one of which
// returned the stored password to the browser UNMASKED - it masked the value
// that came from the environment and not the one in the database, which is the
// wrong way round, since the database one is the one an operator typed and
// forgot about.
//
// NO ROUTE HERE EVER RETURNS A CREDENTIAL. The form is told whether each secret
// is set, which is all it needs to render, and a blank secret on save means
// "unedited" rather than "clear it".

router.get("/settings/mail/providers", authenticateToken, (req, res) => {
    const user = (req as any).user;
    if (!user.isAdmin) {
        res.status(403).json({ error: "Access denied" });
        return;
    }
    const mail = MailService.getInstance();
    res.json({
        selected: mail.selectedProviderId(),
        configured: mail.isConfigured(),
        providers: PROVIDERS.map(p => ({
            id: p.id,
            label: p.label,
            blurb: p.blurb,
            fields: p.fields,
        })),
    });
});

router.get("/settings/mail", authenticateToken, (req, res) => {
    const user = (req as any).user;
    if (!user.isAdmin) {
        res.status(403).json({ error: "Access denied" });
        return;
    }
    const mail = MailService.getInstance();
    const which = typeof req.query.provider === "string" ? req.query.provider : mail.selectedProviderId();
    if (!providerById(which)) {
        res.status(404).json({ error: "Unknown mail provider" });
        return;
    }
    res.json({ ...mail.describeConfig(which), selected: mail.selectedProviderId() });
});

router.post("/settings/mail", authenticateToken, (req, res) => {
    const user = (req as any).user;
    if (!user.isAdmin) {
        res.status(403).json({ error: "Access denied" });
        return;
    }
    const { provider, values } = req.body ?? {};
    if (typeof provider !== "string" || !providerById(provider)) {
        res.status(400).json({ error: "A known provider id is required" });
        return;
    }
    try {
        MailService.getInstance().saveConfig(provider, (values ?? {}) as Record<string, unknown>);
        // The provider is named; the values are not, because half of them are
        // credentials and this line goes to the shared log view.
        Logger.getInstance().info(`User ${user.username} saved mail settings for ${provider}`);
        res.json({ message: "Settings saved" });
    } catch (e) {
        Logger.getInstance().error("Failed to save mail settings", e);
        res.status(500).json({ error: "Failed to save settings" });
    }
});

router.post("/settings/mail/test", authenticateToken, async (req, res) => {
    const user = (req as any).user;
    if (!user.isAdmin) {
        res.status(403).json({ error: "Access denied" });
        return;
    }
    const { to } = req.body ?? {};
    if (typeof to !== "string" || !to.includes("@")) {
        res.status(400).json({ error: "A recipient address is required" });
        return;
    }
    // The provider's OWN reason is returned. "Check server logs" was the old
    // answer, and it is the least useful sentence available when the actual
    // problem is a sender address the provider has not verified.
    const result = await MailService.getInstance().verify(to);
    if (result.ok) {
        res.json({ message: "Test message sent" });
    } else {
        res.status(400).json({ error: result.error ?? "The provider did not accept the message" });
    }
});

// Preferences Persistence Routes
const PREFERENCES_FILE = path.join(DATA_DIR, 'preferences.json');

router.get("/settings/preferences", authenticateToken, (req, res) => {
    try {
        if (fs.existsSync(PREFERENCES_FILE)) {
            const content = fs.readFileSync(PREFERENCES_FILE, 'utf-8');
            res.json(JSON.parse(content));
        } else {
            res.json({});
        }
    } catch (e) {
        Logger.getInstance().error("Failed to read preferences", e);
        res.status(500).json({ error: "Failed to read preferences" });
    }
});

router.post("/settings/preferences", authenticateToken, (req, res) => {
    const { envTagColors, envTagLabels } = req.body;
    try {
        let current = {};
        if (fs.existsSync(PREFERENCES_FILE)) {
            current = JSON.parse(fs.readFileSync(PREFERENCES_FILE, 'utf-8'));
        }

        // Merge updates
        const updated = {
            ...current,
            ...(envTagColors ? { envTagColors } : {}),
            ...(envTagLabels ? { envTagLabels } : {})
        };

        fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(updated, null, 2));
        res.json(updated);
    } catch (e) {
        Logger.getInstance().error("Failed to save preferences", e);
        res.status(500).json({ error: "Failed to save preferences" });
    }
});

export default router;
