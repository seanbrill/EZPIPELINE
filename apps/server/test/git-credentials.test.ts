// A stored git credential, and the rule for which one a group's writes use.
//
// THE INCIDENT. "Promote to production" failed with "the key you are
// authenticating with has been marked as read only", and the operator's reply
// was the finding: "not even sure how the git credentials were set for
// ezpipeline". The credential was an SSH key in a Docker volume, named on no
// screen, with its permissions living on GitHub.
//
// It had been read-only since the day it was made and nothing noticed, because
// every git operation this product performs is a READ - ls-remote for a watch,
// fetch for a checkout, fetch for the merge's own FETCH_HEAD. The merge is the
// first WRITE it has ever attempted, so it was always going to fail the first
// time somebody pressed the button.
//
// Two properties are worth locking down, and they are the two this file tests:
//
//   THE SECRET SURVIVES A ROUND TRIP AND IS NOT READABLE IN BETWEEN. A private
//   key is one newline away from being rejected by OpenSSH with "invalid
//   format", so the exact bytes matter, and a credential sitting in plaintext
//   in app.db is the thing being fixed rather than moved.
//
//   A PROVEN CREDENTIAL BEATS AN UNPROVEN ONE. With two rows and no rule, the
//   one that happens to sort first decides whether a merge works - which is
//   the incident again, with more steps.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

process.env.JWT_SECRET ??= "test-secret-long-enough-to-pass-the-boot-check-0123456789";

const { encryptCredential, decryptCredential } = await import(
  "../src/services/gitCredentials.js"
);

describe("credential encryption", () => {
  test("a private key survives exactly, newline and all", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----\n";
    assert.equal(decryptCredential(encryptCredential(key)), key);
  });

  test("a key with no trailing newline is not given one in transit", () => {
    // gitWith adds it when writing the file, deliberately and in one place.
    // If this layer added one too, the two would be hard to tell apart the day
    // one of them stopped.
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
    assert.equal(decryptCredential(encryptCredential(key)), key);
  });

  test("a token survives", () => {
    const t = "github_pat_11ABCDE_0123456789abcdefghijklmnopqrstuvwxyz";
    assert.equal(decryptCredential(encryptCredential(t)), t);
  });

  test("the stored form does not contain the secret", () => {
    const secret = "ghp_verydistinctivevaluethatmustnotappear";
    const stored = encryptCredential(secret);
    assert.ok(!stored.includes(secret), "the ciphertext must not contain the plaintext");
    assert.ok(stored.startsWith("gitcred:v1:"), "and must be recognisable as ours");
  });

  test("two encryptions of the same secret differ", () => {
    // A fresh IV each time. Without one, two identical secrets are visibly
    // identical in the database, which is a leak on its own.
    const a = encryptCredential("same");
    const b = encryptCredential("same");
    assert.notEqual(a, b);
    assert.equal(decryptCredential(a), decryptCredential(b));
  });

  test("a tampered value decrypts to null rather than to garbage", () => {
    // GCM's tag is what makes this tamper-EVIDENT rather than merely
    // unreadable. Flipping a byte of the body must fail the tag check.
    const stored = encryptCredential("secret");
    const parts = stored.slice("gitcred:v1:".length).split(":");
    const body = Buffer.from(parts[2]!, "base64");
    body[0] = body[0]! ^ 0xff;
    const tampered = `gitcred:v1:${parts[0]}:${parts[1]}:${body.toString("base64")}`;
    assert.equal(decryptCredential(tampered), null);
  });

  test("something that was never encrypted by us is null, not a throw", () => {
    // A plaintext value from before this existed, or a changed JWT_SECRET.
    // Both are reported as absent so the operator is told to re-enter it,
    // rather than watching git fail with a crypto error.
    assert.equal(decryptCredential("plain text"), null);
    assert.equal(decryptCredential(""), null);
    assert.equal(decryptCredential("gitcred:v1:not:valid:base64!!"), null);
  });

  test("an empty secret encrypts to empty rather than to a valid blob", () => {
    assert.equal(encryptCredential(""), "");
  });
});

