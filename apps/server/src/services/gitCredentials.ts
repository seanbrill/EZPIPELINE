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
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  /** The half that goes on the forge. Null for a key that was pasted in: only its private half was ever given. */
  public_key: string | null;
  /** 1 when pipelines and watches in this group read with it. See "Reading with one" below. */
  use_for_reads: number;
}

/** What the browser is allowed to see: everything except the secret. */
export interface GitCredentialView {
  id: number;
  group: string;
  name: string;
  kind: CredentialKind;
  username: string | null;
  createdAt: string;
  /** Not a secret: it is the half that is handed to the forge. */
  publicKey: string | null;
  useForReads: boolean;
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
    publicKey: r.public_key ?? null,
    useForReads: r.use_for_reads === 1,
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
  publicKey?: string | null;
  useForReads?: boolean;
}): GitCredentialView {
  const db = DatabaseService.getInstance().getDb();
  const info = db
    .prepare(
      `INSERT INTO git_credentials
         (group_path, name, kind, secret, username, created_by, public_key, use_for_reads)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.group,
      input.name,
      input.kind,
      encryptCredential(input.secret),
      input.username?.trim() || null,
      input.createdBy ?? null,
      input.publicKey?.trim() || null,
      // Only a key can be read with: see readCredentialForGroup.
      input.useForReads && input.kind === "ssh_key" ? 1 : 0
    );
  return toView(getCredential(Number(info.lastInsertRowid))!);
}

export function deleteCredential(id: number): boolean {
  const db = DatabaseService.getInstance().getDb();
  const gone = db.prepare(`DELETE FROM git_credentials WHERE id = ?`).run(id).changes > 0;
  // The copy that steps were reading with goes too, or a deleted credential
  // would carry on working until the server next restarted.
  forgetKeyFiles(id);
  return gone;
}

// ── Making one ──────────────────────────────────────────────────────────────
//
// THE REQUEST THIS ANSWERS. Giving EZPIPELINE a second repository to deploy
// meant `docker exec ... ssh-keygen` into the data volume, a second command to
// print the public half, an edit to this project's own Dockerfile so that ssh
// knew which key went with which repository, and a rebuild. "Does ezpipeline
// have a way to do this without running a command?" It did not.
//
// So the key is made HERE, by the same ssh-keygen an operator would have run,
// and the private half goes straight into the encrypted column. It is never
// shown, never written to the data volume, and never leaves this process. The
// public half is kept and shown, because that is the half a person needs.

/**
 * A new ed25519 key pair, in the form OpenSSH writes and reads.
 *
 * ssh-keygen and not node:crypto on purpose. Node can make the key, but it
 * exports PKCS#8, and the format `ssh -i` wants is OpenSSH's own. Converting
 * by hand is a page of code about byte layouts whose only failure message is
 * "invalid format". The program that defines the format is already in the
 * image, because the instructions this replaces called it.
 *
 * execFile with an argument list, so the comment (which comes from a form) is
 * one argument and never a piece of a command line.
 */
export async function generateKeyPair(comment: string): Promise<{ privateKey: string; publicKey: string }> {
  const dir = mkdtempSync(join(tmpdir(), "ezp-keygen-"));
  try {
    const file = join(dir, "id");
    // A comment is one line of printable text. Anything else is dropped rather
    // than refused: it is a label on a key, not a thing worth an error.
    const label = comment.replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 120) || "ezpipeline";
    // -N "" is "no passphrase". Nobody is there to type one when a pipeline
    // runs at three in the morning, and what protects this key at rest is the
    // encrypted column, not a passphrase that would have to be stored beside it.
    await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", label, "-f", file], {
      timeout: GIT_TIMEOUT_MS,
    });
    return {
      privateKey: readFileSync(file, "utf8"),
      publicKey: readFileSync(`${file}.pub`, "utf8").trim(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Make a key and store it for a group, already switched on for reading: that is what a new deploy key is for. */
export async function generateSshCredential(input: {
  group: string;
  name: string;
  createdBy?: number | null;
}): Promise<GitCredentialView> {
  const pair = await generateKeyPair(`ezpipeline: ${input.name}`);
  return createCredential({
    group: input.group,
    name: input.name,
    kind: "ssh_key",
    secret: pair.privateKey,
    publicKey: pair.publicKey,
    useForReads: true,
    createdBy: input.createdBy ?? null,
  });
}

// ── Reading with one ────────────────────────────────────────────────────────
//
// Until this section existed, a stored credential was used by exactly one
// thing: the merge action. The two things that READ a repository on every
// push, a pipeline's own `git clone` and a watch's `git ls-remote`, went to
// whatever key the container had, chosen by /root/.ssh/config. One key, baked
// into the image, a deploy key of one repository. A second repository needed
// a second `Host` block in the Dockerfile and a rebuild.
//
// A credential marked for reading replaces that. Pipelines in its group, and
// in the folders inside it, are given GIT_SSH_COMMAND naming this key, and so
// is every watch there.
//
// IT IS A SWITCH PER CREDENTIAL, AND IT IS OFF UNLESS SOMEBODY TURNS IT ON.
// Reading with a key means every step of every pipeline in the group can use
// it. That is right for a read-only deploy key and wrong for the key somebody
// stored so that the merge action could PUSH: the reason that key lives in
// the store is that the clone, which runs on every commit, should never hold
// something that can change the repository.

/** Where a key every pipeline reads with is stored. Only an admin may manage it. */
export const INSTANCE_GROUP = "*";

/** A group and the groups it sits inside, nearest first: "A/B/C" gives A/B/C, A/B, A. */
export function groupAndAncestors(group: string): string[] {
  const parts = group.split(/[\\/]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).join("/"));
  return out;
}

/**
 * Which of a group's reading keys to use: one PROVEN to read, then one nobody
 * has tested, then one that was tested and could not. The same three ranks as
 * credentialForGroup and for the same reason, with `read` where that has
 * `write`. Newest test first within a rank, then newest row.
 */
export function rankForReading<T extends Pick<GitCredentialRow, "id" | "test_can_read" | "last_tested_at">>(rows: T[]): T[] {
  const rank = (r: T) => (r.test_can_read === 1 ? 0 : r.test_can_read === null ? 1 : 2);
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.last_tested_at ?? "").localeCompare(a.last_tested_at ?? "") ||
      b.id - a.id
  );
}

/**
 * The key a pipeline or a watch in this group reads with, or null for "the
 * host's own", which is what every instance did before this existed.
 *
 * THE NEAREST GROUP THAT HAS ONE WINS, walking outward. A key stored on
 * `FileFreak` covers `FileFreak/Dev` and `FileFreak/Dev/Infra`, the way a
 * variable set on a group reaches the pipelines filed under it. That is the
 * opposite of credentialForGroup, which matches one group exactly, and the
 * difference is deliberate: a merge is a write and should be granted where it
 * is named, while one repository's read key is wanted by every pipeline that
 * builds it, and storing three copies is three things to rotate.
 */
export function readCredentialForGroup(group: string): GitCredentialRow | null {
  const db = DatabaseService.getInstance().getDb();
  const find = db.prepare(
    `SELECT * FROM git_credentials WHERE group_path = ? AND kind = 'ssh_key' AND use_for_reads = 1`
  );
  // Then the instance-wide key ("*"), made in setup before any group existed.
  for (const g of [...groupAndAncestors(group), INSTANCE_GROUP]) {
    const rows = find.all(g) as GitCredentialRow[];
    if (rows.length > 0) return rankForReading(rows)[0] ?? null;
  }
  return null;
}

/**
 * The ssh command git is told to use for one key.
 *
 * -F /dev/null IS THE POINT. Without it ssh also reads /root/.ssh/config,
 * whose `Host github.com` block names the container's own key. ssh then has
 * two identities for one host, GitHub accepts whichever it recognises first,
 * and a deploy key is tied to ONE repository: authenticate as the wrong one
 * and the answer is "Repository not found" while the right key sits unused.
 * With no config file there is one identity, and it is this one.
 *
 * The known hosts file is not affected: that is read from ~/.ssh/known_hosts
 * whatever -F says, so the host keys the image verified are still what a
 * connection is checked against. accept-new is for a forge this server has
 * never spoken to, and it still refuses a host whose key has CHANGED.
 */
export function sshCommandFor(keyPath: string): string {
  return (
    `ssh -F /dev/null -i '${keyPath}' -o IdentitiesOnly=yes -o BatchMode=yes ` +
    `-o StrictHostKeyChecking=accept-new`
  );
}

/**
 * Where the keys that steps read with are written.
 *
 * In the container's own temporary directory and NOT the data volume: the
 * volume is where the encrypted copy lives, and a plaintext copy beside it
 * would make the encryption decoration. This directory is lost when the
 * container is recreated, and each file is written again the first time it is
 * wanted.
 *
 * A step is a shell script running as the same user as this server, so a step
 * that goes looking can read any file here, as it always could read the key
 * in /app/apps/server/data/ssh. What changes is what a step is HANDED: only
 * the key of its own group.
 */
const READ_KEY_DIR = join(tmpdir(), "ezp-read-keys");

/** Remove every copy of one credential's key that steps could be reading with. */
export function forgetKeyFiles(id: number): void {
  try {
    for (const name of readdirSync(READ_KEY_DIR)) {
      if (name.startsWith(`${id}-`)) rmSync(join(READ_KEY_DIR, name), { force: true });
    }
  } catch {
    // The directory is made the first time a key is wanted. Not there yet
    // means there is nothing to forget.
  }
}

/** The path of this credential's key, written if it is not there. Null when it cannot be decrypted. */
export function readKeyFile(cred: GitCredentialRow): string | null {
  // Named for the STORED form, so a credential that is replaced gets a new
  // file and the old one is not read by mistake, and so that finding the file
  // already there costs no decryption.
  const mark = createHash("sha256").update(cred.secret).digest("hex").slice(0, 16);
  const file = join(READ_KEY_DIR, `${cred.id}-${mark}`);
  if (existsSync(file)) return file;

  const secret = decryptCredential(cred.secret);
  if (secret === null) return null;
  mkdirSync(READ_KEY_DIR, { recursive: true, mode: 0o700 });
  chmodSync(READ_KEY_DIR, 0o700);
  forgetKeyFiles(cred.id);
  // 0600 twice, as gitWith does: the mode passed to writeFileSync is masked
  // by the umask, and ssh refuses a key anybody else could read.
  writeFileSync(file, keyBytes(secret), { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export interface ReadAccess {
  /** GIT_SSH_COMMAND for this group, or null to leave git to the host's own configuration. */
  command: string | null;
  /** Which credential that is, so a build log can say so. */
  credential: { name: string; group: string } | null;
  /** Set when a credential was meant to be used and could not be. */
  problem: string | null;
}

/**
 * What git should read with for a pipeline or a watch in this group.
 *
 * Never throws. A run that cannot work out its key should still start and say
 * why in its own log, where the person looking at a failed clone will read
 * it, rather than die before the first step with a database error.
 */
export function readAccessForGroup(group: string | null | undefined): ReadAccess {
  const none: ReadAccess = { command: null, credential: null, problem: null };
  try {
    const cred = readCredentialForGroup(group || INSTANCE_GROUP);
    if (!cred) return none;
    const named = { name: cred.name, group: cred.group_path };
    const file = readKeyFile(cred);
    if (!file) {
      return {
        command: null,
        credential: named,
        problem:
          `the credential "${cred.name}" on ${cred.group_path} could not be decrypted, so git is using ` +
          `the host's own key. The usual cause is a changed JWT_SECRET; delete it and make it again.`,
      };
    }
    return { command: sshCommandFor(file), credential: named, problem: null };
  } catch (e) {
    return { command: null, credential: null, problem: `could not look up this group's git credential: ${e}` };
  }
}

/** Switch reading with a credential on or off. Only a key can be read with. */
export function setUseForReads(id: number, on: boolean): GitCredentialView | null {
  const row = getCredential(id);
  if (!row) return null;
  if (on && row.kind !== "ssh_key") {
    throw new Error("Only an SSH key can be read with. A token is used by the merge action alone.");
  }
  const db = DatabaseService.getInstance().getDb();
  db.prepare(`UPDATE git_credentials SET use_for_reads = ? WHERE id = ?`).run(on ? 1 : 0, id);
  if (!on) forgetKeyFiles(id);
  return toView(getCredential(id)!);
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
