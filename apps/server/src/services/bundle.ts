/**
 * .ezp bundles: export and import (design sheet f40–f80, format in f62).
 *
 *   manifest.json                       format, scope, counts, sha256 of every file
 *   groups/~/<sub>/group.json           a group's variables and credentials
 *   groups/~/<sub>/resources/…          its files
 *   pipelines/~/<group>/<folder>/pipeline.yaml   byte for byte
 *   pipelines/~/<group>/<folder>/settings.json   id, name, schedules, watches, variables
 *   pipelines/~/<group>/<folder>/resources/…
 *   global/settings.json, global/resources/…     an instance export only
 *   history.jsonl                       optional: one run per line, with its commit
 *
 * "~" is the scope's root, so a group can be imported under another name.
 *
 * Secrets travel only sealed: scrypt on a passphrase, then AES-256-GCM. The
 * passphrase is never in the bundle. Without one, variables arrive as names
 * with empty values and credentials are left behind. Schedules and watches
 * always arrive paused, so a bundle cannot start a deploy by itself.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { v4 as uuidv4 } from "uuid";
import { DATA_DIR, PIPELINES_DIR } from "../config/index.js";
import EZPipelineController from "../controllers/EZPipelineController.js";
import { DatabaseService } from "./Database.js";
import { globalLayer, groupLayer, listResources, pipelineLayer, readEnv, resourcePath, writeEnv } from "./EnvLayers.js";
import { decryptCredential, encryptCredential, getCredential, listCredentials } from "./gitCredentials.js";
import { readSetup, safeName } from "./setup.js";
import { readZip, writeZip, type ZipEntry } from "./zip.js";

export const FORMAT = "ezp/1";
export const APP_VERSION = "2.0.0";
export const EXPORTS_DIR = () => path.join(DATA_DIR, "exports");
export const IMPORTS_DIR = () => path.join(DATA_DIR, "imports");
const KEEP_MS = 7 * 864e5;
const err = (status: number, message: string) => Object.assign(new Error(message), { status });

// ── Sealing ───────────────────────────────────────────────────────────────

interface Seal { kdf: "scrypt"; salt: string; N: number; r: number; p: number; check: string }
const CHECK = "ezp/1 sealed";

function keyFrom(pass: string, s: Pick<Seal, "salt" | "N" | "r" | "p">): Buffer {
  return crypto.scryptSync(pass, Buffer.from(s.salt, "base64"), 32, { N: s.N, r: s.r, p: s.p, maxmem: 128 * s.N * s.r * 2 });
}
function seal(key: Buffer, plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "enc:v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function unseal(key: Buffer, sealed: string): string {
  if (!sealed.startsWith("enc:v1:")) throw err(400, "A sealed value is not in a format this server reads.");
  const b = Buffer.from(sealed.slice(7), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
export function newSeal(pass: string): { seal: Seal; key: Buffer } {
  if (pass.length < 12) throw err(400, "A passphrase is at least 12 characters.");
  const s = { salt: crypto.randomBytes(16).toString("base64"), N: 2 ** 15, r: 8, p: 1 };
  const key = keyFrom(pass, s);
  return { seal: { kdf: "scrypt", ...s, check: seal(key, CHECK) }, key };
}
export function openSeal(s: Seal, pass: string): Buffer | null {
  if (s.N > 2 ** 20 || s.r > 16 || s.p > 4) return null; // a bundle must not make us burn memory
  const key = keyFrom(pass, s);
  try { return unseal(key, s.check) === CHECK ? key : null; } catch { return null; }
}

// ── What is in scope ──────────────────────────────────────────────────────

export type Scope = { type: "instance" } | { type: "group"; path: string } | { type: "pipeline"; id: string };
interface Target { id: string; appName?: string; group?: string; filePath?: string }

/**
 * The pipelines as they are on disk now. The controller's list is read at boot and by the
 * routes that write pipeline files; a folder removed or added any other way (by hand, by
 * git) left it stale, and an export then failed on a pipeline.yaml that was gone.
 */
const targets = (): Target[] => {
  EZPipelineController.instance.refreshTargets();
  return EZPipelineController.instance.targets as Target[];
};
const under = (g: string, root: string) => !root || g === root || g.startsWith(root + "/");
const rel = (g: string, root: string) => (root ? (g === root ? "" : g.slice(root.length + 1)) : g);
const tilde = (r: string) => (r ? `~/${r}` : "~");

/** The self-host wizard's own deploy pipelines: they drive this instance's cloud deploy and mean nothing anywhere else. */
const selfhostPipeline = (t: Target) => fs.existsSync(path.join(path.dirname(path.resolve(PIPELINES_DIR, t.filePath ?? "")), ".selfhost"));

