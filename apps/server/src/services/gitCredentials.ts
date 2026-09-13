// The credential a git operation runs with, and whether it can do the job.
//
// THE INCIDENT. "Promote to production" failed with "the key you are
// authenticating with has been marked as read only", and the reply was the
// real finding: "not even sure how the git credentials were set for
// ezpipeline". There was nowhere to look. The credential was an SSH key in a
// Docker volume, named on no screen, and its permissions lived on GitHub.
//
// It had been read-only since the day it was made and nothing noticed, because
// every git operation this product performs is a READ - ls-remote for a watch,
// fetch for a checkout, fetch for the merge's own FETCH_HEAD. The merge is the
// first and only WRITE it has ever attempted, so it was always going to fail
// the first time somebody pressed the button.
//
// WHICH IS WHY test() IS THE POINT OF THIS FILE, not storage. A credential
// that has never been asked whether it can WRITE is the bug above, waiting.
// The test costs one ls-remote and one dry-run push, and the dry-run is the
// half that matters: it authenticates and negotiates refs with the server and
// changes nothing, which is exactly the question.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseService } from "./Database.js";
import { JWT_SECRET } from "../config/secret.js";
import Logger from "../controllers/Logger.js";

const run = promisify(execFile);

/** Long enough for a slow forge, short enough that a hung one is not forever. */
const GIT_TIMEOUT_MS = 20_000;

// ── At rest ─────────────────────────────────────────────────────────────────
//
// The same shape as services/mail/secrets.ts, and deliberately NOT the same
// key: the `info` string is what keeps two derived keys from colliding, and a
// mail password and a git deploy key have no business sharing one. See that
// file for why the material comes from JWT_SECRET at all - the short version
// is that nobody sets a second secret, and a feature that silently stops
// working because a new env var is missing is a feature that gets abandoned.
//
// ROTATING JWT_SECRET MAKES EVERY STORED CREDENTIAL UNREADABLE. That is why a
// decryption failure is reported as "absent, and here is why" rather than
// thrown: the operator is told to re-enter it instead of watching git fail
// with a crypto error.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "gitcred:v1:";

function key(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", JWT_SECRET, "ezpipeline-settings-salt", "git-credentials-v1", 32)
  );
}

export function encryptCredential(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${body.toString("base64")}`;
}

export function decryptCredential(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  try {
    const [ivB64, tagB64, bodyB64] = stored.slice(PREFIX.length).split(":");
    if (!ivB64 || !tagB64 || !bodyB64) return null;
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    Logger.getInstance().warn(
      "[git-credentials] a stored credential could not be decrypted. The usual cause " +
        "is a changed JWT_SECRET. Re-enter it on the group's credentials screen."
    );
    return null;
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────

export type CredentialKind = "ssh_key" | "token";

export interface GitCredentialRow {
  id: number;
  group_path: string;
  name: string;
  kind: CredentialKind;
  secret: string;
  username: string | null;
  last_tested_at: string | null;
  test_identity: string | null;
  test_can_read: number | null;
  test_can_write: number | null;
  test_error: string | null;
  created_at: string;
}

/** What the browser is allowed to see: everything except the secret. */
export interface GitCredentialView {
  id: number;
  group: string;
  name: string;
  kind: CredentialKind;
  username: string | null;
  createdAt: string;
  test: {
    at: string | null;
    identity: string | null;
    canRead: boolean | null;
    canWrite: boolean | null;
    error: string | null;
  };
}

export function toView(r: GitCredentialRow): GitCredentialView {
  return {
    id: r.id,
    group: r.group_path,
    name: r.name,
    kind: r.kind,
    username: r.username,
    createdAt: r.created_at,
    test: {
      at: r.last_tested_at,
      identity: r.test_identity,
      // NULL IS NOT FALSE. "Never tested" and "tested, cannot write" look the
      // same on a screen that collapses them, and the first is the state the
      // read-only key was in for its whole life.
      canRead: r.test_can_read === null ? null : r.test_can_read === 1,
      canWrite: r.test_can_write === null ? null : r.test_can_write === 1,
      error: r.test_error,
    },
  };
}

export function listCredentials(group: string): GitCredentialView[] {
  const db = DatabaseService.getInstance().getDb();
  const rows = db
    .prepare(`SELECT * FROM git_credentials WHERE group_path = ? ORDER BY name ASC`)
    .all(group) as GitCredentialRow[];
  return rows.map(toView);
}

export function getCredential(id: number): GitCredentialRow | null {
  const db = DatabaseService.getInstance().getDb();
  return (db.prepare(`SELECT * FROM git_credentials WHERE id = ?`).get(id) ??
    null) as GitCredentialRow | null;
}

/**
 * The credential a git operation in this group should use.
 *
 * PROVEN, THEN UNKNOWN, THEN KNOWN-BAD, and the middle rank is the one worth
 * spelling out. A credential we have tested and found read-only must sort
 * BELOW one nobody has tested: the untested one might work, and the tested one
 * definitely will not.
 *
 * AN EXPLICIT RANK, because the two obvious forms are both wrong and I checked
 * rather than reasoned. `ORDER BY (test_can_write = 1) DESC` yields 1, 0 and
 * NULL - and SQLite sorts NULL below 0, so a credential PROVEN not to work
 * outranks every credential whose answer we do not have. Adding
 * `(test_can_write IS NULL) DESC` after it changes nothing, because the first
 * key has already separated them and the second is never consulted. Measured
 * both, in sqlite, before writing this.
 *
 * Preferring a proven one at all is the point: with two rows and no rule, the
 * one that happens to sort first decides whether a merge works, which is the
 * incident this file exists for with more steps.
 */
export function credentialForGroup(group: string): GitCredentialRow | null {
  const db = DatabaseService.getInstance().getDb();
  return (db
    .prepare(
      `SELECT * FROM git_credentials
        WHERE group_path = ?
        ORDER BY CASE
                   WHEN test_can_write = 1 THEN 0
                   WHEN test_can_write IS NULL THEN 1
                   ELSE 2
                 END ASC,
                 last_tested_at DESC,
                 id DESC
        LIMIT 1`
    )
    .get(group) ?? null) as GitCredentialRow | null;
}

export function createCredential(input: {
  group: string;
  name: string;
  kind: CredentialKind;
  secret: string;
  username?: string | null;
  createdBy?: number | null;
}): GitCredentialView {
  const db = DatabaseService.getInstance().getDb();
  const info = db
    .prepare(
      `INSERT INTO git_credentials (group_path, name, kind, secret, username, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.group,
      input.name,
      input.kind,
      encryptCredential(input.secret),
      input.username?.trim() || null,
      input.createdBy ?? null
    );
  return toView(getCredential(Number(info.lastInsertRowid))!);
}

