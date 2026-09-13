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
