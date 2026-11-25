/**
 * Things that are only yours (Settings › Personal).
 *
 *   GET    /me/tokens        your API tokens (never the token itself)
 *   POST   /me/tokens        { name, level, days|null } → the token, once
 *   DELETE /me/tokens/:id
 *   GET    /me/devices       browsers trusted to skip the email code
 *   DELETE /me/devices/:id
 *   GET    /admin/api-tokens     admin: everyone's, with whose (Admin › Agent & API tokens)
 *   DELETE /admin/api-tokens/:id admin: revoke anyone's, e.g. one that leaked
 */
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { createToken, listTokens, revokeToken, type TokenLevel } from "../services/apiTokens.js";
import { DatabaseService } from "../services/Database.js";

const router = Router();
const view = (r: ReturnType<typeof listTokens>[number]) => ({ id: r.id, name: r.name, last4: r.last4, level: r.level, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at });

router.get("/me/tokens", authenticateToken, (req, res) => {
  res.json({ tokens: listTokens((req as any).user.id).map(view) });
});

router.post("/me/tokens", authenticateToken, (req, res) => {
  const { name, level, days } = req.body ?? {};
  try {
    const { token, row } = createToken((req as any).user.id, String(name ?? ""), String(level ?? "") as TokenLevel, days == null ? null : Number(days));
    res.status(201).json({ token, record: view(row) });
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.status ? e.message : "Could not make the token." });
  }
});

router.delete("/me/tokens/:id", authenticateToken, (req, res) => {
  if (!revokeToken((req as any).user.id, Number(req.params.id))) { res.status(404).json({ error: "No such token." }); return; }
  res.json({ ok: true });
});

router.get("/me/devices", authenticateToken, (req, res) => {
  const rows = DatabaseService.getInstance().getDb()
    .prepare("SELECT id, device_name, created_at, last_used_at FROM user_devices WHERE user_id = ? ORDER BY last_used_at DESC").all((req as any).user.id);
  res.json({ devices: rows });
});

router.delete("/me/devices/:id", authenticateToken, (req, res) => {
  const n = DatabaseService.getInstance().getDb().prepare("DELETE FROM user_devices WHERE id = ? AND user_id = ?").run(Number(req.params.id), (req as any).user.id).changes;
  if (!n) { res.status(404).json({ error: "No such browser." }); return; }
  res.json({ ok: true });
});

const adminOnly = (req: any, res: any, next: any) => { if (!req.user?.isAdmin) { res.status(403).json({ error: "Only an admin can see this." }); return; } next(); };

router.get("/admin/api-tokens", authenticateToken, adminOnly, (_req, res) => {
  const rows = DatabaseService.getInstance().getDb().prepare(
    `SELECT t.id, t.name, t.last4, t.level, t.created_at, t.last_used_at, t.expires_at, u.username, u.display_name
     FROM api_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC`).all() as any[];
  res.json({ tokens: rows.map((r) => ({ id: r.id, name: r.name, last4: r.last4, level: r.level, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at, owner: r.display_name || r.username })) });
});

router.delete("/admin/api-tokens/:id", authenticateToken, adminOnly, (req, res) => {
  const n = DatabaseService.getInstance().getDb().prepare("DELETE FROM api_tokens WHERE id = ?").run(Number(req.params.id)).changes;
  if (!n) { res.status(404).json({ error: "No such token." }); return; }
  res.json({ ok: true });
});

export default router;
