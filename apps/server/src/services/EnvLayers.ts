/**
 * The layers a run's environment and resources are built from, in order:
 *
 *   global              <data>/.env.global           <data>/global/resources
 *   group:A, group:A/B  <pipelines>/A/.env.group      <pipelines>/A/resources
 *   pipeline:<id>       the pipeline's .env           <pipeline folder>/resources
 *
 * The most specific layer wins. This mirrors what EZPipelineController.run
 * loads, so what the UI shows is what a run gets.
 *
 * Secrets: a key that looks like one (the same rule the log redactor uses), or
 * one marked with a `# @secret` comment line directly above it, is never sent
 * to the browser except by an explicit reveal.
 */
import fs from "fs";
import path from "path";
import { PIPELINES_DIR } from "../config/index.js";

export const SECRET_KEY = /(SECRET|PASSWORD|PASSWD|TOKEN|_KEY|APIKEY|API_KEY|CREDENTIAL|PRIVATE|SESSION|SALT|CERT|_PAT$|^PAT_|DSN|WEBHOOK|DATABASE_URL)/i;
const MARK = "# @secret";
const KEY_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnvVar { key: string; value: string; secret: boolean }
export interface PipelineRef { id: string; appName?: string; group?: string; filePath?: string }
export interface Layer { id: string; label: string; kind: "global" | "group" | "pipeline"; envFile: string; resources: string }

const dataDir = () => path.dirname(PIPELINES_DIR);

export function globalLayer(): Layer {
  return { id: "global", label: "Global", kind: "global", envFile: path.join(dataDir(), ".env.global"), resources: path.join(dataDir(), "global", "resources") };
}

export function groupLayer(group: string): Layer {
  const parts = group.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === "." || p === ".." || p.startsWith("."))) throw Object.assign(new Error("Bad group name."), { status: 400 });
  const dir = path.join(PIPELINES_DIR, ...parts);
  return { id: `group:${parts.join("/")}`, label: parts.join("/"), kind: "group", envFile: path.join(dir, ".env.group"), resources: path.join(dir, "resources") };
}

export function pipelineLayer(p: PipelineRef): Layer {
  const yamlDir = path.dirname(path.resolve(PIPELINES_DIR, p.filePath ?? ""));
  const bundle = fs.existsSync(path.join(yamlDir, ".pipeline"));
  const candidates = bundle
    ? [path.join(yamlDir, ".env"), path.join(yamlDir, `.env.${p.id}`)]
    : [path.join(path.dirname(yamlDir), "env", `.env.${p.id}`), path.join(yamlDir, `.env.${p.id}`)];
  const envFile = candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
  return { id: `pipeline:${p.id}`, label: "This pipeline", kind: "pipeline", envFile, resources: path.join(yamlDir, "resources") };
}

/** Global, each enclosing group, then the pipeline. */
export function layersFor(p: PipelineRef): Layer[] {
  const parts = (p.group ?? "").split(/[\\/]/).filter(Boolean);
  const groups = parts.map((_, i) => groupLayer(parts.slice(0, i + 1).join("/")));
  return [globalLayer(), ...groups, pipelineLayer(p)];
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  const hash = t.search(/\s#/);
  return hash >= 0 ? t.slice(0, hash).trim() : t;
}

export function readEnv(file: string): EnvVar[] {
  if (!fs.existsSync(file)) return [];
  const out: EnvVar[] = [];
  let marked = false;
  for (const raw of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === MARK) { marked = true; continue; }
    if (!line || line.startsWith("#")) { marked = false; continue; }
    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) { marked = false; continue; }
    const key = body.slice(0, eq).trim();
    out.push({ key, value: unquote(body.slice(eq + 1)), secret: marked || SECRET_KEY.test(key) });
    marked = false;
  }
  return out;
}

function encode(value: string): string {
  return /^[A-Za-z0-9_./:@%+,=-]*$/.test(value) ? value : JSON.stringify(value);
}

/** Set one variable in a file, keeping every other line (and comment) as it was. */
export function writeEnv(file: string, key: string, value: string, secret: boolean) {
  if (!KEY_OK.test(key)) throw Object.assign(new Error("A name is letters, digits and _, and does not start with a digit."), { status: 400 });
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf-8").split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const at = lines.findIndex((l) => {
    const b = l.trim().replace(/^export\s+/, "");
    return b.startsWith(`${key}=`) || b.startsWith(`${key} =`);
  });
  const entry = `${key}=${encode(value)}`;
  // Marked only when the name would not already be treated as secret.
  const wantMark = secret && !SECRET_KEY.test(key);
  if (at >= 0) {
    const hasMark = at > 0 && lines[at - 1].trim() === MARK;
    lines[at] = entry;
    if (hasMark && !wantMark) lines.splice(at - 1, 1);
    if (!hasMark && wantMark) lines.splice(at, 0, MARK);
  } else {
    if (wantMark) lines.push(MARK);
    lines.push(entry);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", { encoding: "utf-8", mode: 0o600 });
}

export function deleteEnv(file: string, key: string): boolean {
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().replace(/^export\s+/, "").startsWith(`${key}=`));
  if (at < 0) return false;
  const from = at > 0 && lines[at - 1].trim() === MARK ? at - 1 : at;
  lines.splice(from, at - from + 1);
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
  return true;
}

export interface ResourceFile { path: string; size: number; modified: string }

/** Every file under a resources folder, relative to it. */
export function listResources(dir: string): ResourceFile[] {
  const out: ResourceFile[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const st = fs.statSync(full);
        out.push({ path: path.relative(dir, full).split(path.sep).join("/"), size: st.size, modified: st.mtime.toISOString() });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** A file inside a resources folder, or null when the name would leave it. */
export function resourcePath(dir: string, rel: string): string | null {
  const base = path.resolve(dir);
  const full = path.resolve(base, rel);
  return full.startsWith(base + path.sep) ? full : null;
}
