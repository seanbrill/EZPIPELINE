/**
 * Handing an instance's people and data to the one the wizard just deployed.
 *
 * The new instance starts with EZP_SETUP_TOKEN in its environment (set through the
 * cloud's API, never sent over the network by us) and no users. While both are
 * true, it takes exactly one hand-over: an envelope encrypted with AES-256-GCM
 * under a key derived from that token. The envelope can travel over the load
 * balancer's plain address: without the token it can be neither read nor forged.
 * Once someone exists, the receiving route refuses, and the token is inert.
 *
 * The envelope holds the users (password hashes included, so everyone signs in
 * as they do here), their permissions, and an .ezp bundle sealed with a one-time
 * passphrase that travels inside the same envelope.
 */
import crypto from "crypto";
import fs from "fs";
import { DatabaseService } from "../Database.js";
import { buildExport, exportPath, deleteExport, inspect, apply, type Report } from "../bundle.js";
import { writeSetup } from "../setup.js";
import { SchedulerService } from "../SchedulerService.js";
import { decryptCredential } from "../gitCredentials.js";
import { readZip } from "../zip.js";
import type { Draft, MoveReport } from "./store.js";

const MAGIC = Buffer.from("EZPMOVE1");
const INFO = "ezpipeline-selfhost-move-v1";
const keyFor = (token: string, salt: Buffer) => Buffer.from(crypto.hkdfSync("sha256", token, salt, INFO, 32));

export function seal(token: string, plain: Buffer): Buffer {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(token, salt), iv);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

/** null when the envelope is not one, or was made with another token. */
export function open(token: string, env: Buffer): Buffer | null {
  if (env.length < 52 || !env.subarray(0, 8).equals(MAGIC)) return null;
  const salt = env.subarray(8, 24), iv = env.subarray(24, 36), tag = env.subarray(36, 52);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", keyFor(token, salt), iv);
    d.setAAD(MAGIC);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(env.subarray(52)), d.final()]);
  } catch {
    return null;
  }
}

// ── What goes across ──────────────────────────────────────────────────────

const USER_COLS = ["username", "password", "email", "mfa_enabled", "is_admin", "is_primary_admin", "display_name", "can_manage_users"] as const;
type UserRow = Record<(typeof USER_COLS)[number], unknown>;
interface Payload {
  v: 1;
  instance: { name: string; url: string };
  users: UserRow[];
  /** One row per user and target; every can_* column the sender has. */
  permissions: Record<string, unknown>[];
  bundle: string | null;
  passphrase: string | null;
}

