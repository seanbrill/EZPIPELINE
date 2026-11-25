/**
 * Environment and resources by layer (services/EnvLayers.ts), for the
 * pipeline and group pages.
 *
 *   GET    /env?pipeline=ID | ?group=PATH | ?global=1
 *   PUT    /env            { layer, key, value, secret }
 *   DELETE /env            { layer, key }
 *   POST   /env/reveal     { layer, key }        → { value }   (audited)
 *   GET    /resources?pipeline=ID | ?group=PATH | ?global=1
 *   POST   /resources      multipart: layer, file
 *   DELETE /resources      { layer, path }
 *   GET    /resources/file?layer=…&path=…        (download)
 */
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import EZPipelineController from "../controllers/EZPipelineController.js";
import { PermissionsService } from "../services/PermissionsService.js";
import { canOnPipeline } from "../services/access.js";
import { authenticateToken } from "../middleware/auth.js";
import { DATA_DIR } from "../config/index.js";
import {
  deleteEnv, globalLayer, groupLayer, layersFor, listResources, pipelineLayer, readEnv, resourcePath, writeEnv, type Layer,
} from "../services/EnvLayers.js";

const router = Router();
const perms = PermissionsService.getInstance();
const upload = multer({ dest: path.join(DATA_DIR, "tmp_uploads"), limits: { fileSize: 50 * 1024 * 1024 } });

type Need = "read" | "write";
const user = (req: Request) => (req as any).user as { id: number; isAdmin?: boolean; username?: string };
const fail = (res: Response, e: any) => res.status(e?.status ?? 500).json({ error: e?.message ?? String(e) });

function pipelineOf(id: string) {
  return EZPipelineController.instance.targets.find((t) => t.id === id || t.appName === id);
}

/** Resolve a layer id the client sent, and check the user may read or change it. */
function layerFor(req: Request, id: unknown, need: Need, what: "env" | "resources"): Layer {
  const u = user(req);
  const s = String(id ?? "");
  const deny = () => Object.assign(new Error("You do not have permission for that."), { status: 403 });
  if (s === "global") {
    const ok = u.isAdmin || perms.checkPermission(u.id, "global-env", need === "read" ? "view" : "editEnv");
    if (!ok) throw deny();
    return globalLayer();
  }
  if (s.startsWith("group:")) {
    const l = groupLayer(s.slice(6));
    if (!perms.checkAccess(u.id, l.label, need)) throw deny();
    return l;
  }
  if (s.startsWith("pipeline:")) {
    const p = pipelineOf(s.slice(9));
    if (!p) throw Object.assign(new Error("No such pipeline."), { status: 404 });
    const perm = need === "read" ? "view" : what === "env" ? "editEnv" : "editYaml";
    if (!canOnPipeline(u.id, p.id, perm)) throw deny();
    return pipelineLayer(p);
  }
  throw Object.assign(new Error("Unknown layer."), { status: 400 });
}

const may = (req: Request, l: Layer, need: Need, what: "env" | "resources") => {
  try { layerFor(req, l.id, need, what); return true; } catch { return false; }
};

/** The layers a request asks about: a pipeline's whole stack, or one group, or global. */
function requested(req: Request, what: "env" | "resources"): { layers: Layer[]; group?: string } {
  const u = user(req);
  if (req.query.pipeline) {
    const p = pipelineOf(String(req.query.pipeline));
    if (!p) throw Object.assign(new Error("No such pipeline."), { status: 404 });
    if (!canOnPipeline(u.id, p.id, "view")) throw Object.assign(new Error("You cannot see that pipeline."), { status: 403 });
    // Reading a pipeline means reading what its runs are given, from every layer.
    return { layers: layersFor(p) };
  }
  if (req.query.group) {
    const l = layerFor(req, `group:${String(req.query.group)}`, "read", what);
    return { layers: [l], group: l.label };
  }
  if (req.query.global) return { layers: [layerFor(req, "global", "read", what)] };
  throw Object.assign(new Error("Say which pipeline or group."), { status: 400 });
}

