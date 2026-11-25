/**
 * First-run setup, the instance's public face, templates and the checklist.
 *
 *   GET  /instance          anyone: the instance name and default theme, for the sign-in page
 *   GET  /setup/state       before an admin exists: anyone. After: the admin only
 *   PUT  /setup/state       admin: save a step
 *   GET  /templates         signed in: what New pipeline can start from
 *   GET  /onboarding        signed in: the Getting started checklist
 */
import { Router, Request } from "express";
import jwt from "jsonwebtoken";
import { authenticateToken } from "../middleware/auth.js";
import { DatabaseService } from "../services/Database.js";
import { PluginManager } from "../services/PluginManager.js";
import EZPipelineController from "../controllers/EZPipelineController.js";
import { checklist, hostFacts, publicInstance, readSetup, TEMPLATES, writeSetup } from "../services/setup.js";
import { DATA_DIR } from "../config/index.js";
import { MailService } from "../services/mail/index.js";
import { SettingsService } from "../services/SettingsService.js";
import { JWT_SECRET } from "../config/secret.js";

const router = Router();

const hasUsers = () => DatabaseService.getInstance().hasUsers();

/** The signed-in admin, or null. For the one route that also answers without a token. */
function adminFrom(req: Request): boolean {
  const token = String(req.headers.authorization ?? "").split(" ")[1];
  if (!token) return false;
  try {
    const d = jwt.verify(token, JWT_SECRET) as { id?: number; scope?: string };
    if (d.scope) return false;
    const u = DatabaseService.getInstance().getDb().prepare("SELECT is_admin FROM users WHERE id = ?").get(d.id) as { is_admin: number } | undefined;
    return u?.is_admin === 1;
  } catch { return false; }
}

router.get("/instance", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(publicInstance());
});

router.get("/setup/state", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const initialized = hasUsers();
  // Before anyone exists, the first visitor is the one setting it up and may
  // see the host. After, the details are the admin's.
  if (initialized && !adminFrom(req)) {
    res.json({ initialized, done: readSetup().done });
    return;
  }
  res.json({ initialized, ...readSetup(), host: await hostFacts(DATA_DIR) });
});

router.put("/setup/state", authenticateToken, (req, res) => {
  if (!(req as any).user?.isAdmin) { res.status(403).json({ error: "Only an admin can change setup." }); return; }
  try { res.json(writeSetup(req.body ?? {})); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

/** Settings › General (design sheet f145). */
router.get("/settings/general", authenticateToken, (req, res) => {
  if (!(req as any).user?.isAdmin) { res.status(403).json({ error: "Only an admin can see this." }); return; }
  const db = DatabaseService.getInstance().getDb();
  const users = db.prepare("SELECT COUNT(*) total, SUM(mfa_enabled) codes FROM users").get() as { total: number; codes: number | null };
  const mail = MailService.getInstance();
  res.json({
    instance: readSetup().instance,
    mfaEnforced: SettingsService.getInstance().get("mfa_enforced") === "true",
    people: { total: users.total, codes: users.codes ?? 0 },
    mail: { provider: mail.selectedProviderId(), configured: mail.isConfigured() },
  });
});

router.put("/settings/general", authenticateToken, (req, res) => {
  if (!(req as any).user?.isAdmin) { res.status(403).json({ error: "Only an admin can change this." }); return; }
  try {
    if (req.body?.instance) writeSetup({ instance: req.body.instance });
    if (typeof req.body?.mfaEnforced === "boolean") SettingsService.getInstance().set("mfa_enforced", String(req.body.mfaEnforced));
    res.json({ ok: true });
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

router.get("/templates", authenticateToken, (_req, res) => {
  res.json({ templates: TEMPLATES.map(({ yaml: _y, ...t }) => t) });
});

router.get("/onboarding", authenticateToken, (req, res) => {
  const user = (req as any).user;
  const pipelines = EZPipelineController.instance.targets.map((t) => ({ id: t.id, appName: t.appName }));
  const installed = PluginManager.getInstance().getPlugins().filter((p) => p.isInstalled && !p.builtin).map((p) => p.name);
  const items = checklist({ pipelines, installedPlugins: installed });
  // Someone who is not an admin only sees what they can act on.
  res.json({ items: user.isAdmin ? items : items.filter((i) => ["pipeline", "run", "watch"].includes(i.id)), setup: { done: readSetup().done } });
});

export default router;