// ── Which credential a write uses ──────────────────────────────────────────
//
// THE ORDER IS A BUG I WROTE AND CAUGHT BY MEASURING IT. The obvious
// `ORDER BY (test_can_write = 1) DESC` gives 1, 0 and NULL, and SQLite sorts
// NULL below 0 - so a credential PROVEN read-only outranked every credential
// whose answer nobody had. That is the original incident with more steps: the
// key that definitely cannot write, chosen over one that might.
//
// The second attempt, adding `(test_can_write IS NULL) DESC` after it, changed
// nothing at all: the first key has already separated the rows and the second
// is never consulted. Both were run in sqlite before this test existed, which
// is the only reason the second one did not ship.
//
// The ORDER BY is lifted out of the shipped source rather than restated, so a
// test cannot pass against an expression that is no longer the one running.

const SRC = readFileSync(new URL("../src/services/gitCredentials.ts", import.meta.url), "utf8");
const ORDER = /ORDER BY (CASE[\s\S]*?END ASC)/.exec(SRC);

describe("credentialForGroup ordering", () => {
  test("proven beats unknown, and unknown beats known-broken", () => {
    assert.ok(ORDER, "the ORDER BY is gone from credentialForGroup, or its shape changed");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE git_credentials (name TEXT, test_can_write INTEGER)");
    const ins = db.prepare("INSERT INTO git_credentials VALUES (?,?)");
    // Inserted worst-first, so a query that simply preserves insertion order
    // fails rather than passing by luck.
    ins.run("known-read-only", 0);
    ins.run("never-tested", null);
    ins.run("proven-writable", 1);

    const got = db
      .prepare(`SELECT name FROM git_credentials ORDER BY ${ORDER[1]}`)
      .all()
      .map((r: any) => r.name);

    assert.deepEqual(got, ["proven-writable", "never-tested", "known-read-only"]);
  });

  test("a read-only credential never wins over an untested one", () => {
    assert.ok(ORDER);
    const db = new Database(":memory:");
    db.exec("CREATE TABLE git_credentials (name TEXT, test_can_write INTEGER)");
    const ins = db.prepare("INSERT INTO git_credentials VALUES (?,?)");
    ins.run("read-only", 0);
    ins.run("untested", null);
    const first = db
      .prepare(`SELECT name FROM git_credentials ORDER BY ${ORDER[1]} LIMIT 1`)
      .get() as { name: string };
    assert.equal(first.name, "untested", "the one that might work beats the one that cannot");
  });
});

// ── Making a key here, and reading with one ────────────────────────────────
//
// THE REQUEST. Setting up a second repository meant `docker exec ... ssh-keygen`
// into the data volume, a second command to print the public half, an edit to
// this project's own Dockerfile so ssh knew which key went with which
// repository, and a rebuild. "Does ezpipeline have a way to do this without
// running a command?"
//
// Four properties are worth locking down:
//
//   THE KEY THAT IS MADE IS ONE OPENSSH ACCEPTS, AND ITS TWO HALVES MATCH. A
//   public half that does not belong to the stored private half is a deploy
//   key that authenticates as nobody, and the error is "Permission denied".
//
//   GIT IS HANDED ONE IDENTITY. The container's own ssh config names another
//   key for the same host. Offered both, GitHub accepts whichever it knows
//   first and a deploy key belongs to ONE repository.
//
//   THE NEAREST GROUP WINS, AND NOTHING IS READ WITH UNLESS SOMEBODY SAID SO.
//   Every row that existed before this is a key stored for the merge action,
//   and some of those can push.
//
//   A KEY THAT IS SWITCHED OFF OR DELETED STOPS BEING READABLE BY A STEP.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync as writeFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  forgetKeyFiles,
  generateKeyPair,
  groupAndAncestors,
  rankForReading,
  readKeyFile,
  sshCommandFor,
} = await import("../src/services/gitCredentials.js");

/** A row as the table holds one, for the functions that take a row and never ask the database. */
const row = (id: number, secret: string) => ({
  id,
  group_path: "G",
  name: `key ${id}`,
  kind: "ssh_key" as const,
  secret: encryptCredential(secret),
  username: null,
  last_tested_at: null,
  test_identity: null,
  test_can_read: null,
  test_can_write: null,
  test_error: null,
  created_at: "",
  public_key: null,
  use_for_reads: 1,
});

