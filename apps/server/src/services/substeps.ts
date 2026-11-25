/**
 * Substeps: a step can be made of smaller steps, and those of smaller ones.
 *
 * Two sources, one tree:
 *
 *   YAML     A step with `steps:` instead of `run:`. Its children run in
 *            order, in the parent's cwd and env unless they set their own,
 *            and are known before they run, so the UI can show what is left.
 *
 *   Markers  A command prints `::ezp step <name>` and the lines after it
 *            belong to that substep until `::ezp done` (or `::ezp fail`).
 *            Markers nest: a `step` inside an open one is its child.
 *            `::ezp progress <n>/<m> [unit]` sets a counter on the innermost
 *            open substep, or on the step itself when none is open.
 *
 * Paths are 1-based and dotted: "11" is the eleventh step, "11.2.1" the first
 * child of its second child. The step itself is never a row unless it reports
 * progress; its children are.
 */
import { fieldWarnings } from "./pipelineFile.js";

export type SubstepStatus = "pending" | "running" | "success" | "failed";

export interface Substep {
  path: string;
  name: string;
  status: SubstepStatus;
  startedAt: number | null;
  endedAt: number | null;
  done: number | null;
  total: number | null;
  unit: string | null;
  source: "yaml" | "marker";
}

/** The parts of a step this file reads. Matches the controller's Step. */
export interface StepLike {
  name?: unknown;
  run?: unknown;
  steps?: unknown;
  type?: unknown;
  cwd?: unknown;
  env?: unknown;
  continueOnError?: unknown;
}

export const MAX_DEPTH = 6;

/**
 * Problems with a pipeline's steps, each naming where it is ("steps[2].steps[0]").
 * Empty when the steps are fine. Only shape is checked: whether a command works
 * is for the run to find out.
 */
