import { Router } from "express";
import { TerminalService } from "../services/TerminalService.js";
import { PermissionsService } from "../services/PermissionsService.js";
import { authenticateToken } from "../middleware/auth.js";
import Logger from "../controllers/Logger.js";

const router = Router();
const terminalService = TerminalService.getInstance();
const permissionsService = PermissionsService.getInstance();

// Check if user has terminal access
router.get("/check-access", authenticateToken, async (req, res) => {
    const userId = (req as any).user.id;

    // Check if user has terminal permission
    const hasAccess = permissionsService.isAdmin(userId) ||
        permissionsService.checkPermission(userId, "*", "useTerminal");

    res.json({ hasAccess });
});

// Create a new terminal session
router.post("/create", authenticateToken, async (req, res) => {
    const userId = (req as any).user.id;
    const { socketId } = req.body;

    // Verify permission
    const hasAccess = permissionsService.isAdmin(userId) ||
        permissionsService.checkPermission(userId, "*", "useTerminal");

    if (!hasAccess) {
        res.status(403).json({ error: "Terminal access denied" });
        return;
    }

    try {
        const io = req.app.get("io");
        const activeSockets = req.app.get("sockets");
        const socket = activeSockets?.get(socketId);

        const emitFn = (event: string, data: any) => {
            if (socket) {
                socket.emit(event, data);
            } else {
                io.emit(event, data);
            }
        };

        const sessionId = terminalService.createSession(userId, emitFn);

        Logger.getInstance().info(`[Terminal] Session ${sessionId} created for user ${userId}`);
        res.json({ sessionId, success: true });
    } catch (error: any) {
        Logger.getInstance().error(`[Terminal] Failed to create session: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Send input to terminal
router.post("/input", authenticateToken, async (req, res) => {
    const userId = (req as any).user.id;
    const { sessionId, input } = req.body;

    const session = terminalService.getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
    }

    // Verify session ownership
    if (session.userId !== userId) {
        res.status(403).json({ error: "Unauthorized" });
        return;
    }

    const success = terminalService.sendInput(sessionId, input);
    res.json({ success });
});

// Kill terminal session
router.post("/kill", authenticateToken, async (req, res) => {
    const userId = (req as any).user.id;
    const { sessionId } = req.body;

    const session = terminalService.getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
    }

    // Verify session ownership or admin
    if (session.userId !== userId && !permissionsService.isAdmin(userId)) {
        res.status(403).json({ error: "Unauthorized" });
        return;
    }

    const success = terminalService.killSession(sessionId);
    res.json({ success });
});

export default router;
