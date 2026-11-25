/**
 * For the desktop app's tray (apps/desktop). Only when this server was started by
 * the app, which passes EZP_DESKTOP_TOKEN: a random value only the app knows,
 * sent back in x-ezp-desktop-token. With no window open there is no signed-in
 * page to ask, and the tray still has to say whether a run is going.
 *
 *   GET /desktop/state   what is running, waiting on a person, and failed lately
 *
 * It says no more than the tray shows: names, numbers, the step, how far along.
 */
import { Router, type Request } from "express";
import crypto from "crypto";
import { DatabaseService } from "../services/Database.js";
import EZPipelineController from "../controllers/EZPipelineController.js";
import { readSetup } from "../services/setup.js";

const router = Router();
const TOKEN = process.env.EZP_DESKTOP_TOKEN ?? "";

/** The app's token, compared in constant time. Never true when the server was not started by the app. */
export function isDesktop(req: Request): boolean {
  const got = req.get("x-ezp-desktop-token") ?? "";
  if (TOKEN.length < 32 || got.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN));
}

interface Row { id: string; target: string; status: string; active_step: string | null; percentage: number | null; build_number: number; started_at: string | null; ended_at: string | null }

router.get("/desktop/state", (req, res) => {
  if (!isDesktop(req)) { res.status(404).json({ error: "Not found" }); return; }
  const db = DatabaseService.getInstance().getDb();
  const names = new Map(EZPipelineController.instance.targets.map((t) => [t.id, t.appName || t.id]));
  const view = (r: Row) => ({ id: r.id, pipelineId: r.target, pipeline: names.get(r.target) ?? r.target, number: r.build_number, step: r.active_step, percent: r.percentage ?? 0, startedAt: r.started_at, endedAt: r.ended_at });
  const going = db.prepare("SELECT id, target, status, active_step, percentage, build_number, started_at, ended_at FROM builds WHERE status IN ('running','paused') ORDER BY started_at").all() as Row[];
  const failed = db.prepare("SELECT id, target, status, active_step, percentage, build_number, started_at, ended_at FROM builds WHERE status = 'failed' AND ended_at >= datetime('now', '-1 day') ORDER BY ended_at DESC LIMIT 5").all() as Row[];
  let instance = "EZPipeline";
  try { instance = readSetup().instance.name || instance; } catch { /* not set up yet */ }
  res.json({
    instance,
    running: going.filter((r) => r.status === "running").map(view),
    waiting: going.filter((r) => r.status === "paused").map(view),
    failed: failed.map(view),
  });
});

export default router;
