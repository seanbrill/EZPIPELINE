/**
 * Personal API tokens. `ezp_` and 43 characters of randomness; only the
 * SHA-256 is kept, so a database copy holds nothing that signs in. A token
 * acts as its owner and never more:
 *   read  GET only
 *   run   also start, stop, approve and roll back runs
 *   full  everything the owner can do, except their password, codes and tokens
 */
import crypto from "crypto";
import { DatabaseService } from "./Database.js";

export type TokenLevel = "read" | "run" | "full";
export const LEVELS: TokenLevel[] = ["read", "run", "full"];
export const PREFIX = "ezp_";

export interface ApiTokenRow { id: number; user_id: number; name: string; last4: string; level: TokenLevel; created_at: string; last_used_at: string | null; expires_at: string | null }

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const db = () => DatabaseService.getInstance().getDb();

export function createToken(userId: number, name: string, level: TokenLevel, days: number | null): { token: string; row: ApiTokenRow } {
  const n = name.trim().slice(0, 60);
  if (!n) throw Object.assign(new Error("Give it a name you will recognise."), { status: 400 });
  if (!LEVELS.includes(level)) throw Object.assign(new Error("level is read, run or full."), { status: 400 });
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw Object.assign(new Error("Expiry is 1 to 3650 days, or never."), { status: 400 });
  const count = (db().prepare("SELECT COUNT(*) n FROM api_tokens WHERE user_id = ?").get(userId) as { n: number }).n;
  if (count >= 50) throw Object.assign(new Error("You have 50 tokens. Revoke some first."), { status: 400 });
  const token = PREFIX + crypto.randomBytes(32).toString("base64url");
  const expires = days === null ? null : new Date(Date.now() + days * 86400_000).toISOString();
  const info = db().prepare("INSERT INTO api_tokens (user_id, name, token_hash, last4, level, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, n, hash(token), token.slice(-4), level, expires);
  return { token, row: db().prepare("SELECT id, user_id, name, last4, level, created_at, last_used_at, expires_at FROM api_tokens WHERE id = ?").get(info.lastInsertRowid) as ApiTokenRow };
}

export function listTokens(userId: number): ApiTokenRow[] {
  return db().prepare("SELECT id, user_id, name, last4, level, created_at, last_used_at, expires_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ApiTokenRow[];
}

export function revokeToken(userId: number, id: number): boolean {
  return db().prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** The token's row if it is real and not expired. Marks it used. */
export function lookupToken(raw: string): ApiTokenRow | null {
  if (!raw.startsWith(PREFIX) || raw.length > 100) return null;
  const row = db().prepare("SELECT id, user_id, name, last4, level, created_at, last_used_at, expires_at FROM api_tokens WHERE token_hash = ?").get(hash(raw)) as ApiTokenRow | undefined;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  // At most once a minute, so a busy script does not write on every call.
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at + (row.last_used_at.includes("T") ? "" : "Z")).getTime() > 60_000) {
    db().prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  }
  return row;
}

const RUN_ROUTES = [/^\/api\/run-pipeline$/, /^\/api\/builds\/[^/]+\/(approve|abort|action|rollback)$/];
const NEVER = [/^\/api\/me\/tokens/, /^\/api\/change-password$/, /^\/api\/auth\//, /^\/api\/users(\/|$)/, /^\/api\/agent-tokens/, /^\/api\/admin\/api-tokens/, /^\/api\/setup/];

/** May a token at this level make this request? `path` is the path without the query. */
export function levelAllows(level: TokenLevel, method: string, path: string): boolean {
  if (NEVER.some((r) => r.test(path)) && !(method === "GET" && path === "/api/users/me")) return false;
  if (method === "GET" || method === "HEAD") return true;
  if (level === "read") return false;
  if (level === "run") return RUN_ROUTES.some((r) => r.test(path));
  return true;
}
