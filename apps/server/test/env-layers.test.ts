// The .env reading and writing behind the Environment tabs: secrets, markers, and leaving the rest of a file alone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEnv, writeEnv, deleteEnv, resourcePath, SECRET_KEY } from "../src/services/EnvLayers.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ezp-env-")), ".env");

describe("readEnv", () => {
  test("values, quotes, export, comments and the secret rule", () => {
    const f = tmp();
    fs.writeFileSync(f, ['# a comment', 'export NODE_ENV=production', 'APP_URL="https://x.test/a b"', "SINGLE='q'", 'API_TOKEN=abc # trailing', '# @secret', 'REGION=eu-west', 'NOEQ', ''].join("\n"));
    assert.deepEqual(readEnv(f), [
      { key: "NODE_ENV", value: "production", secret: false },
      { key: "APP_URL", value: "https://x.test/a b", secret: false },
      { key: "SINGLE", value: "q", secret: false },
      { key: "API_TOKEN", value: "abc", secret: true },
      { key: "REGION", value: "eu-west", secret: true },
    ]);
  });

  test("a missing file is empty", () => assert.deepEqual(readEnv("/nonexistent/.env"), []));

  test("secret-looking names", () => {
    for (const k of ["AZURE_CLIENT_SECRET", "DB_PASSWORD", "GITHUB_TOKEN", "SSH_KEY", "SENTRY_DSN", "SLACK_WEBHOOK", "DATABASE_URL"]) assert.ok(SECRET_KEY.test(k), k);
    for (const k of ["NODE_ENV", "APP_URL", "REGION", "KEYBOARD"]) assert.ok(!SECRET_KEY.test(k), k);
  });
});

describe("writeEnv / deleteEnv", () => {
  test("adds, updates in place, keeps other lines and comments", () => {
    const f = tmp();
    fs.writeFileSync(f, "# keep me\nA=1\nB=2\n");
    writeEnv(f, "B", "two words", false);
    writeEnv(f, "C", "3", false);
    assert.equal(fs.readFileSync(f, "utf8"), '# keep me\nA=1\nB="two words"\nC=3\n');
  });

  test("a marker is added for a secret that does not look like one, and removed when it is no longer secret", () => {
    const f = tmp();
    writeEnv(f, "REGION", "eu", true);
    assert.equal(fs.readFileSync(f, "utf8"), "# @secret\nREGION=eu\n");
    assert.equal(readEnv(f)[0].secret, true);
    writeEnv(f, "REGION", "us", false);
    assert.equal(fs.readFileSync(f, "utf8"), "REGION=us\n");
    writeEnv(f, "API_TOKEN", "x", true);
    assert.ok(!fs.readFileSync(f, "utf8").includes("# @secret"), "names that already read as secret need no marker");
  });

  test("delete takes the marker with it", () => {
    const f = tmp();
    writeEnv(f, "A", "1", false);
    writeEnv(f, "REGION", "eu", true);
    assert.equal(deleteEnv(f, "REGION"), true);
    assert.deepEqual(readEnv(f).map((v) => v.key), ["A"]);
    assert.equal(deleteEnv(f, "NOPE"), false);
  });

  test("bad names are refused", () => {
    assert.throws(() => writeEnv(tmp(), "1BAD", "x", false), /letters, digits/);
    assert.throws(() => writeEnv(tmp(), "A B", "x", false), /letters, digits/);
  });

  test("values that need quoting survive a round trip", () => {
    const f = tmp();
    const v = 'has "quotes", a # and\na newline';
    writeEnv(f, "X", v, false);
    assert.equal(readEnv(f)[0].value, v);
  });
});

test("resourcePath stays inside the folder", () => {
  assert.equal(resourcePath("/r", "a/b.txt"), path.resolve("/r/a/b.txt"));
  assert.equal(resourcePath("/r", "../x"), null);
  assert.equal(resourcePath("/r", "/etc/passwd"), null);
  assert.equal(resourcePath("/r", ""), null);
});
