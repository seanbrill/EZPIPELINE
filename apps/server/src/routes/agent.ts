import { Router } from "express";
import { AgentService } from "../services/AgentService.js";
import { ConfigController } from "../controllers/ConfigController.js";
import Logger from "../controllers/Logger.js";

const router = Router();
const agentService = AgentService.getInstance();
const configController = ConfigController.getInstance(); // Reuse config controller logic

// Middleware to validate Agent Token
const authenticateAgent = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.split(" ")[1];
    // Check if it's an agent token
    const isValid = await agentService.validateToken(token);
    if (!isValid) {
        return res.status(403).json({ error: "Invalid or expired Agent Token" });
    }

    // Attach agent info if needed, but validateToken updates usage.
    next();
};

// Agent Configuration Endpoints
router.use(authenticateAgent);

// Authentication is handled by authenticateAgent middleware defined above

// GET /agent/config
router.get("/config", (req, res) => {
    const { path } = req.query;
    if (!path || typeof path !== 'string') {
        res.status(400).json({ error: "Path is required" });
        return;
    }

    // Explicitly forbid env files just in case ConfigController allows them
    if (path.includes(".env") || path.includes("/env/")) {
        res.status(403).json({ error: "Access to environment files is forbidden." });
        return;
    }

    try {
        const content = configController.getFileContent("yaml", path);
        res.json({ content });
    } catch (e: any) {
        Logger.getInstance().error("Agent config fetch failed", e);
        if (e.message === "File not found") {
            res.status(404).json({ error: "File not found" });
        } else {
            res.status(500).json({ error: "Failed to fetch config" });
        }
    }
});

// POST /agent/config
// Body: path, content
router.post("/config", (req, res) => {
    const { path, content } = req.body;

    if (!path || !content) {
        res.status(400).json({ error: "Path and content are required" });
        return;
    }

    if (path.includes(".env") || path.includes("/env/")) {
        res.status(403).json({ error: "Access to environment files is forbidden." });
        return;
    }

    // Ensure file extension is yaml/yml
    if (!path.endsWith('.yaml') && !path.endsWith('.yml')) {
        res.status(400).json({ error: "Only .yaml and .yml files are allowed." });
        return;
    }

    try {
        configController.saveFileContent("yaml", path, content);
        res.json({ success: true, message: "Configuration updated" });
    } catch (e: any) {
        Logger.getInstance().error("Agent config save failed", e);
        res.status(500).json({ error: "Failed to save config" });
    }
});

export default router;
