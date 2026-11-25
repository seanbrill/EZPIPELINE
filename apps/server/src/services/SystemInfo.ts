import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { DATA_DIR, DB_PATH, LOGS_DIR } from "../config/index.js";
import { DatabaseService } from "./Database.js";
import { runningVersion } from "./version.js";

const execFileAsync = promisify(execFile);
const STARTED_AT = new Date();

async function dirSize(dir: string, budget = { files: 200_000 }): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (budget.files-- <= 0) break; // a huge workspace must not stall the page
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p, budget);
    else if (e.isFile()) {
      try { total += (await fs.promises.stat(p)).size; } catch { /* vanished */ }
    }
  }
  return total;
}

function fileSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

let volumeCache: { at: number; value: { name: string; bytes: number }[] } | null = null;

/** What is using the data volume, biggest first. Cached for a minute: it walks the disk. */
async function volume(): Promise<{ name: string; bytes: number }[]> {
  if (volumeCache && Date.now() - volumeCache.at < 60_000) return volumeCache.value;
  let names: string[] = [];
  try { names = (await fs.promises.readdir(DATA_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* none */ }
  const value = (await Promise.all(names.map(async (name) => ({ name, bytes: await dirSize(path.join(DATA_DIR, name)) }))))
    .concat([{ name: "logs", bytes: await dirSize(LOGS_DIR) }])
    .sort((a, b) => b.bytes - a.bytes);
  volumeCache = { at: Date.now(), value };
  return value;
}

async function docker(): Promise<{ inContainer: boolean; cli: string | null }> {
  const inContainer = fs.existsSync("/.dockerenv");
  try {
    const { stdout } = await execFileAsync("docker", ["version", "--format", "{{.Client.Version}}"], { timeout: 3000 });
    return { inContainer, cli: stdout.trim() || null };
  } catch {
    return { inContainer, cli: null };
  }
}

export async function systemHealth() {
  const db = DatabaseService.getInstance().getDb();
  const jobs = db.prepare(`SELECT id, target, status, active_step AS activeStep, started_at AS startedAt FROM builds WHERE status IN ('running','paused') ORDER BY started_at`).all();
  let disk: { total: number; free: number } | null = null;
  try {
    const s = await fs.promises.statfs(DATA_DIR);
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { /* not supported here */ }
  return {
    version: runningVersion(),
    node: process.version,
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      load: os.loadavg(),
      memory: { total: os.totalmem(), free: os.freemem(), rss: process.memoryUsage().rss },
    },
    docker: await docker(),
    // Docker (restart policy) or the desktop shell brings the server back.
    canRestart: fs.existsSync("/.dockerenv") || process.env.EZP_SUPERVISED === "1",
    database: { bytes: fileSize(DB_PATH) + fileSize(DB_PATH + "-wal") },
    disk,
    volume: await volume(),
    jobs,
  };
}
