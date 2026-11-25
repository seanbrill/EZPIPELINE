// The assistant's HTTP surface.
//
// Everything the assistant actually does lives in services/AnthropicAssistant.ts.
// This file exists to turn a POST into a socket stream.
//
// Three actions: spawn (start or restart the conversation), input (send a
// message, streamed back over the socket) and kill (discard it). The event
// names keep their claude-* prefix, which the client listens for.
//
// OUTPUT IS SENT TO ONE SOCKET, NEVER BROADCAST. The previous version fell back
// to io.emit() whenever it could not find the requesting socket, which sends
// one operator's assistant transcript - including pipeline contents and
// variable names - to every browser connected to the server. There is no
// fallback here: if the socket is gone, there is nobody to stream to and the
// request says so.

import { Router } from "express";
import type { Request, Response } from "express";
import type { Server as SocketIOServer, Socket } from "socket.io";
import { AnthropicAssistant } from "../services/AnthropicAssistant.js";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { PermissionsService } from "../services/PermissionsService.js";
import Logger from "../controllers/Logger.js";

const router = Router();
const assistant = AnthropicAssistant.getInstance();

/**
 * Resolves the caller's socket, or explains why there is nothing to stream to.
 * Returns null after answering the request, so callers just return.
 */
function resolveSocket(req: Request, res: Response): Socket | null {
    const io: SocketIOServer | undefined = req.app.get("io");
    if (!io) {
        // Only reachable if server.ts changed; worth naming rather than
        // reporting as a generic 500.
        res.status(503).json({
            error: "sockets_unavailable",
            message: "The server is running without Socket.IO, so the assistant has no way to send its answers back.",
        });
        return null;
    }

    const socketId = typeof req.body?.socketId === "string" ? req.body.socketId : "";
    if (!socketId) {
        res.status(400).json({
            error: "socket_id_required",
            message: "The assistant streams its answer over the websocket, so the request has to say which socket to send it to.",
        });
        return null;
    }

    const sockets: Map<string, Socket> | undefined = req.app.get("sockets");
    const socket = sockets?.get(socketId);
    if (!socket) {
        res.status(409).json({
            error: "socket_not_connected",
            message: "That websocket is no longer connected, so there is nowhere to stream the answer. Reload the page and try again.",
        });
        return null;
    }
    // Someone else's socket id would stream this answer into their browser.
    if (socket.data?.userId !== (req as any).user?.id) {
        res.status(403).json({ error: "socket_not_yours", message: "That websocket belongs to another session. Reload the page and try again." });
        return null;
    }
    return socket;
}

// ── Status ──────────────────────────────────────────────────────────────────

/** { engine, configured, model, message }: the assistant answers when the server has a key. */
/**
 * The `useClaude` permission, actually enforced.
 *
 * It was defined in PermissionsService, stored per user, surfaced per target
 * in the API and shown as a checkbox in the admin screen - and no route ever
 * consulted it. Any account that could log in could drive the assistant, which
 * reads and rewrites pipeline YAML. A permission that nothing checks is worse
 * than an absent one, because the screen says the restriction is in force.
 *
 * The check here is "useClaude on any target", because the assistant is not
 * opened against one pipeline. Each tool call is then checked against the
 * pipeline it touches (services/AnthropicAssistant.ts, mayOnPipeline), so
 * useClaude on one pipeline reaches that pipeline only.
 */
function requireClaudePermission(req: AuthRequest, res: Response): boolean {
    const permissions = PermissionsService.getInstance();
    const user = req.user;
    if (!user?.id) {
        res.status(401).json({ error: "unauthenticated", message: "Sign in to use the assistant." });
        return false;
    }

    // Mirrors checkPermission's own shortcuts: with auth off, or for an admin,
    // everything is permitted.
    if (permissions.isAdmin(user.id)) return true;

    const granted =
        permissions.checkPermission(user.id, "*", "useClaude") ||
        permissions.getUserPermissions(user.id).some((p) => p.canUseClaude);

    if (!granted) {
        res.status(403).json({
            error: "forbidden",
            message:
                "Your account does not have the 'Use Claude' permission. An administrator can grant it from the user's permissions.",
        });
        return false;
    }
    return true;
}

router.get("/status", authenticateToken, async (_req, res) => {
    res.json(assistant.status());
});

// ── Actions ─────────────────────────────────────────────────────────────────

router.post("/action", authenticateToken, async (req, res) => {
    if (!requireClaudePermission(req as AuthRequest, res)) return;

    const { action, input } = req.body ?? {};

    if (typeof action !== "string" || !action) {
        res.status(400).json({
            error: "action_required",
            message: "Say which action to run: spawn, input or kill.",
        });
        return;
    }

    try {
        switch (action) {
            case "spawn": {
                // Start or restart the conversation. Cheap and local: no
                // process, no network call, no greeting round trip.
                const socket = resolveSocket(req, res);
                if (!socket) return;
                assistant.start(socket.id, Number((req as AuthRequest).user!.id), (event, data) => socket.emit(event, data));
                res.json({ status: "started", configured: assistant.isConfigured() });
                return;
            }

            case "input": {
                const socket = resolveSocket(req, res);
                if (!socket) return;

                if (typeof input !== "string" || !input.trim()) {
                    res.status(400).json({
                        error: "input_required",
                        message: "There was no message to send.",
                    });
                    return;
                }

                if (!assistant.isConfigured()) {
                    // Answered on both channels. The HTTP body is for anything
                    // scripting this endpoint; the socket message is what the
                    // person staring at the chat panel will actually see.
                    socket.emit("claude-error", assistant.missingKeyMessage());
                    res.status(503).json({
                        error: "anthropic_key_missing",
                        message: assistant.missingKeyMessage(),
                    });
                    return;
                }

                // Deliberately not awaited. An answer with tool calls can run
                // for a minute or more, and holding the POST open for it means
                // the browser's fetch times out mid-answer while the stream is
                // still arriving perfectly well over the socket.
                void assistant
                    .send(socket.id, Number((req as AuthRequest).user!.id), input, (event, data) => socket.emit(event, data))
                    .catch((e: any) => {
                        // send() reports its own failures to the client and
                        // resolves. Reaching here means a bug in that reporting,
                        // so it is logged as one rather than swallowed.
                        Logger.getInstance().error(`[AI] Assistant turn escaped its own error handling: ${e?.message}`, e);
                    });

                res.status(202).json({ status: "streaming" });
                return;
            }

            case "kill": {
                const socket = resolveSocket(req, res);
                if (!socket) return;
                assistant.reset(socket.id);
                socket.emit("claude-exit", 0);
                res.json({ status: "stopped" });
                return;
            }

            default:
                res.status(400).json({
                    error: "unknown_action",
                    message: `"${action}" is not something the assistant can do. Valid actions are spawn, input and kill.`,
                });
                return;
        }
    } catch (e: any) {
        Logger.getInstance().error(`[AI] Action "${action}" failed: ${e?.message}`, e);
        res.status(500).json({
            error: "ai_action_failed",
            message: `The assistant could not handle that request: ${e?.message ?? "unknown error"}`,
        });
    }
});

export default router;