router.get("/env", authenticateToken, (req, res) => {
  try {
    const { layers, group } = requested(req, "env");
    const out = layers.map((l) => ({
      id: l.id, label: l.label, kind: l.kind, editable: may(req, l, "write", "env"),
      vars: readEnv(l.envFile).map((v) => ({ key: v.key, secret: v.secret, value: v.secret ? null : v.value })),
    }));
    if (!group) { res.json({ layers: out }); return; }

    // For a group: who uses each of its variables, and who sets their own.
    const inside = EZPipelineController.instance.targets.filter((t) => {
      const g = (t.group ?? "").split(/[\\/]/).filter(Boolean).join("/");
      return g === group || g.startsWith(`${group}/`);
    }).filter((t) => canOnPipeline(user(req).id, t.id, "view"));
    const depth = group.split("/").length;
    const pipelines = inside.map((t) => {
      const below = layersFor(t).slice(1 + depth); // the subgroups under this one, then the pipeline
      const overrides = new Map<string, string>();
      for (const l of below) for (const v of readEnv(l.envFile)) overrides.set(v.key, l.kind === "pipeline" ? "pipeline" : l.label);
      return { id: t.id, appName: t.appName, overrides: Object.fromEntries(overrides) };
    });
    const subgroups = new Map<string, string[]>();
    for (const t of inside) {
      const parts = (t.group ?? "").split(/[\\/]/).filter(Boolean);
      for (let i = depth + 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join("/");
        if (!subgroups.has(sub)) subgroups.set(sub, readEnv(groupLayer(sub).envFile).map((v) => v.key));
      }
    }
    res.json({ layers: out, pipelines, subgroups: [...subgroups].map(([name, keys]) => ({ name, keys })) });
  } catch (e) { fail(res, e); }
});

router.put("/env", authenticateToken, (req, res) => {
  try {
    const { layer, key, value, secret } = req.body ?? {};
    if (typeof key !== "string" || typeof value !== "string") { res.status(400).json({ error: "key and value are required" }); return; }
    const l = layerFor(req, layer, "write", "env");
    writeEnv(l.envFile, key.trim(), value, !!secret);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.delete("/env", authenticateToken, (req, res) => {
  try {
    const { layer, key } = req.body ?? {};
    const l = layerFor(req, layer, "write", "env");
    if (!deleteEnv(l.envFile, String(key))) { res.status(404).json({ error: "No such variable." }); return; }
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// A secret's value, to someone who may change it. A POST, so the audit
// middleware records who revealed what (the key, never the value).
router.post("/env/reveal", authenticateToken, (req, res) => {
  try {
    const { layer, key } = req.body ?? {};
    const l = layerFor(req, layer, "write", "env");
    const v = readEnv(l.envFile).find((x) => x.key === String(key));
    if (!v) { res.status(404).json({ error: "No such variable." }); return; }
    res.json({ value: v.value });
  } catch (e) { fail(res, e); }
});

router.get("/resources", authenticateToken, (req, res) => {
  try {
    const { layers } = requested(req, "resources");
    res.json({ layers: layers.map((l) => ({ id: l.id, label: l.label, kind: l.kind, editable: may(req, l, "write", "resources"), files: listResources(l.resources) })) });
  } catch (e) { fail(res, e); }
});

router.post("/resources", authenticateToken, upload.single("file"), (req, res) => {
  const tmp = req.file?.path;
  try {
    if (!req.file) { res.status(400).json({ error: "No file." }); return; }
    const l = layerFor(req, req.body?.layer, "write", "resources");
    const name = path.basename(String(req.body?.name || req.file.originalname || ""));
    const folder = String(req.body?.folder ?? "").replace(/^\/+|\/+$/g, "");
    const dest = resourcePath(l.resources, folder ? `${folder}/${name}` : name);
    if (!name || !dest) { res.status(400).json({ error: "Bad file name." }); return; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(req.file.path, dest);
    if (/\.(pem|key)$|^id_[a-z0-9]+$/i.test(name)) fs.chmodSync(dest, 0o600);
    res.json({ ok: true, path: path.relative(l.resources, dest).split(path.sep).join("/") });
  } catch (e) { fail(res, e); }
  finally { if (tmp) fs.rm(tmp, { force: true }, () => {}); }
});

router.delete("/resources", authenticateToken, (req, res) => {
  try {
    const { layer, path: rel } = req.body ?? {};
    const l = layerFor(req, layer, "write", "resources");
    const full = resourcePath(l.resources, String(rel ?? ""));
    if (!full || !fs.existsSync(full)) { res.status(404).json({ error: "No such file." }); return; }
    fs.rmSync(full);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.get("/resources/file", authenticateToken, (req, res) => {
  try {
    const l = layerFor(req, req.query.layer, "write", "resources");
    const full = resourcePath(l.resources, String(req.query.path ?? ""));
    if (!full || !fs.existsSync(full)) { res.status(404).json({ error: "No such file." }); return; }
    res.download(full);
  } catch (e) { fail(res, e); }
});

export default router;
