// Group scoped git credentials, over HTTP.
//
// Permissions ride on the GROUP, exactly as routes/groupEnv.ts argues for the
// environment: "somebody trusted with FileFreak's credentials is not thereby
// trusted with notch.fm's, and a single permission covering both would make
// this scoping cosmetic." That argument is stronger for a deploy key than for
// an environment variable, so the same check is reused rather than a parallel
// one invented.
//
// THE SECRET NEVER COMES BACK. Not masked, not partially - it is absent from
// every response. A screen that shows a credential leaks it to anybody who
// reaches an admin session, which is the thing being fixed rather than moved.

import { Router, Request, Response } from "express";
import Logger from "../controllers/Logger.js";
import { PermissionsService } from "../services/PermissionsService.js";
import { DatabaseService } from "../services/Database.js";
import {
  createCredential,
  deleteCredential,
  getCredential,
  listCredentials,
  recordTest,
  testCredential,
  toView,
  type CredentialKind,
} from "../services/gitCredentials.js";

const router = Router();
const logger = Logger.getInstance();
const permissions = PermissionsService.getInstance();

/** Same rule as groupEnv: write needs write on the group, read needs read. */
const allowed = (req: Request, res: Response, group: string, action: "view" | "edit"): boolean => {
  const user = (req as any).user;
  if (!group) {
    res.status(400).json({ error: "A group is required" });
    return false;
  }
  const ok =
    action === "edit"
      ? permissions.checkAccess(user.id, group, "write") ||
        permissions.checkPermission(user.id, "global-env", "editEnv")
      : permissions.checkAccess(user.id, group, "read") ||
        permissions.checkPermission(user.id, "global-env", "view");
  if (!ok) {
    res.status(403).json({ error: `Access denied to ${group}'s credentials` });
    return false;
  }
  return true;
};

router.get("/:group", (req: Request, res: Response) => {
  const group = decodeURIComponent(req.params.group ?? "");
  if (!allowed(req, res, group, "view")) return;
  try {
    res.json({ credentials: listCredentials(group) });
  } catch (e) {
    logger.error(`list git credentials failed: ${e}`);
    res.status(500).json({ error: "Could not read the credentials" });
  }
});

router.post("/:group", (req: Request, res: Response) => {
  const group = decodeURIComponent(req.params.group ?? "");
  if (!allowed(req, res, group, "edit")) return;

  const name = String(req.body?.name ?? "").trim();
  const kind = String(req.body?.kind ?? "") as CredentialKind;
  const secret = String(req.body?.secret ?? "");
  const username = String(req.body?.username ?? "").trim();

  if (!name) return void res.status(400).json({ error: "Give it a name you will recognise" });
  if (kind !== "ssh_key" && kind !== "token") {
    return void res.status(400).json({ error: "kind must be ssh_key or token" });
  }
  if (!secret.trim()) return void res.status(400).json({ error: "The credential itself is missing" });
  // A private key pasted without its header is the most common paste error and
  // fails later with "invalid format", which says nothing about what to do.
  if (kind === "ssh_key" && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(secret)) {
    return void res.status(400).json({
      error:
        "That does not look like a private key. Paste the PRIVATE half - the file " +
        "WITHOUT .pub - including its BEGIN and END lines.",
    });
  }

  try {
    res.status(201).json({ credential: createCredential({
      group, name, kind, secret, username,
      createdBy: (req as any).user?.id ?? null,
    }) });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return void res.status(409).json({ error: `This group already has one called "${name}"` });
    }
    logger.error(`create git credential failed: ${e}`);
    res.status(500).json({ error: "Could not save that credential" });
  }
});

router.delete("/:group/:id", (req: Request, res: Response) => {
  const group = decodeURIComponent(req.params.group ?? "");
  if (!allowed(req, res, group, "edit")) return;
  const row = getCredential(Number(req.params.id));
  // Checked against the GROUP IN THE PATH, not only the id: an id from another
  // group would otherwise be deletable by anybody with write on this one.
  if (!row || row.group_path !== group) return void res.status(404).json({ error: "No such credential" });
  deleteCredential(row.id);
  res.json({ ok: true });
});

/**
 * Can it actually do the job?
 *
 * THE POINT OF THE WHOLE FEATURE. A credential that has never been asked
 * whether it can WRITE is the incident this was built for, waiting to happen:
 * the deploy key was read-only from the day it was made, and nothing noticed
 * for months because every other git operation here is a read.
 *
 * The repository defaults to the one this group's git watch already points at,
 * so the usual case needs no typing and cannot be tested against the wrong
 * remote by accident.
 */
router.post("/:group/:id/test", async (req: Request, res: Response) => {
  const group = decodeURIComponent(req.params.group ?? "");
  if (!allowed(req, res, group, "edit")) return;
  const row = getCredential(Number(req.params.id));
  if (!row || row.group_path !== group) return void res.status(404).json({ error: "No such credential" });

  let repo = String(req.body?.repoUrl ?? "").trim();
  let branch = String(req.body?.branch ?? "").trim();
  if (!repo) {
    const db = DatabaseService.getInstance().getDb();
    const watch = db
      .prepare(`SELECT repo_url, branch FROM git_watches WHERE group_path = ? ORDER BY id ASC LIMIT 1`)
      .get(group) as { repo_url: string; branch: string } | undefined;
    repo = watch?.repo_url ?? "";
    branch = branch || watch?.branch || "main";
  }
  if (!repo) {
    return void res.status(400).json({
      error:
        "No repository to test against. Add a git watch to this group, or pass repoUrl.",
    });
  }

  try {
    const result = await testCredential(row, repo, branch || "main");
    recordTest(row.id, result);
    res.json({ credential: toView(getCredential(row.id)!), test: result, repoUrl: repo, branch });
  } catch (e) {
    logger.error(`test git credential failed: ${e}`);
    res.status(500).json({ error: "The test could not be run" });
  }
});

export default router;