describe("making a key", () => {
  test("the two halves belong to each other, and OpenSSH reads the private one", async () => {
    const pair = await generateKeyPair("ezpipeline: a test key");
    assert.match(pair.privateKey, /^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
    assert.ok(pair.privateKey.endsWith("-----END OPENSSH PRIVATE KEY-----\n"), "the trailing newline OpenSSH insists on");
    assert.match(pair.publicKey, /^ssh-ed25519 AAAA[A-Za-z0-9+/=]+ ezpipeline: a test key$/);

    // Ask ssh-keygen what public key this private key has. That is the
    // program whose opinion matters, and it refuses a key it cannot parse.
    const dir = mkdtempSync(join(tmpdir(), "ezp-test-"));
    try {
      const file = join(dir, "id");
      writeFile(file, pair.privateKey, { mode: 0o600 });
      const derived = execFileSync("ssh-keygen", ["-y", "-f", file], { encoding: "utf8" }).trim();
      assert.equal(derived.split(" ")[1], pair.publicKey.split(" ")[1], "the public half is not this private key's");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two keys are two keys", async () => {
    const [a, b] = await Promise.all([generateKeyPair("a"), generateKeyPair("b")]);
    assert.notEqual(a.privateKey, b.privateKey);
    assert.notEqual(a.publicKey.split(" ")[1], b.publicKey.split(" ")[1]);
  });

  test("a name from a form is a label, never part of a command", async () => {
    const marker = join(tmpdir(), `ezp-injected-${process.pid}`);
    rmSync(marker, { force: true });
    const pair = await generateKeyPair(`x"; touch ${marker}; echo "\n$(touch ${marker})\`touch ${marker}\``);
    assert.ok(!existsSync(marker), "the name was run as a command");
    assert.match(pair.publicKey, /^ssh-ed25519 /);
    // One line: a newline in a public key file is a second, unparseable key.
    assert.equal(pair.publicKey.split("\n").length, 1);
  });
});

describe("which key a group reads with", () => {
  test("a group, then the groups it sits inside, nearest first", () => {
    assert.deepEqual(groupAndAncestors("FileFreak/Dev/Infra"), ["FileFreak/Dev/Infra", "FileFreak/Dev", "FileFreak"]);
    assert.deepEqual(groupAndAncestors("Notch.fm"), ["Notch.fm"]);
    assert.deepEqual(groupAndAncestors(""), []);
    // A pipeline's group is a path made by the operating system, and a group
    // typed into a form may have a slash too many.
    assert.deepEqual(groupAndAncestors("A\\B"), ["A/B", "A"]);
    assert.deepEqual(groupAndAncestors("/A//B/"), ["A/B", "A"]);
  });

  test("a key proven to read beats one nobody has tested, which beats one that could not", () => {
    const rows = [
      { id: 1, test_can_read: 0, last_tested_at: "2026-01-03" },
      { id: 2, test_can_read: null, last_tested_at: null },
      { id: 3, test_can_read: 1, last_tested_at: "2026-01-01" },
      { id: 4, test_can_read: 1, last_tested_at: "2026-01-02" },
    ];
    assert.deepEqual(rankForReading(rows).map((r: { id: number }) => r.id), [4, 3, 2, 1]);
    // And it sorts a copy: the rows it was given are whoever's they were.
    assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4]);
  });

  test("only a key that was switched on is read with, and none that existed before is", () => {
    // The table as migration 011 makes it, then 012's two columns, both lifted
    // from the shipped source so this cannot pass against SQL that is not the
    // SQL running.
    const m11 = readFileSync(new URL("../src/migrations/011_git_credentials.ts", import.meta.url), "utf8");
    const m12 = readFileSync(new URL("../src/migrations/012_git_credential_reads.ts", import.meta.url), "utf8");
    const create = /CREATE TABLE git_credentials \([\s\S]*?\n      \)/.exec(m11);
    const alters = [...m12.matchAll(/ALTER TABLE git_credentials ADD COLUMN [^`]+/g)].map((m) => m[0]);
    const find = /SELECT \* FROM git_credentials WHERE group_path = \? AND kind = 'ssh_key' AND use_for_reads = 1/.exec(SRC);
    assert.ok(create, "011's CREATE TABLE was not found");
    assert.equal(alters.length, 2, "012 should add exactly two columns");
    assert.ok(find, "readCredentialForGroup's query is gone, or its shape changed");

    const db = new Database(":memory:");
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    db.exec(create[0]);
    // A credential stored before the upgrade, for the merge action.
    db.prepare("INSERT INTO git_credentials (group_path, name, kind, secret) VALUES ('Notch.fm', 'old', 'ssh_key', 'x')").run();
    for (const alter of alters) db.exec(alter);

    const reads = (group: string) => db.prepare(find[0]).all(group).map((r: any) => r.name);
    assert.deepEqual(reads("Notch.fm"), [], "a key that existed before the upgrade is being read with");

    db.prepare("INSERT INTO git_credentials (group_path, name, kind, secret, use_for_reads) VALUES ('FileFreak', 'on', 'ssh_key', 'x', 1)").run();
    db.prepare("INSERT INTO git_credentials (group_path, name, kind, secret, use_for_reads) VALUES ('FileFreak', 'off', 'ssh_key', 'x', 0)").run();
    db.prepare("INSERT INTO git_credentials (group_path, name, kind, secret, use_for_reads) VALUES ('FileFreak', 'a token', 'token', 'x', 1)").run();
    assert.deepEqual(reads("FileFreak"), ["on"]);
    // The nearest group that has one is found by walking outward, and a
    // folder inside FileFreak has none of its own.
    assert.deepEqual(groupAndAncestors("FileFreak/Dev/Infra").map(reads).find((r) => r.length > 0), ["on"]);
    // Another group's key is not found from here.
    assert.deepEqual(groupAndAncestors("Notch.fm/Dev").flatMap(reads), []);
  });
});

describe("the command git is given", () => {
  test("ssh is handed this key and no other, whatever its own config says", () => {
    const dir = mkdtempSync(join(tmpdir(), "ezp-test-"));
    try {
      const key = join(dir, "id");
      writeFile(key, "not a real key\n", { mode: 0o600 });
      const command = sshCommandFor(key);
      assert.ok(command.includes(" -F /dev/null "), "without -F /dev/null ssh also offers the key in its own config");

      // `ssh -G` prints the configuration ssh WOULD use and connects to
      // nothing. It is ssh's own answer, not a reading of the string above.
      const words = command.split(" ").slice(1).map((w) => w.replace(/^'|'$/g, ""));
      const said = execFileSync("ssh", [...words, "-G", "git@github.com"], { encoding: "utf8" });
      const identities = said.split("\n").filter((l) => l.startsWith("identityfile ")).map((l) => l.slice("identityfile ".length));
      assert.deepEqual(identities, [key], "ssh would offer more than the one key, or a different one");
      assert.match(said, /^identitiesonly yes$/m);
      assert.match(said, /^batchmode yes$/m);
      assert.match(said, /^stricthostkeychecking accept-new$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the copy a step reads with", () => {
  const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";

  test("it holds the key, nobody else can read it, and it is written once", () => {
    const cred = row(900001, KEY);
    try {
      const file = readKeyFile(cred);
      assert.ok(file, "a key that decrypts should have a file");
      // With the newline OpenSSH insists on, which the stored form did not have.
      assert.equal(readFileSync(file, "utf8"), `${KEY}\n`);
      assert.equal(statSync(file).mode & 0o777, 0o600, "ssh refuses a key that anybody else could read");
      assert.equal(readKeyFile(cred), file, "the same key should be the same file");
    } finally {
      forgetKeyFiles(900001);
    }
  });

  test("a replaced secret is a new file, and the old one is gone", () => {
    const before = readKeyFile(row(900002, KEY));
    const after = readKeyFile(row(900002, `${KEY}\nchanged`));
    try {
      assert.ok(before && after);
      assert.notEqual(before, after);
      assert.ok(!existsSync(before), "the old key is still on disk, where a step could read with it");
      assert.ok(existsSync(after));
    } finally {
      forgetKeyFiles(900002);
    }
  });

  test("forgetting a credential removes its file and nobody else's", () => {
    const mine = readKeyFile(row(900003, KEY));
    // 9000031 starts with the same digits. A prefix match without its
    // separator would take this one too.
    const other = readKeyFile(row(9000031, KEY));
    try {
      assert.ok(mine && other);
      forgetKeyFiles(900003);
      assert.ok(!existsSync(mine), "a deleted credential can still be read with");
      assert.ok(existsSync(other), "forgetting one credential removed another's key");
    } finally {
      forgetKeyFiles(900003);
      forgetKeyFiles(9000031);
    }
  });

  test("a credential that cannot be decrypted has no file, rather than a file of garbage", () => {
    const broken = { ...row(900004, KEY), secret: "gitcred:v1:AAAA:AAAA:AAAA" };
    assert.equal(readKeyFile(broken), null);
  });
});