function scopeOf(scope: Scope): { root: string; label: string; pipelines: Target[]; groups: string[] } {
  const all = scope.type === "pipeline" ? targets() : targets().filter((t) => !selfhostPipeline(t));
  if (scope.type === "pipeline") {
    const t = all.find((x) => x.id === scope.id);
    if (!t) throw err(404, "No such pipeline.");
    return { root: t.group ?? "", label: t.appName ?? t.id, pipelines: [t], groups: [] };
  }
  const root = scope.type === "group" ? scope.path.split("/").filter(Boolean).join("/") : "";
  if (scope.type === "group" && !root) throw err(400, "Which group?");
  const pipelines = all.filter((t) => under(t.group ?? "", root));
  const groups = new Set<string>();
  if (root) groups.add(root);
  for (const t of pipelines) {
    const parts = (t.group ?? "").split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) { const g = parts.slice(0, i).join("/"); if (under(g, root)) groups.add(g); }
  }
  if (scope.type === "group" && !pipelines.length && !fs.existsSync(path.join(PIPELINES_DIR, ...root.split("/")))) throw err(404, "No such group.");
  return { root, label: scope.type === "group" ? root : "Entire instance", pipelines, groups: [...groups].sort() };
}

const folderOf = (t: Target) => {
  const yaml = path.resolve(PIPELINES_DIR, t.filePath ?? "");
  const dir = path.dirname(yaml);
  return fs.existsSync(path.join(dir, ".pipeline")) ? path.basename(dir) : path.basename(yaml).replace(/\.ya?ml$/, "");
};

const db = () => DatabaseService.getInstance().getDb();
const schedulesOf = (id: string) => db().prepare("SELECT cron_expression AS cron FROM schedules WHERE pipeline_target = ?").all(id) as { cron: string }[];
const watchesOf = (id: string) => db().prepare("SELECT repo_url AS repoUrl, branch, poll_seconds AS pollSeconds, auto_approve AS autoApprove FROM git_watches WHERE pipeline_target = ?").all(id) as { repoUrl: string; branch: string; pollSeconds: number; autoApprove: number }[];
const runsOf = (id: string, limit: number | null) => db().prepare(
  `SELECT status, version, started_at, ended_at, build_number, step_timings, triggered_by, commit_sha, commits, error
   FROM builds WHERE target = ? AND status NOT IN ('running','paused','pending','queued') ORDER BY started_at DESC ${limit ? `LIMIT ${Number(limit)}` : ""}`).all(id) as Record<string, unknown>[];

export interface Include { schedules: boolean; watches: boolean; resources: boolean; credentials: boolean; history: "none" | "last50" | "all" }
const DEFAULT_INCLUDE: Include = { schedules: true, watches: true, resources: true, credentials: true, history: "last50" };

/** What the export modal shows before anything is built. */
export function preview(scope: Scope) {
  const s = scopeOf(scope);
  let variables = 0, resources = 0, resourceBytes = 0, credentials = 0, schedules = 0, watches = 0, runs = 0;
  const layers = [
    ...(scope.type === "instance" ? [globalLayer()] : []),
    ...s.groups.map((g) => groupLayer(g)),
    ...s.pipelines.map((p) => pipelineLayer(p)),
  ];
  for (const l of layers) {
    variables += readEnv(l.envFile).length;
    for (const r of listResources(l.resources)) { resources++; resourceBytes += r.size; }
  }
  for (const g of s.groups) credentials += listCredentials(g).filter((c) => c.group === g).length;
  for (const p of s.pipelines) {
    schedules += schedulesOf(p.id).length;
    watches += watchesOf(p.id).length;
    runs += (db().prepare("SELECT COUNT(*) n FROM builds WHERE target = ?").get(p.id) as { n: number }).n;
  }
  return { label: s.label, root: s.root, counts: { pipelines: s.pipelines.length, groups: s.groups.length, variables, resources, resourceBytes, credentials, schedules, watches, runs } };
}

// ── Export ────────────────────────────────────────────────────────────────

export interface ExportRecord { file: string; scope: string; scopeType: Scope["type"]; bytes: number; sealed: boolean; by: string; at: string; sha256: string; files: number }

