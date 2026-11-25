/**
 * Export and import (design sheet f40–f80). Admins only: a bundle carries
 * pipelines, which are commands this host runs, and variable names.
 *
 *   GET    /data                    the data folder's sizes and recent exports
 *   GET    /export/preview          ?type=&group=&pipeline= counts for the export modal
 *   POST   /export                  { scope, include, passphrase? } → the export's record
 *   GET    /exports/:file           download one
 *   DELETE /exports/:file
 *   POST   /import/inspect          a .ezp upload (field "bundle"), or { export: file }
 *   GET    /import/:id              what is in an upload
 *   POST   /import/:id/plan         { dest } → what is new and what meets something here
 *   POST   /import/:id/unlock       { passphrase } → whether it opens the secrets
 *   POST   /import/:id/apply        { dest, decisions, passphrase? } → the report
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import fs from "fs";
import { authenticateToken } from "../middleware/auth.js";
import { apply, buildExport, deleteExport, describe, exportPath, inspect, inspectExport, listExports, plan, preview, unlock, type Dest, type Scope } from "../services/bundle.js";
import { systemHealth } from "../services/SystemInfo.js";
import { DATA_DIR } from "../config/index.js";
import Logger from "../controllers/Logger.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024, files: 1 } });

function admin(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user?.isAdmin) { res.status(403).json({ error: "Only an admin can export or import." }); return; }
  next();
}
const fail = (res: Response, e: any) => {
  if (!e.status) Logger.getInstance().error(`[bundle] ${e.message}`);
  res.status(e.status ?? 500).json({ error: e.status ? e.message : "That did not work. The server log has the detail." });
};
const scopeFrom = (q: Record<string, unknown>): Scope => {
  const type = String(q.type ?? "");
  if (type === "instance") return { type };
  if (type === "group") return { type, path: String(q.group ?? q.path ?? "") };
  if (type === "pipeline") return { type, id: String(q.pipeline ?? q.id ?? "") };
  throw Object.assign(new Error("Scope is instance, group or pipeline."), { status: 400 });
};
const destFrom = (d: any): Dest => (d?.mode === "new" ? { mode: "new", name: String(d.name ?? "") } : { mode: "merge", group: String(d?.group ?? "") });

router.get("/data", authenticateToken, admin, async (_req, res) => {
  try {
    const h = await systemHealth();
    res.json({ dataDir: DATA_DIR, volume: h.volume, database: h.database, disk: h.disk, exports: listExports() });
  } catch (e) { fail(res, e); }
});

router.get("/export/preview", authenticateToken, admin, (req, res) => {
  try { res.json(preview(scopeFrom(req.query as any))); } catch (e) { fail(res, e); }
});

router.post("/export", authenticateToken, admin, (req, res) => {
  try {
    const user = (req as any).user;
    const pass = typeof req.body?.passphrase === "string" && req.body.passphrase ? req.body.passphrase : undefined;
    res.status(201).json(buildExport(scopeFrom(req.body?.scope ?? {}), { include: req.body?.include, passphrase: pass, by: user.username }));
  } catch (e) { fail(res, e); }
});

router.get("/exports/:file", authenticateToken, admin, (req, res) => {
  const p = exportPath(String(req.params.file));
  if (!p || !fs.existsSync(p)) { res.status(404).json({ error: "No such export. Exports are kept for 7 days." }); return; }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${String(req.params.file)}"`);
  fs.createReadStream(p).pipe(res);
});

router.delete("/exports/:file", authenticateToken, admin, (req, res) => {
  if (!deleteExport(String(req.params.file))) { res.status(404).json({ error: "No such export." }); return; }
  res.json({ ok: true });
});

router.post("/import/inspect", authenticateToken, admin, upload.single("bundle"), (req, res) => {
  try {
    const user = (req as any).user;
    if (req.file) { res.status(201).json(inspect(req.file.buffer, req.file.originalname, user.username)); return; }
    if (typeof req.body?.export === "string") { res.status(201).json(inspectExport(req.body.export, user.username)); return; }
    res.status(400).json({ error: "Send a .ezp file, or the name of a recent export." });
  } catch (e) { fail(res, e); }
});

router.get("/import/:id", authenticateToken, admin, (req, res) => {
  try { res.json(describe(String(req.params.id))); } catch (e) { fail(res, e); }
});

router.post("/import/:id/plan", authenticateToken, admin, (req, res) => {
  try { res.json(plan(String(req.params.id), destFrom(req.body?.dest))); } catch (e) { fail(res, e); }
});

router.post("/import/:id/unlock", authenticateToken, admin, (req, res) => {
  try { res.json({ ok: unlock(String(req.params.id), String(req.body?.passphrase ?? "")) }); } catch (e) { fail(res, e); }
});

router.post("/import/:id/apply", authenticateToken, admin, (req, res) => {
  try {
    const pass = typeof req.body?.passphrase === "string" && req.body.passphrase ? req.body.passphrase : undefined;
    const decisions = req.body?.decisions && typeof req.body.decisions === "object" ? req.body.decisions : {};
    res.json(apply(String(req.params.id), destFrom(req.body?.dest), decisions, pass, (req as any).user.id));
  } catch (e) { fail(res, e); }
});

export default router;
