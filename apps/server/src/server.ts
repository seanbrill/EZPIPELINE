import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config/secret.js";
import app from "./app.js";
import agentRoutes from "./routes/agent.js";
import aiRoutes from "./routes/ai.js";
// API Routes (Moved below)
import terminalRoutes from "./routes/terminal.js";
import EZPipelineController from "./controllers/EZPipelineController.js";
import Logger from "./controllers/Logger.js";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { Server } from "socket.io";
import http from "http";
import { PORT, PUBLIC_DIR } from "./config/index.js";

import { ConfigController } from "./controllers/ConfigController.js";
// Load global env variables immediately
ConfigController.getInstance().loadGlobalEnv();

EZPipelineController.initialize();
import { DatabaseService } from "./services/Database.js";
import { migrateToGranularPermissions } from "./migrations/001_granular_permissions.js";
import { migrateSchedules } from "./migrations/002_schedules.js";
import { migrateCanManageUsers } from "./migrations/003_can_manage_users.js";
import { migrateTerminalPermission } from "./migrations/004_terminal_permission.js";
import { migratePendingEmail } from "./migrations/005_pending_email.js";
import { migrateUserDevices } from "./migrations/006_user_devices.js";
import { migrateGranularPermissions } from "./migrations/007_granular_permissions.js";
import { migrateGitWatches } from "./migrations/008_git_watches.js";
import { migrateBuildTriggeredBy } from "./migrations/009_build_triggered_by.js";
import { migrateBuildProvenance } from "./migrations/010_build_provenance.js";
import { migrateGitCredentials } from "./migrations/011_git_credentials.js";
import { migrateGitCredentialReads } from "./migrations/012_git_credential_reads.js";
import { migrateV2Groundwork } from "./migrations/013_v2_groundwork.js";
import { migrateSubsteps } from "./migrations/014_substeps.js";
import { migrateApiTokens } from "./migrations/015_api_tokens.js";
import { migrateLogLevel } from "./migrations/016_log_level.js";
import { SchedulerService } from "./services/SchedulerService.js";
import { BuildService } from "./services/BuildService.js";
import { GitWatchService } from "./services/GitWatchService.js";

// Initialize database
const dbService = DatabaseService.getInstance();

// Run migrations (only runs if needed)
try {
    migrateToGranularPermissions();
} catch (e) {
    Logger.getInstance().warn(`Migration skipped or already applied: ${e}`);
}

try {
    migrateSchedules();
} catch (e) {
    Logger.getInstance().warn(`Schedules migration skipped or already applied: ${e}`);
}

try {
    migrateCanManageUsers();
} catch (e) {
    Logger.getInstance().warn(`Can manage users migration skipped or already applied: ${e}`);
}

try {
    migrateTerminalPermission();
} catch (e) {
    Logger.getInstance().warn(`Terminal permission migration skipped or already applied: ${e}`);
}

try {
    migratePendingEmail();
} catch (e) {
    Logger.getInstance().warn(`Pending email migration skipped or already applied: ${e}`);
}

try {
    migrateUserDevices();
} catch (e) {
    Logger.getInstance().warn(`User devices migration skipped or already applied: ${e}`);
}

try {
    migrateGranularPermissions();
} catch (e) {
    Logger.getInstance().warn(`Granular permissions migration skipped or already applied: ${e}`);
}

try {
    migrateGitWatches();
} catch (e) {
    Logger.getInstance().warn(`Git watches migration skipped or already applied: ${e}`);
}

try {
    migrateBuildTriggeredBy();
    migrateBuildProvenance();
    migrateGitCredentials();
    migrateGitCredentialReads();
    migrateV2Groundwork();
    migrateSubsteps();
    migrateApiTokens();
    migrateLogLevel();
} catch (e) {
    Logger.getInstance().warn(`Build triggered_by migration skipped or already applied: ${e}`);
}

// A build that was running when this process last stopped is not running now.
//
// BEFORE THE SCHEDULER AND THE GIT WATCH, deliberately. Both of them refuse to
// start a build for a target that already has one running, so an orphaned row
// does not merely look wrong - it silently stops every future automatic deploy
// of that pipeline until somebody notices. Settling it first means they start
// from the truth.
try {
    const orphaned = BuildService.getInstance().failOrphanedBuilds();
    if (orphaned > 0) {
        Logger.getInstance().warn(
            `Marked ${orphaned} build(s) as failed: they were running when the server last stopped.`
        );
    }
} catch (e) {
    Logger.getInstance().error(`Could not reconcile orphaned builds: ${e}`);
}

// Initialize scheduler
const scheduler = SchedulerService.getInstance();
scheduler.loadSchedules();

// Poll watched branches and run their pipelines when the head moves.
GitWatchService.getInstance().start();

// API Routes
app.use("/api/agent", agentRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/terminal", terminalRoutes);

// An /api path that matched nothing, by any method, is a mistake in the
// caller: say so in JSON. Without this a GET got index.html with a 200 and a
// POST got Express's HTML error page.
app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found', message: `There is no ${req.method} ${req.baseUrl}${req.path === '/' ? '' : req.path}.` });
});

// Serve static client files (Architecture Overhaul)
app.use(express.static(PUBLIC_DIR));

// Catch-all route for SPA client routing
app.get(/(.*)/, (req: Request, res: Response, next: NextFunction) => {
    if (req.accepts('json') && !req.accepts('html')) {
        res.status(404).json({ error: 'Not Found' });
        return;
    }
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Configure properly in production
        methods: ["GET", "POST"]
    }
});

const activeSockets = new Map();

app.set("io", io);
app.set("sockets", activeSockets);

// A socket is someone signed in: the assistant and the terminal stream to it,
// and they check it is the same person who asked.
io.use((socket, next) => {
    const token = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : "";
    try {
        const d = jwt.verify(token, JWT_SECRET) as { id?: number; scope?: string };
        if (d.scope || typeof d.id !== "number") throw new Error("not a session");
        socket.data.userId = d.id;
        next();
    } catch {
        next(new Error("Sign in first."));
    }
});

io.on("connection", (socket) => {
    Logger.getInstance().info(`Socket connected: ${socket.id}`);
    activeSockets.set(socket.id, socket);

    socket.on("disconnect", () => {
        Logger.getInstance().info(`Socket disconnected: ${socket.id}`);
        activeSockets.delete(socket.id);
    });
});

// EZP_HOST: the desktop app binds 127.0.0.1, so only this computer can reach it.
const HOST = process.env.EZP_HOST || undefined;
server.listen(Number(PORT), HOST as string, () => {
    Logger.getInstance().info(`Server running at http://${HOST ?? "localhost"}:${PORT}`);
    Logger.getInstance().info(`Serving client from: ${PUBLIC_DIR}`);
});
