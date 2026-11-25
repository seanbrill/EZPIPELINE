import type { Request, Response, NextFunction } from "express";
import { DatabaseService } from "./Database.js";

export interface AuditEvent {
  id: number;
  at: string;
  userId: number | null;
  username: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  status: number | null;
  detail: Record<string, unknown> | null;
}

/**
 * Body fields copied into an event's detail. An allowlist, never a denylist:
 * a request body can hold passwords, env values, YAML and private keys, and
 * the audit log must not become a second place they are stored.
 */
const SAFE_BODY_KEYS = ["name", "pipelineTarget", "target", "group", "groupPath", "path", "repoUrl", "branch", "enabled", "autoApprove", "cronExpression", "username", "key", "version", "scopes", "isAdmin", "canManageUsers", "theme", "level"];

/** Writes nobody needs a record of: they change nothing a person would ask about. */
const SKIP = [/^\/logs-stream\/ticket$/, /^\/git-watches\/probe$/, /^\/auth\/mfa\/resend$/, /^\/settings\/preferences$/, /^\/settings\/mail\/test$/, /^\/me\/state\//, /^\/terminal\/input$/];

function targetOf(req: Request): string | null {
  const p = req.params ?? {};
  const b = (req.body ?? {}) as Record<string, unknown>;
  const v = p.targetName ?? p.pipeline ?? p.group ?? b.pipelineTarget ?? b.target ?? b.path ?? p.id ?? null;
  return v == null ? null : String(v).slice(0, 300);
}

export class AuditService {
  private static instance: AuditService;
  public static getInstance(): AuditService {
    if (!AuditService.instance) AuditService.instance = new AuditService();
    return AuditService.instance;
  }

  public record(e: Omit<AuditEvent, "id" | "at"> & { at?: string }) {
    try {
      DatabaseService.getInstance().getDb().prepare(
        `INSERT INTO audit_events (at, user_id, username, action, target, ip, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(e.at ?? new Date().toISOString(), e.userId, e.username, e.action, e.target, e.ip, e.status, e.detail ? JSON.stringify(e.detail) : null);
    } catch (err) {
      // An audit write must never fail the request it describes.
      console.warn(`[audit] dropped an event (${e.action}): ${(err as Error).message}`);
    }
  }

  public list(f: { user?: string; target?: string; action?: string; since?: string; until?: string; before?: number; limit?: number }): AuditEvent[] {
    const where: string[] = [];
    const vals: unknown[] = [];
    if (f.user) { where.push("username = ?"); vals.push(f.user); }
    if (f.target) { where.push("target LIKE ?"); vals.push(`%${f.target}%`); }
    if (f.action) { where.push("action LIKE ?"); vals.push(`%${f.action}%`); }
    if (f.since) { where.push("at >= ?"); vals.push(f.since); }
    if (f.until) { where.push("at <= ?"); vals.push(f.until); }
    if (f.before) { where.push("id < ?"); vals.push(f.before); }
    const limit = Math.min(Math.max(Number(f.limit) || 100, 1), 500);
    const rows = DatabaseService.getInstance().getDb().prepare(
      `SELECT * FROM audit_events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${limit}`
    ).all(...vals) as any[];
    return rows.map((r) => ({
      id: r.id, at: r.at, userId: r.user_id, username: r.username, action: r.action,
      target: r.target, ip: r.ip, status: r.status, detail: r.detail ? JSON.parse(r.detail) : null,
    }));
  }

  /**
   * Middleware: every write to the API (POST, PUT, PATCH, DELETE) becomes an
   * event when its response finishes, refused ones included, because "who
   * tried to delete this" is half of why an audit log exists.
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
      res.on("finish", () => {
        const full = req.originalUrl.split("?")[0].replace(/^\/api/, "") || "/";
        if (SKIP.some((re) => re.test(full))) return;
        const user = (req as any).user;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const detail: Record<string, unknown> = {};
        for (const k of SAFE_BODY_KEYS) if (body[k] !== undefined && typeof body[k] !== "object") detail[k] = body[k];
        if (Array.isArray(body.scopes)) detail.scopes = body.scopes;
        // Done with an API token: which one, so a leaked token's trail can be followed.
        if (user?.viaToken) detail.token = user.viaToken.id;
        // A login has no session yet; who it was for is the point.
        const username = user?.username
          ?? (full === "/login" && typeof body.username === "string" ? body.username : null)
          ?? (full.startsWith("/agent/") ? "agent token" : null);
        this.record({
          userId: user?.id ?? null,
          username,
          action: `${req.method} ${full}`,
          target: targetOf(req),
          ip: req.ip ?? null,
          status: res.statusCode,
          detail: Object.keys(detail).length ? detail : null,
        });
      });
      next();
    };
  }
}