export function validateSteps(steps: unknown, where = "steps", depth = 1): string[] {
  if (!Array.isArray(steps)) return [`${where} must be a list`];
  if (steps.length === 0) return [`${where} is empty`];
  const out: string[] = [];
  steps.forEach((raw, i) => {
    const at = `${where}[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { out.push(`${at} must be a mapping`); return; }
    const s = raw as StepLike;
    if (typeof s.name !== "string" || !s.name.trim()) out.push(`${at} needs a name`);
    const label = typeof s.name === "string" && s.name.trim() ? `${at} ("${s.name}")` : at;
    const special = s.type === "approval" || s.type === "action";
    const hasRun = typeof s.run === "string" && s.run.trim() !== "";
    const hasSteps = s.steps !== undefined;
    if (special && depth > 1) out.push(`${label}: a ${s.type} step can only be at the top level`);
    if (special && hasSteps) out.push(`${label}: a ${s.type} step cannot have substeps`);
    if (!special && hasRun && hasSteps) out.push(`${label} has both run and steps; use one`);
    if (!special && !hasRun && !hasSteps) out.push(`${label} needs run or steps`);
    if (s.run !== undefined && typeof s.run !== "string") out.push(`${label}: run must be text`);
    if (s.cwd !== undefined && typeof s.cwd !== "string") out.push(`${label}: cwd must be text`);
    if (s.env !== undefined && (typeof s.env !== "object" || s.env === null || Array.isArray(s.env))) out.push(`${label}: env must be a mapping`);
    if (hasSteps) {
      if (depth >= MAX_DEPTH) out.push(`${label}: substeps go ${MAX_DEPTH} levels deep at most`);
      else out.push(...validateSteps(s.steps, `${at}.steps`, depth + 1));
    }
  });
  return out;
}

export type Marker =
  | { kind: "step"; name: string }
  | { kind: "done" }
  | { kind: "fail"; message: string }
  | { kind: "progress"; done: number; total: number; unit: string | null };

const MARKER = /^\s*::ezp\s+(step|done|fail|progress)\b[ \t]*(.*)$/;

/** A marker line, or null for an ordinary one. A malformed marker is an ordinary line. */
export function parseMarker(line: string): Marker | null {
  const m = MARKER.exec(line);
  if (!m) return null;
  const arg = m[2].trim();
  switch (m[1]) {
    case "step":
      return arg ? { kind: "step", name: arg.slice(0, 200) } : null;
    case "done":
      return { kind: "done" };
    case "fail":
      return { kind: "fail", message: arg };
    case "progress": {
      const p = /^(\d+)\s*\/\s*(\d+)(?:\s+(.{1,40}))?$/.exec(arg);
      if (!p) return null;
      return { kind: "progress", done: Number(p[1]), total: Number(p[2]), unit: p[3]?.trim() ?? null };
    }
  }
  return null;
}

/**
 * The substep tree of one run, as it happens. Every change goes to `save`,
 * which writes the row and tells the browsers.
 */
export class SubstepTracker {
  private rows = new Map<string, Substep>();
  /** Open paths, outermost first. [0] is the top-level step. */
  private stack: string[] = [];
  /** How many marker substeps are open on top of the YAML node being run. */
  private markers = 0;
  private counters = new Map<string, number>();
  private topName = "";
  private save: (s: Substep) => void;
  private now: () => number;

  constructor(save: (s: Substep) => void, now: () => number = Date.now) {
    this.save = save;
    this.now = now;
  }

  /** A top-level step starts. Its YAML children are written as pending so the UI can show them ahead. */
  beginStep(index: number, step: StepLike) {
    const path = String(index + 1);
    this.stack = [path];
    this.markers = 0;
    this.topName = String(step.name ?? "");
    if (Array.isArray(step.steps)) this.register(step.steps as StepLike[], path);
  }

  private register(children: StepLike[], parent: string) {
    this.counters.set(parent, children.length);
    children.forEach((c, j) => {
      const path = `${parent}.${j + 1}`;
      this.put({ path, name: String(c.name ?? `Step ${j + 1}`), status: "pending", startedAt: null, endedAt: null, done: null, total: null, unit: null, source: "yaml" });
      if (Array.isArray(c.steps)) this.register(c.steps as StepLike[], path);
    });
  }

  /** Where a line printed now belongs: the innermost open substep, or null when only the step is open. */
  current(): string | null {
    return this.stack.length > 1 ? this.stack[this.stack.length - 1] : null;
  }

  /** A YAML child starts running. */
  enter(path: string) {
    const r = this.rows.get(path);
    if (r) this.put({ ...r, status: "running", startedAt: this.now(), endedAt: null });
    this.stack.push(path);
  }

  /** A YAML child is over. Any marker substeps its command left open close with it. */
  leave(path: string, ok: boolean) {
    this.closeMarkers(ok);
    const at = this.stack.lastIndexOf(path);
    if (at > 0) this.stack.length = at;
    const r = this.rows.get(path);
    if (r) this.put({ ...r, status: ok ? "success" : "failed", endedAt: this.now() });
  }

  /** The command of a leaf is over: close what its markers left open. */
  closeMarkers(ok: boolean) {
    while (this.markers > 0) this.pop(ok ? "success" : "failed");
  }

  /** Feed one output line. True when it was a marker, which then is not a log line. */
  line(text: string): boolean {
    const m = parseMarker(text);
    if (!m || this.stack.length === 0) return false;
    switch (m.kind) {
      case "step": {
        const parent = this.stack[this.stack.length - 1];
        const n = (this.counters.get(parent) ?? 0) + 1;
        this.counters.set(parent, n);
        const path = `${parent}.${n}`;
        this.put({ path, name: m.name, status: "running", startedAt: this.now(), endedAt: null, done: null, total: null, unit: null, source: "marker" });
        this.stack.push(path);
        this.markers++;
        break;
      }
      case "done":
        if (this.markers > 0) this.pop("success");
        break;
      case "fail":
        if (this.markers > 0) this.pop("failed");
        break;
      case "progress": {
        const path = this.stack[this.stack.length - 1];
        const r = this.rows.get(path) ?? { path, name: this.topName, status: "running" as const, startedAt: this.now(), endedAt: null, done: null, total: null, unit: null, source: "marker" as const };
        this.put({ ...r, done: Math.min(m.done, m.total), total: m.total, unit: m.unit });
        break;
      }
    }
    return true;
  }

  /** The top-level step is over. A top-level progress row is closed with it. */
  endStep(ok: boolean) {
    this.closeMarkers(ok);
    const top = this.stack[0];
    const r = top ? this.rows.get(top) : undefined;
    if (r) this.put({ ...r, status: ok ? "success" : "failed", endedAt: this.now() });
    this.stack = [];
  }

  all(): Substep[] {
    return [...this.rows.values()];
  }

  private pop(status: SubstepStatus) {
    const path = this.stack.pop()!;
    this.markers--;
    const r = this.rows.get(path);
    if (r) this.put({ ...r, status, endedAt: this.now() });
  }

  private put(s: Substep) {
    this.rows.set(s.path, s);
    this.save(s);
  }
}

/**
 * Everything wrong with a pipeline file, each with the line it is on, for the
 * editor's Problems panel. YAML syntax first; the step shape only once it parses.
 *
 * A warning is a field that does nothing (services/pipelineFile.ts): it is shown,
 * and the file can still be saved. Anything else stops the save.
 */
export function checkPipelineYaml(content: string, parseDocument: (src: string) => any): { line: number | null; message: string; severity?: "warning" }[] {
  const src = content.split("\n---")[0];
  const doc = parseDocument(src);
  const lineAt = (offset: number | undefined) => (offset == null ? null : src.slice(0, offset).split("\n").length);
  if (doc.errors?.length) {
    return doc.errors.map((e: any) => ({ line: e.linePos?.[0]?.line ?? lineAt(e.pos?.[0]), message: String(e.message).split("\n")[0] }));
  }
  const js = doc.toJS();
  if (!js || typeof js !== "object" || Array.isArray(js)) return [{ line: 1, message: "A pipeline file is a mapping: id, appName, steps…" }];
  const out: { line: number | null; message: string; severity?: "warning" }[] = [];
  if (!js.id) out.push({ line: 1, message: "id is missing" });
  if (!js.appName) out.push({ line: 1, message: "appName is missing" });
  for (const p of validateSteps(js.steps)) {
    // "steps[2].steps[0] (…)" → ["steps", 2, "steps", 0]
    const where = p.split(/[ :]/)[0];
    const parts: (string | number)[] = [];
    for (const m of where.matchAll(/([A-Za-z_]+)|\[(\d+)\]/g)) parts.push(m[1] ?? Number(m[2]));
    let node: any = null;
    for (let n = parts.length; n > 0 && !node; n--) node = doc.getIn(parts.slice(0, n), true);
    out.push({ line: lineAt(node?.range?.[0]), message: p });
  }
  for (const w of fieldWarnings(js)) {
    // The key's own line: the pair whose key is the last part of the path.
    const parent = w.path.length > 1 ? doc.getIn(w.path.slice(0, -1), true) : doc.contents;
    const pair = parent?.items?.find((it: any) => it?.key?.value === w.path[w.path.length - 1]);
    out.push({ line: lineAt(pair?.key?.range?.[0]), message: w.message, severity: "warning" });
  }
  return out;
}