export function deleteCredential(id: number): boolean {
  const db = DatabaseService.getInstance().getDb();
  return db.prepare(`DELETE FROM git_credentials WHERE id = ?`).run(id).changes > 0;
}

// ── Using one ───────────────────────────────────────────────────────────────

/**
 * Run a git command as this credential.
 *
 * The secret reaches git through the ENVIRONMENT and a file mode 0600 in a
 * temporary directory, never through the command line: an argument is visible
 * in `ps` to every process on the box, and a URL with a token in it ends up in
 * git's own error messages and in this server's logs.
 *
 * A null credential is a supported state, not an error. It means "use whatever
 * the host has", which is what every existing instance does today - so adding
 * this feature cannot break one that was working.
 *
 * Both paths set GIT_TERMINAL_PROMPT=0. A background poller that stops to ask
 * for a password hangs forever, and the operator sees a watch that is simply
 * never checking anything.
 */
export async function gitWith(
  cred: GitCredentialRow | null,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
  };
  let dir: string | null = null;

  try {
    const secret = cred ? decryptCredential(cred.secret) : null;
    if (cred && secret === null) {
      throw new Error(
        `the credential "${cred.name}" could not be decrypted. The usual cause is a ` +
          `changed JWT_SECRET; re-enter it on the ${cred.group_path} credentials screen.`
      );
    }

    if (cred && secret) {
      dir = mkdtempSync(join(tmpdir(), "ezp-cred-"));
      if (cred.kind === "ssh_key") {
        const keyPath = join(dir, "id");
        writeFileSync(keyPath, keyBytes(secret), { mode: 0o600 });
        chmodSync(keyPath, 0o600);
        // QUOTED: GIT_SSH_COMMAND is parsed as a shell word list and a temp
        // path is not ours to assume is space-free.
        //
        // accept-new rather than the container's `StrictHostKeyChecking yes`:
        // a credential may point at a forge this server has never spoken to,
        // and `yes` with no known_hosts entry fails with "Host key
        // verification failed", which reads as a broken credential. accept-new
        // still refuses a host whose key has CHANGED, which is the attack the
        // setting is actually for.
        env.GIT_SSH_COMMAND =
          `ssh -i '${keyPath}' -o IdentitiesOnly=yes -o BatchMode=yes ` +
          `-o StrictHostKeyChecking=accept-new`;
      } else {
        // AN ASKPASS SCRIPT, not a token in the URL. git runs it and reads one
        // line of stdout, so the secret never appears in a process list, in a
        // remote URL, or in the text of an error - and git quotes those URLs
        // back at you in almost every failure it reports.
        const tokPath = join(dir, "tok");
        const ask = join(dir, "askpass.sh");
        const user = (cred.username?.trim() || "x-access-token").replace(/'/g, "");
        writeFileSync(tokPath, secret, { mode: 0o600 });
        writeFileSync(
          ask,
          `#!/bin/sh\ncase "$1" in\n  *[Uu]sername*) printf '%s' '${user}' ;;\n` +
            `  *) cat '${tokPath}' ;;\nesac\n`,
          { mode: 0o700 }
        );
        chmodSync(ask, 0o700);
        env.GIT_ASKPASS = ask;
      }
    }

    return await run("git", args, { env, cwd: opts.cwd, timeout: GIT_TIMEOUT_MS });
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A private key as OpenSSH will accept it.
 *
 * The trailing newline is not cosmetic: OpenSSH rejects a key without one and
 * says "invalid format", which sends somebody looking for a corrupted key
 * rather than a missing character. Paste boxes strip it constantly.
 */
function keyBytes(secret: string): string {
  return secret.endsWith("\n") ? secret : `${secret}\n`;
}

// ── Testing one ─────────────────────────────────────────────────────────────

export interface CredentialTest {
  identity: string | null;
  canRead: boolean;
  canWrite: boolean;
  error: string | null;
}

/**
 * Can this credential read the repository, and can it WRITE to it?
 *
 * THE WRITE HALF IS THE POINT, and it is the cheap part: a `--dry-run` push
 * authenticates and negotiates refs with the server and then updates nothing.
 * It is the only way to learn what a credential is allowed to do without doing
 * it, and asking once is what turns this incident from a thing that happens
 * into a thing that is known.
 *
 * Safe against production twice over: the ref pushed is the one just fetched,
 * at the sha it already has, so even a real push would be a no-op - and
 * --dry-run means it is not a real push.
 */
export async function testCredential(
  cred: GitCredentialRow,
  repoUrl: string,
  branch = "main"
): Promise<CredentialTest> {
  const out: CredentialTest = { identity: null, canRead: false, canWrite: false, error: null };
  const dir = mkdtempSync(join(tmpdir(), "ezp-credtest-"));

  try {
    // WHO DOES THE FORGE THINK THIS IS. GitHub answers "Hi seanbrill!" for a
    // user key and "Hi seanbrill/notch.fm!" for a deploy key - it names a
    // REPOSITORY - and that one line is what identified the incident this file
    // exists for. Worth showing beside the credential, because it is the
    // difference between "my key" and "a key scoped to one repo whose
    // permissions live somewhere else entirely".
    //
    // `ssh -T` exits non-zero by design (there is no shell), so the greeting
    // arrives as a failure and the text is the answer.
    if (cred.kind === "ssh_key" && /(^git@|^ssh:\/\/)/.test(repoUrl)) {
      const host = repoUrl.replace(/^ssh:\/\//, "").split(":")[0]?.split("/")[0] ?? "";
      const secret = decryptCredential(cred.secret);
      if (host && secret) {
        const keyPath = join(dir, "probe-id");
        writeFileSync(keyPath, keyBytes(secret), { mode: 0o600 });
        chmodSync(keyPath, 0o600);
        try {
          // -i ON THE COMMAND, not GIT_SSH_COMMAND: ssh does not read that
          // variable. A first draft set it and probed with whatever key the
          // host happened to have, which would have reported the wrong
          // identity with complete confidence.
          const r = await run(
            "ssh",
            ["-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
             "-o", "StrictHostKeyChecking=accept-new", "-T", host],
            { timeout: GIT_TIMEOUT_MS }
          );
          out.identity = r.stdout.trim().split("\n")[0] ?? null;
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string };
          const said = String((err.stdout ?? "") + (err.stderr ?? "")).trim().split("\n")[0];
          if (said && /^Hi /.test(said)) out.identity = said;
        }
      }
    }

    await gitWith(cred, ["init", "--quiet", dir]);
    await gitWith(cred, ["-C", dir, "remote", "add", "origin", repoUrl]);
    await gitWith(cred, ["-C", dir, "fetch", "--quiet", "--depth", "1", "origin", branch]);
    out.canRead = true;

    try {
      await gitWith(cred, [
        "-C", dir, "push", "--dry-run", "origin", `FETCH_HEAD:refs/heads/${branch}`,
      ]);
      out.canWrite = true;
    } catch (e: unknown) {
      const err = e as { stderr?: string; message?: string };
      const said = String(err.stderr || err.message || "").trim();
      out.canWrite = false;
      // SAY WHICH REFUSAL IT WAS. "read only" has a different fix from "no
      // such repository", and the operator has to know which one they have -
      // the read-only case in particular, because a GitHub deploy key cannot
      // be edited after it is added and nobody guesses that.
      out.error = /read only/i.test(said)
        ? "The remote accepts this credential but marks it READ ONLY. On GitHub a " +
          "deploy key cannot be changed after it is added: delete it and add it again " +
          "with “Allow write access” ticked."
        : said.split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 300);
    }
    return out;
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    const said = String(err.stderr || err.message || e).trim();
    out.error = (said.split("\n")[0] ?? "").slice(0, 300);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Store what a test found, so the list can show it without re-running one. */
export function recordTest(id: number, t: CredentialTest): void {
  const db = DatabaseService.getInstance().getDb();
  db.prepare(
    `UPDATE git_credentials
        SET last_tested_at = ?, test_identity = ?, test_can_read = ?, test_can_write = ?, test_error = ?
      WHERE id = ?`
  ).run(new Date().toISOString(), t.identity, t.canRead ? 1 : 0, t.canWrite ? 1 : 0, t.error, id);
}