const db = () => DatabaseService.getInstance().getDb();
const columns = (table: string) => (db().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

/**
 * Build the envelope for a draft. "move" sends every user and the whole instance;
 * "fresh" and "bundle" send only the admin who deployed it, made the primary admin,
 * and with "bundle" the file chosen on step 4.
 */
export function buildPayload(d: Draft, o: { url: string; instanceName: string; bundleFile?: string }): { payload: Payload; counts: Omit<MoveReport, "at" | "secrets"> } {
  const have = new Set(columns("users"));
  const cols = USER_COLS.filter((c) => have.has(c));
  const all = db().prepare(`SELECT id, ${cols.join(", ")} FROM users ORDER BY id`).all() as (UserRow & { id: number })[];
  let users = d.data.mode === "move" ? all : all.filter((u) => u.id === d.by.id);
  if (d.data.mode !== "move") {
    users = users.map((u) => ({ ...u, is_admin: 1, is_primary_admin: 1, can_manage_users: 1, email: d.config.adminEmail || u.email }));
  }
  if (!users.length) throw Object.assign(new Error("The admin who started this deploy no longer exists here."), { status: 409 });
  const ids = new Set(users.map((u) => u.id));
  const byId = new Map(all.map((u) => [u.id, u.username]));
  const permissions = d.data.mode !== "move" ? [] : (db().prepare("SELECT * FROM permissions").all() as Record<string, unknown>[])
    .filter((p) => ids.has(Number(p.user_id)))
    .map(({ id: _id, user_id, ...rest }) => ({ username: byId.get(Number(user_id)), ...rest }));

  let bundle: Buffer | null = null;
  let passphrase: string | null = null;
  let counts = { users: users.length, pipelines: 0, groups: 0, variables: 0, credentials: 0, runs: 0 };
  if (d.data.mode === "move") {
    passphrase = crypto.randomBytes(24).toString("base64url");
    const rec = buildExport({ type: "instance" }, { include: { history: d.data.history }, passphrase, by: d.by.username });
    try {
      bundle = fs.readFileSync(exportPath(rec.file)!);
    } finally {
      deleteExport(rec.file); // a one-time bundle, not an export someone made
    }
  } else if (d.data.mode === "bundle" && o.bundleFile) {
    bundle = fs.readFileSync(o.bundleFile);
    passphrase = d.data.bundlePass ? decryptCredential(d.data.bundlePass) : null;
  }
  if (bundle) {
    const m = readManifestCounts(bundle);
    counts = { ...counts, pipelines: m.pipelines ?? 0, groups: m.groups ?? 0, variables: m.variables ?? 0, credentials: m.credentials ?? 0, runs: m.runs ?? 0 };
  }
  return {
    payload: {
      v: 1, instance: { name: o.instanceName, url: o.url },
      users: users.map(({ id: _id, ...u }) => u as UserRow), permissions,
      bundle: bundle ? bundle.toString("base64") : null, passphrase,
    },
    counts,
  };
}

function readManifestCounts(zip: Buffer): Record<string, number> {
  try { return JSON.parse(readZip(zip).get("manifest.json")?.toString("utf8") ?? "{}").counts ?? {}; } catch { return {}; }
}

/** Pause what would otherwise run twice, and say which, so "Keep both" can undo exactly that. */
export function pauseHere(): { schedules: number[]; watches: number[] } {
  const schedules = (db().prepare("SELECT id FROM schedules WHERE enabled = 1").all() as { id: number }[]).map((r) => r.id);
  const watches = (db().prepare("SELECT id FROM git_watches WHERE enabled = 1").all() as { id: number }[]).map((r) => r.id);
  for (const id of schedules) SchedulerService.getInstance().toggleSchedule(id, false);
  if (watches.length) db().prepare(`UPDATE git_watches SET enabled = 0 WHERE id IN (${watches.map(() => "?").join(",")})`).run(...watches);
  return { schedules, watches };
}
export function resumeHere(p: { schedules: number[]; watches: number[] }) {
  for (const id of p.schedules) { try { SchedulerService.getInstance().toggleSchedule(id, true); } catch { /* removed since */ } }
  if (p.watches.length) db().prepare(`UPDATE git_watches SET enabled = 1 WHERE id IN (${p.watches.map(() => "?").join(",")})`).run(...p.watches);
}

// ── The receiving end ─────────────────────────────────────────────────────

export class ReceiveError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/**
 * Take a hand-over: only on an instance started with EZP_SETUP_TOKEN, only while it
 * has no users, and only an envelope made with that token.
 */
export function receive(envelope: Buffer, token = process.env.EZP_SETUP_TOKEN): { users: number; report: Report | null } {
  if (!token) throw new ReceiveError(404, "not_found", "This instance was not deployed by the self-host wizard.");
  if (DatabaseService.getInstance().hasUsers()) throw new ReceiveError(409, "already_set_up", "This instance already has users, so it takes no more hand-overs.");
  const plain = open(token, envelope);
  if (!plain) throw new ReceiveError(403, "wrong_key", "That hand-over was not made for this instance.");
  const p = JSON.parse(plain.toString("utf8")) as Payload;
  if (p.v !== 1 || !Array.isArray(p.users) || !p.users.length) throw new ReceiveError(400, "bad_payload", "The hand-over holds no users.");

  const have = new Set(columns("users"));
  const cols = USER_COLS.filter((c) => have.has(c));
  const pcols = new Set(columns("permissions"));
  const conn = db();
  const ids = new Map<string, number>();
  conn.transaction(() => {
    for (const u of p.users) {
      if (typeof u.username !== "string" || typeof u.password !== "string" || !/^\$2[aby]\$/.test(u.password)) continue;
      const r = conn.prepare(`INSERT INTO users (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => (u[c] ?? null) as never));
      ids.set(u.username, Number(r.lastInsertRowid));
    }
    if (!ids.size) throw new ReceiveError(400, "bad_payload", "The hand-over holds no user this instance can take.");
    // Exactly one primary admin, whatever arrived.
    const primary = conn.prepare("SELECT id FROM users WHERE is_primary_admin = 1 ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    const first = primary?.id ?? (conn.prepare("SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id ?? [...ids.values()][0];
    conn.prepare("UPDATE users SET is_primary_admin = CASE WHEN id = ? THEN 1 ELSE 0 END").run(first);
    conn.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(first);
    for (const row of p.permissions ?? []) {
      const uid = ids.get(String(row.username));
      if (!uid || typeof row.target !== "string") continue;
      const keys = Object.keys(row).filter((k) => k !== "username" && pcols.has(k) && /^(target|can_[a-z_]+)$/.test(k));
      conn.prepare(`INSERT OR IGNORE INTO permissions (user_id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`).run(uid, ...keys.map((k) => row[k] as never));
    }
  })();

  let report: Report | null = null;
  if (p.bundle) {
    const admin = conn.prepare("SELECT id, username FROM users WHERE is_primary_admin = 1").get() as { id: number; username: string };
    const s = inspect(Buffer.from(p.bundle, "base64"), "hand-over.ezp", admin.username);
    report = apply(s.id, { mode: "merge", group: "" }, {}, p.passphrase ?? undefined, admin.id);
  }
  writeSetup({ done: true, acknowledged: true, instance: { name: p.instance?.name || "EZPipeline", url: p.instance?.url || "" } }, { fresh: true });
  return { users: ids.size, report };
}