const indexFile = () => path.join(EXPORTS_DIR(), "index.json");
function readIndex(): ExportRecord[] {
  try { return JSON.parse(fs.readFileSync(indexFile(), "utf8")) as ExportRecord[]; } catch { return []; }
}
function writeIndex(list: ExportRecord[]) {
  fs.mkdirSync(EXPORTS_DIR(), { recursive: true });
  fs.writeFileSync(indexFile(), JSON.stringify(list, null, 2), { mode: 0o600 });
}
/** Recent exports, oldest pruned after seven days. */
export function listExports(): ExportRecord[] {
  const now = Date.now();
  const keep: ExportRecord[] = [];
  for (const r of readIndex()) {
    const f = path.join(EXPORTS_DIR(), r.file);
    if (now - Date.parse(r.at) > KEEP_MS || !fs.existsSync(f)) { fs.rmSync(f, { force: true }); continue; }
    keep.push(r);
  }
  writeIndex(keep);
  return keep;
}
export function exportPath(file: string): string | null {
  if (!/^[\w.() -]+\.ezp$/.test(file)) return null;
  return readIndex().some((r) => r.file === file) ? path.join(EXPORTS_DIR(), file) : null;
}
export function deleteExport(file: string): boolean {
  const p = exportPath(file);
  if (!p) return false;
  fs.rmSync(p, { force: true });
  writeIndex(readIndex().filter((r) => r.file !== file));
  return true;
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const slug = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "bundle";

export function buildExport(scope: Scope, opts: { include?: Partial<Include>; passphrase?: string; by: string }): ExportRecord {
  const inc = { ...DEFAULT_INCLUDE, ...(opts.include ?? {}) };
  const s = scopeOf(scope);
  const sealed = opts.passphrase ? newSeal(opts.passphrase) : null;
  const value = (v: string) => (sealed ? seal(sealed.key, v) : null);
  const entries: ZipEntry[] = [];
  const add = (name: string, data: Buffer | string) => entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8") });
  const addResources = (prefix: string, dir: string) => {
    if (!inc.resources) return 0;
    let n = 0;
    for (const r of listResources(dir)) { const full = resourcePath(dir, r.path); if (full) { add(`${prefix}/resources/${r.path}`, fs.readFileSync(full)); n++; } }
    return n;
  };
  const envOut = (file: string) => readEnv(file).map((v) => ({ key: v.key, secret: v.secret, value: value(v.value) }));
  const counts = { pipelines: 0, groups: 0, variables: 0, resources: 0, credentials: 0, schedules: 0, watches: 0, runs: 0 };

  if (scope.type === "instance") {
    const g = globalLayer();
    const env = envOut(g.envFile);
    counts.variables += env.length;
    add("global/settings.json", JSON.stringify({ env }, null, 2));
    counts.resources += addResources("global", g.resources);
  }

  for (const g of s.groups) {
    const l = groupLayer(g);
    const env = envOut(l.envFile);
    const creds = inc.credentials ? listCredentials(g).filter((c) => c.group === g).map((c) => {
      const row = getCredential(c.id);
      const plain = row ? decryptCredential(row.secret) : null;
      return { name: c.name, kind: c.kind, username: c.username, publicKey: c.publicKey, useForReads: c.useForReads, secret: plain && sealed ? seal(sealed.key, plain) : null };
    }) : [];
    const at = `groups/${tilde(rel(g, s.root))}`;
    add(`${at}/group.json`, JSON.stringify({ env, credentials: creds }, null, 2));
    counts.groups++; counts.variables += env.length; counts.credentials += creds.length;
    counts.resources += addResources(at, l.resources);
  }

  const history: string[] = [];
  for (const t of s.pipelines) {
    const l = pipelineLayer(t);
    const g = rel(t.group ?? "", s.root);
    const key = `${g ? g + "/" : ""}${folderOf(t)}`;
    const at = `pipelines/~/${key}`;
    const yaml = fs.readFileSync(path.resolve(PIPELINES_DIR, t.filePath ?? ""));
    const env = envOut(l.envFile);
    const schedules = inc.schedules ? schedulesOf(t.id) : [];
    const watches = inc.watches ? watchesOf(t.id).map((w) => ({ ...w, autoApprove: !!w.autoApprove })) : [];
    add(`${at}/pipeline.yaml`, yaml);
    add(`${at}/settings.json`, JSON.stringify({ id: t.id, appName: t.appName ?? t.id, group: g, folder: folderOf(t), env, schedules, watches }, null, 2));
    counts.pipelines++; counts.variables += env.length; counts.schedules += schedules.length; counts.watches += watches.length;
    counts.resources += addResources(at, l.resources);
    if (inc.history !== "none") for (const r of runsOf(t.id, inc.history === "last50" ? 50 : null)) { history.push(JSON.stringify({ pipeline: key, ...r })); counts.runs++; }
  }
  if (history.length) add("history.jsonl", history.join("\n") + "\n");

  const instance = readSetup().instance.name;
  const manifest = {
    format: FORMAT, app: APP_VERSION, createdAt: new Date().toISOString(),
    from: { instance, by: opts.by },
    scope: { type: scope.type, root: s.root, label: s.label },
    counts, secrets: sealed ? { sealed: true, ...sealed.seal } : { sealed: false },
    files: Object.fromEntries(entries.map((e) => [e.name, `sha256:${sha(e.data)}`])),
  };
  const zip = writeZip([{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...entries]);

  const date = manifest.createdAt.slice(0, 10);
  const base = `ezpipeline-${slug(scope.type === "instance" ? "instance" : s.label)}-${date}`;
  fs.mkdirSync(EXPORTS_DIR(), { recursive: true, mode: 0o700 });
  let file = `${base}.ezp`;
  for (let i = 2; fs.existsSync(path.join(EXPORTS_DIR(), file)); i++) file = `${base}-${i}.ezp`;
  fs.writeFileSync(path.join(EXPORTS_DIR(), file), zip, { mode: 0o600 });
  const rec: ExportRecord = { file, scope: s.label, scopeType: scope.type, bytes: zip.length, sealed: !!sealed, by: opts.by, at: manifest.createdAt, sha256: sha(zip), files: entries.length + 1 };
  writeIndex([rec, ...listExports()]);
  return rec;
}

// ── Import: read and check ────────────────────────────────────────────────

interface Manifest {
  format: string; app: string; createdAt: string; from: { instance: string; by: string };
  scope: { type: Scope["type"]; root: string; label: string };
  counts: Record<string, number>; secrets: { sealed: boolean } & Partial<Seal>; files: Record<string, string>;
}
interface EnvOut { key: string; secret: boolean; value: string | null }
interface PipeIn { key: string; group: string; folder: string; id: string; appName: string; yaml: Buffer; env: EnvOut[]; schedules: { cron: string }[]; watches: { repoUrl: string; branch: string; pollSeconds: number; autoApprove: boolean }[]; resources: Map<string, Buffer> }
interface GroupIn { rel: string; env: EnvOut[]; credentials: { name: string; kind: "ssh_key" | "token"; username: string | null; publicKey: string | null; useForReads: boolean; secret: string | null }[]; resources: Map<string, Buffer> }
interface Parsed { manifest: Manifest; groups: GroupIn[]; pipelines: PipeIn[]; global: { env: EnvOut[]; resources: Map<string, Buffer> } | null; history: Record<string, unknown>[] }

function parse(buf: Buffer): Parsed {
  const files = readZip(buf);
  const mf = files.get("manifest.json");
  if (!mf) throw err(400, "This bundle has no manifest.json.");
  let manifest: Manifest;
  try { manifest = JSON.parse(mf.toString("utf8")); } catch { throw err(400, "Its manifest.json is not JSON."); }
  if (typeof manifest.format !== "string" || !manifest.format.startsWith("ezp/")) throw err(400, "This is not an EZPipeline bundle.");
  if (manifest.format !== FORMAT) throw err(400, `This bundle is format ${manifest.format}; this server reads ${FORMAT}. Update EZPipeline to import it.`);
  // Every file is listed and matches, or nothing is used.
  for (const [name, data] of files) {
    if (name === "manifest.json") continue;
    const want = manifest.files?.[name];
    if (!want) throw err(400, `${name} is in the bundle but not in its manifest.`);
    if (want !== `sha256:${sha(data)}`) throw err(400, `${name} does not match its checksum. The file was changed or damaged.`);
  }
  for (const name of Object.keys(manifest.files ?? {})) if (!files.has(name)) throw err(400, `${name} is listed but missing.`);

  const json = <T>(n: string): T => { try { return JSON.parse(files.get(n)!.toString("utf8")) as T; } catch { throw err(400, `${n} is not JSON.`); } };
  const resUnder = (prefix: string) => {
    const m = new Map<string, Buffer>();
    for (const [n, d] of files) if (n.startsWith(prefix + "/resources/")) m.set(n.slice(prefix.length + "/resources/".length), d);
    return m;
  };
  const groups: GroupIn[] = [];
  const pipelines: PipeIn[] = [];
  for (const n of files.keys()) {
    let m = /^groups\/~(?:\/(.+))?\/group\.json$/.exec(n);
    if (m) {
      const g = json<{ env?: EnvOut[]; credentials?: GroupIn["credentials"] }>(n);
      groups.push({ rel: m[1] ?? "", env: Array.isArray(g.env) ? g.env : [], credentials: Array.isArray(g.credentials) ? g.credentials : [], resources: resUnder(n.slice(0, -"/group.json".length)) });
      continue;
    }
    m = /^pipelines\/~\/(.+)\/settings\.json$/.exec(n);
    if (m) {
      const dir = n.slice(0, -"/settings.json".length);
      const sj = json<{ id?: string; appName?: string; group?: string; folder?: string; env?: EnvOut[]; schedules?: PipeIn["schedules"]; watches?: PipeIn["watches"] }>(n);
      const yaml = files.get(`${dir}/pipeline.yaml`);
      if (!yaml) throw err(400, `${dir} has no pipeline.yaml.`);
      const key = m[1];
      const folder = key.split("/").pop()!;
      pipelines.push({
        key, folder, group: key.split("/").slice(0, -1).join("/"), id: String(sj.id ?? ""), appName: String(sj.appName ?? folder), yaml,
        env: Array.isArray(sj.env) ? sj.env : [], schedules: Array.isArray(sj.schedules) ? sj.schedules : [], watches: Array.isArray(sj.watches) ? sj.watches : [],
        resources: resUnder(dir),
      });
    }
  }
  const global = files.has("global/settings.json") ? { env: json<{ env?: EnvOut[] }>("global/settings.json").env ?? [], resources: resUnder("global") } : null;
  const history = files.has("history.jsonl")
    ? files.get("history.jsonl")!.toString("utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  return { manifest, groups, pipelines, global, history };
}

// Uploaded bundles wait here, for the length of the import flow and a week after.
interface Pending { id: string; name: string; bytes: number; at: string; by: string }
const pendingFile = (id: string) => path.join(IMPORTS_DIR(), `${id}.ezp`);
function prunePending() {
  if (!fs.existsSync(IMPORTS_DIR())) return;
  for (const f of fs.readdirSync(IMPORTS_DIR())) {
    const p = path.join(IMPORTS_DIR(), f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true }); } catch { /* gone */ }
  }
}
function loadPending(id: string): { meta: Pending; parsed: Parsed } {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw err(400, "Bad import id.");
  const f = pendingFile(id);
  if (!fs.existsSync(f)) throw err(404, "That upload is gone. Choose the file again.");
  const meta = JSON.parse(fs.readFileSync(f.replace(/\.ezp$/, ".json"), "utf8")) as Pending;
  return { meta, parsed: parse(fs.readFileSync(f)) };
}

/** Keep an uploaded bundle (or a recent export) and say what is in it. */
export function inspect(buf: Buffer, name: string, by: string) {
  prunePending();
  const parsed = parse(buf);
  const id = uuidv4();
  fs.mkdirSync(IMPORTS_DIR(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(pendingFile(id), buf, { mode: 0o600 });
  const meta: Pending = { id, name: path.basename(name).slice(0, 200), bytes: buf.length, at: new Date().toISOString(), by };
  fs.writeFileSync(pendingFile(id).replace(/\.ezp$/, ".json"), JSON.stringify(meta), { mode: 0o600 });
  return summary(meta, parsed);
}
export function inspectExport(file: string, by: string) {
  const p = exportPath(file);
  if (!p) throw err(404, "No such export.");
  return inspect(fs.readFileSync(p), file, by);
}
export function describe(id: string) { const { meta, parsed } = loadPending(id); return summary(meta, parsed); }

function summary(meta: Pending, p: Parsed) {
  const m = p.manifest;
  return {
    id: meta.id, name: meta.name, bytes: meta.bytes, files: Object.keys(m.files).length + 1,
    format: m.format, app: m.app, createdAt: m.createdAt, from: m.from, scope: m.scope, counts: m.counts,
    sealed: !!m.secrets?.sealed,
    sealedCount: [...p.groups.flatMap((g) => [...g.env, ...g.credentials.map((c) => ({ value: c.secret }))]), ...p.pipelines.flatMap((x) => x.env), ...(p.global?.env ?? [])].filter((v) => v.value).length,
    groups: [...new Set(p.groups.map((g) => g.rel))],
  };
}

// ── Import: where it goes, and what meets what ────────────────────────────

export type Dest = { mode: "new"; name: string } | { mode: "merge"; group: string };
export type Decision = "skip" | "replace" | "both";
export interface Item { key: string; kind: "pipeline" | "variables" | "resource" | "credential"; label: string; detail?: string; bundle?: string; here?: string; identical?: boolean; choices: Decision[] }

const safeGroupPath = (g: string) => g.split("/").filter(Boolean).map((s) => safeName(s, "group name")).join("/");
function destRoot(dest: Dest): string {
  if (dest.mode === "new") {
    const name = safeGroupPath(String(dest.name ?? "").trim());
    if (!name) throw err(400, "Name the new group.");
    if (fs.existsSync(path.join(PIPELINES_DIR, ...name.split("/")))) throw err(409, `There is already a group called ${name}. Merge into it, or pick another name.`);
    return name;
  }
  return dest.group ? safeGroupPath(dest.group) : "";
}
const join = (...p: string[]) => p.filter(Boolean).join("/");
const stepsIn = (yaml: string) => { try { const d = YAML.parse(yaml); return Array.isArray(d?.steps) ? d.steps.length : 0; } catch { return 0; } };

function findHere(group: string, folder: string): Target | undefined {
  return targets().find((t) => (t.group ?? "") === group && folderOf(t) === folder);
}

export function plan(id: string, dest: Dest) {
  const { parsed } = loadPending(id);
  const root = destRoot(dest);
  const items: Item[] = [];
  let added = 0;
  const envItem = (key: string, label: string, file: string, vars: EnvOut[]) => {
    const here = new Set(readEnv(file).map((v) => v.key));
    const clash = vars.filter((v) => here.has(v.key)).map((v) => v.key);
    added += vars.length - clash.length;
    // Without sealed values there is nothing to replace with: what is here stays.
    if (clash.length && parsed.manifest.secrets.sealed) items.push({ key, kind: "variables", label: `${clash.length} variable${clash.length === 1 ? "" : "s"} in ${label}`, detail: clash.join(", "), bundle: parsed.manifest.secrets.sealed ? "Sealed values" : "No values", here: "Set here", choices: ["skip", "replace"] });
  };
  const resItems = (prefix: string, label: string, dir: string, res: Map<string, Buffer>) => {
    for (const [r, data] of res) {
      const full = resourcePath(dir, r);
      if (!full) throw err(400, `A resource path is not safe: ${r}`);
      if (!fs.existsSync(full)) { added++; continue; }
      const cur = fs.readFileSync(full);
      if (cur.equals(data)) continue;
      items.push({ key: `res:${prefix}:${r}`, kind: "resource", label: r, detail: label, bundle: `${data.length} B`, here: `${cur.length} B, different`, choices: ["skip", "replace", "both"] });
    }
  };

  if (parsed.global) {
    envItem("env:global", "Global", globalLayer().envFile, parsed.global.env);
    resItems("global", "Global", globalLayer().resources, parsed.global.resources);
  }
  for (const g of parsed.groups) {
    const gp = join(root, g.rel);
    if (!gp) continue;
    const l = groupLayer(gp);
    envItem(`env:group:${g.rel}`, gp, l.envFile, g.env);
    resItems(`group:${g.rel}`, gp, l.resources, g.resources);
    const names = new Set(listCredentials(gp).filter((c) => c.group === gp).map((c) => c.name));
    for (const c of g.credentials) {
      if (names.has(c.name)) items.push({ key: `cred:${g.rel}:${c.name}`, kind: "credential", label: c.name, detail: gp, bundle: c.secret ? "Sealed key" : "Public half only", here: "Set here", choices: ["skip", "replace", "both"] });
      else added++;
    }
  }
  for (const p of parsed.pipelines) {
    const gp = join(root, p.group);
    const here = findHere(gp, p.folder);
    if (!here) { added++; continue; }
    const mine = fs.readFileSync(path.resolve(PIPELINES_DIR, here.filePath ?? ""), "utf8");
    const theirs = p.yaml.toString("utf8");
    const identical = mine === theirs;
    items.push({ key: `pipe:${p.key}`, kind: "pipeline", label: p.appName, detail: gp || "Ungrouped", bundle: `${stepsIn(theirs)} steps`, here: `${stepsIn(mine)} steps`, identical, choices: ["skip", "replace", "both"] });
    const l = pipelineLayer(here);
    envItem(`env:pipe:${p.key}`, p.appName, l.envFile, p.env);
    resItems(`pipe:${p.key}`, p.appName, l.resources, p.resources);
  }
  return { root, added, items };
}

export function unlock(id: string, passphrase: string): boolean {
  const { parsed } = loadPending(id);
  const s = parsed.manifest.secrets;
  if (!s.sealed) return true;
  return !!openSeal(s as Seal, passphrase);
}

// ── Import: write it ──────────────────────────────────────────────────────

export interface Report { added: number; replaced: number; both: number; skipped: number; secrets: "unlocked" | "none" | "left-sealed"; sealedSkipped: number; pausedSchedules: number; pausedWatches: number; runs: number; credentialsWithoutKey: string[]; renamed: { from: string; to: string }[]; group: string; pipelines: { id: string; appName: string }[] }

export function apply(id: string, dest: Dest, decisions: Record<string, Decision>, passphrase: string | undefined, userId: number): Report {
  const { parsed } = loadPending(id);
  const root = destRoot(dest);
  const s = parsed.manifest.secrets;
  const key = s.sealed && passphrase ? openSeal(s as Seal, passphrase) : null;
  if (s.sealed && passphrase && !key) throw err(400, "That passphrase does not open the secrets. Nothing was written.");
  const plainOf = (v: string | null): string | null => (v && key ? unseal(key, v) : null);
  const want = (k: string): Decision => decisions[k] ?? "skip";
  const rep: Report = { added: 0, replaced: 0, both: 0, skipped: 0, secrets: !s.sealed ? "none" : key ? "unlocked" : "left-sealed", sealedSkipped: 0, pausedSchedules: 0, pausedWatches: 0, runs: 0, credentialsWithoutKey: [], renamed: [], group: root, pipelines: [] };

  // Everything is checked before anything is written.
  for (const p of parsed.pipelines) {
    safeName(p.folder, "pipeline folder name");
    p.group.split("/").filter(Boolean).forEach((x) => safeName(x, "group name"));
    try { YAML.parse(p.yaml.toString("utf8")); } catch { throw err(400, `${p.appName}'s YAML does not parse. Nothing was written.`); }
  }
  for (const g of parsed.groups) g.rel.split("/").filter(Boolean).forEach((x) => safeName(x, "group name"));

  const envInto = (k: string, file: string, vars: EnvOut[]) => {
    const here = new Set(readEnv(file).map((v) => v.key));
    for (const v of vars) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.key)) continue;
      if (here.has(v.key)) { if (want(k) !== "replace") { rep.skipped++; continue; } }
      const plain = plainOf(v.value);
      if (v.value && plain == null) rep.sealedSkipped++;
      if (here.has(v.key) && plain == null) { rep.skipped++; continue; } // never blank a value that is set
      writeEnv(file, v.key, plain ?? "", !!v.secret);
      if (here.has(v.key)) rep.replaced++; else rep.added++;
    }
  };
  const resInto = (k: string, dir: string, res: Map<string, Buffer>) => {
    for (const [r, data] of res) {
      let full = resourcePath(dir, r);
      if (!full) continue;
      if (fs.existsSync(full)) {
        if (fs.readFileSync(full).equals(data)) continue;
        const d = want(`res:${k}:${r}`);
        if (d === "skip") { rep.skipped++; continue; }
        if (d === "both") {
          const ext = path.extname(r), stem = r.slice(0, r.length - ext.length);
          let i = 2; let alt = `${stem}-${i}${ext}`;
          while (fs.existsSync(resourcePath(dir, alt)!)) alt = `${stem}-${++i}${ext}`;
          full = resourcePath(dir, alt)!; rep.both++; rep.renamed.push({ from: r, to: alt });
        } else rep.replaced++;
      } else rep.added++;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
    }
  };

  if (parsed.global) {
    envInto("env:global", globalLayer().envFile, parsed.global.env);
    resInto("global", globalLayer().resources, parsed.global.resources);
  }
  for (const g of parsed.groups) {
    const gp = join(root, g.rel);
    if (!gp) continue;
    fs.mkdirSync(path.join(PIPELINES_DIR, ...gp.split("/")), { recursive: true });
    const l = groupLayer(gp);
    envInto(`env:group:${g.rel}`, l.envFile, g.env);
    resInto(`group:${g.rel}`, l.resources, g.resources);
  }

  // Pipelines: files now; their schedules, watches and runs in one transaction after.
  const later: { id: string; p: PipeIn; replace: boolean }[] = [];
  const ids = new Set(targets().map((t) => t.id));
  for (const p of parsed.pipelines) {
    const gp = join(root, p.group);
    const here = findHere(gp, p.folder);
    const d: Decision = here ? want(`pipe:${p.key}`) : "both";
    if (here && d === "skip") { rep.skipped++; continue; }
    const doc = YAML.parseDocument(p.yaml.toString("utf8"));
    let folder = p.folder, newId: string, name = p.appName;
    if (here && d === "replace") newId = here.id;
    else {
      newId = p.id && !ids.has(p.id) ? p.id : uuidv4();
      if (here) {
        let i = 2;
        while (fs.existsSync(path.join(PIPELINES_DIR, ...gp.split("/").filter(Boolean), `${p.folder}-${i}`))) i++;
        folder = `${p.folder}-${i}`; name = `${p.appName} (imported)`;
        rep.renamed.push({ from: p.appName, to: name });
      }
    }
    ids.add(newId);
    if (doc.get("id") !== newId) doc.set("id", newId);
    if (name !== p.appName) doc.set("appName", name);
    const text = doc.get("id") === p.id && name === p.appName ? p.yaml.toString("utf8") : String(doc);
    const dir = here && d === "replace" ? path.dirname(path.resolve(PIPELINES_DIR, here.filePath ?? "")) : path.join(PIPELINES_DIR, ...gp.split("/").filter(Boolean), folder);
    if (!path.resolve(dir).startsWith(path.resolve(PIPELINES_DIR) + path.sep)) throw err(400, "A pipeline would land outside the pipelines folder.");
    fs.mkdirSync(path.join(dir, "resources"), { recursive: true });
    const yamlFile = here && d === "replace" ? path.resolve(PIPELINES_DIR, here.filePath ?? "") : path.join(dir, "pipeline.yaml");
    fs.writeFileSync(yamlFile, text, "utf8");
    if (!fs.existsSync(path.join(dir, ".pipeline")) && !(here && d === "replace")) fs.writeFileSync(path.join(dir, ".pipeline"), "");
    const envFile = here && d === "replace" ? pipelineLayer(here).envFile : path.join(dir, ".env");
    if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, `# Environment variables for ${name.replace(/[\r\n]/g, " ")}\n`, { mode: 0o600 });
    envInto(`env:pipe:${p.key}`, envFile, p.env);
    resInto(`pipe:${p.key}`, path.join(dir, "resources"), p.resources);
    if (here && d === "replace") rep.replaced++; else if (here) rep.both++; else rep.added++;
    rep.pipelines.push({ id: newId, appName: name });
    later.push({ id: newId, p, replace: !!here && d === "replace" });
  }

  const conn = db();
  const byKey = new Map(later.map((x) => [x.p.key, x.id]));
  conn.transaction(() => {
    for (const { id: pid, p, replace } of later) {
      const crons = new Set(replace ? schedulesOf(pid).map((x) => x.cron) : []);
      for (const sc of p.schedules) {
        if (typeof sc.cron !== "string" || crons.has(sc.cron)) continue;
        conn.prepare("INSERT INTO schedules (pipeline_target, cron_expression, enabled, created_by) VALUES (?, ?, 0, ?)").run(pid, sc.cron, userId);
        rep.pausedSchedules++;
      }
      const have = new Set(replace ? watchesOf(pid).map((w) => `${w.repoUrl}#${w.branch}`) : []);
      for (const w of p.watches) {
        if (typeof w.repoUrl !== "string" || have.has(`${w.repoUrl}#${w.branch}`)) continue;
        conn.prepare("INSERT INTO git_watches (pipeline_target, group_path, repo_url, branch, poll_seconds, enabled, auto_approve, created_by) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
          .run(pid, join(root, p.group) || null, w.repoUrl, String(w.branch || "main"), Math.max(30, Number(w.pollSeconds) || 60), w.autoApprove ? 1 : 0, userId);
        rep.pausedWatches++;
      }
    }
    for (const g of parsed.groups) {
      const gp = join(root, g.rel);
      if (!gp) continue;
      const existing = listCredentials(gp).filter((c) => c.group === gp);
      for (const c of g.credentials) {
        if (c.kind !== "ssh_key" && c.kind !== "token") continue;
        const plain = plainOf(c.secret);
        if (!plain) { rep.credentialsWithoutKey.push(c.name); continue; }
        const same = existing.find((e) => e.name === c.name);
        let name = c.name;
        if (same) {
          const d = want(`cred:${g.rel}:${c.name}`);
          if (d === "skip") { rep.skipped++; continue; }
          if (d === "replace") { conn.prepare("DELETE FROM git_credentials WHERE id = ?").run(same.id); rep.replaced++; }
          else { name = `${c.name} (imported)`; rep.both++; }
        } else rep.added++;
        conn.prepare("INSERT INTO git_credentials (group_path, name, kind, secret, username, created_by, public_key, use_for_reads) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(gp, name, c.kind, encryptCredential(plain), c.username || null, userId, c.publicKey || null, c.useForReads && c.kind === "ssh_key" ? 1 : 0);
      }
    }
    for (const r of parsed.history) {
      const pid = byKey.get(String(r.pipeline));
      if (!pid) continue;
      const str = (k: string) => (r[k] == null ? null : String(r[k]));
      // The same run imported twice is still one run.
      if (conn.prepare("SELECT 1 FROM builds WHERE target = ? AND started_at IS ? AND build_number = ?").get(pid, str("started_at"), Number(r.build_number) || 0)) continue;
      conn.prepare(`INSERT INTO builds (id, target, status, version, started_at, ended_at, build_number, step_timings, triggered_by, commit_sha, commits, error)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), pid, str("status") ?? "unknown", str("version"), str("started_at"), str("ended_at"), Number(r.build_number) || 0, str("step_timings"), str("triggered_by"), str("commit_sha"), str("commits"), str("error"));
      rep.runs++;
    }
  })();

  EZPipelineController.instance.refreshTargets();
  return rep;
}
