/**
 * Deleting a pipeline, behind type-to-confirm (design sheet f48).
 *
 *   GET    /pipelines/:id/footprint  what deleting it takes with it
 *   DELETE /pipelines/:id            { confirm: "<its name>" }
 *
 * Refused while one of its runs is going: a run deleted mid-step leaves its
 * processes behind with nothing left to stop them.
 */
import { Router, Request } from "express";
import fs from "fs";
import path from "path";
import EZPipelineController from "../controllers/EZPipelineController.js";
import { BuildService } from "../services/BuildService.js";
import { DatabaseService } from "../services/Database.js";
import { canOnPipeline } from "../services/access.js";
import { authenticateToken } from "../middleware/auth.js";
import { PIPELINES_DIR } from "../config/index.js";

const router = Router();

function find(req: Request) {
  const id = String(req.params.id);
  const p = EZPipelineController.instance.targets.find((t) => t.id === id || t.appName === id);
  if (!p) throw Object.assign(new Error("No such pipeline."), { status: 404 });
  if (!canOnPipeline((req as any).user.id, p.id, "editYaml")) throw Object.assign(new Error("You cannot delete this pipeline."), { status: 403 });
  const yamlDir = path.dirname(path.resolve(PIPELINES_DIR, p.filePath ?? ""));
  const bundle = fs.existsSync(path.join(yamlDir, ".pipeline"));
  const names = [p.id, p.appName].filter(Boolean) as string[];
  return { p, yamlDir, bundle, names };
}

function footprint(names: string[]) {
  const db = DatabaseService.getInstance().getDb();
  const marks = names.map(() => "?").join(",");
  const count = (sql: string) => (db.prepare(sql).get(...names) as { n: number }).n;
  return {
    runs: count(`SELECT count(*) AS n FROM builds WHERE target IN (${marks})`),
    live: count(`SELECT count(*) AS n FROM builds WHERE target IN (${marks}) AND status IN ('running','paused','pending')`),
    schedules: count(`SELECT count(*) AS n FROM schedules WHERE pipeline_target IN (${marks})`),
    watches: count(`SELECT count(*) AS n FROM git_watches WHERE pipeline_target IN (${marks})`),
  };
}

router.get("/pipelines/:id/footprint", authenticateToken, (req, res) => {
  try {
    const { p, names, bundle } = find(req);
    res.json({ id: p.id, appName: p.appName, folder: bundle, ...footprint(names) });
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

router.delete("/pipelines/:id", authenticateToken, (req, res) => {
  try {
    const { p, yamlDir, bundle, names } = find(req);
    if (String(req.body?.confirm ?? "") !== p.appName) { res.status(400).json({ error: `Type "${p.appName}" to confirm.` }); return; }
    const fp = footprint(names);
    if (fp.live > 0) { res.status(409).json({ error: "A run of this pipeline is going. Cancel it first." }); return; }

    const db = DatabaseService.getInstance().getDb();
    const marks = names.map(() => "?").join(",");
    for (const n of names) BuildService.getInstance().clearBuildHistory(n);
    db.prepare(`DELETE FROM schedules WHERE pipeline_target IN (${marks})`).run(...names);
    db.prepare(`DELETE FROM git_watches WHERE pipeline_target IN (${marks})`).run(...names);

    // A bundle is its own folder; an old single-file pipeline is just its file.
    const root = path.resolve(PIPELINES_DIR);
    if (bundle && yamlDir.startsWith(root + path.sep)) fs.rmSync(yamlDir, { recursive: true, force: true });
    else if (p.filePath) fs.rmSync(path.resolve(PIPELINES_DIR, p.filePath), { force: true });

    EZPipelineController.instance.refreshTargets();
    res.json({ ok: true, removed: fp });
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

export default router;
