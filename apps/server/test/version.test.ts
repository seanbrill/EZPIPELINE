// One version: the server reports the root package.json's, however it is started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_VERSION, runningVersion } from "../src/services/version.ts";

const root = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };

test("APP_VERSION is the root package.json's version", () => {
  assert.equal(APP_VERSION, root.version, "raise APP_VERSION in apps/server/src/services/version.ts with package.json");
});

test("npm's own idea of the version is not used; EZP_VERSION is", () => {
  const before = { npm: process.env.npm_package_version, ezp: process.env.EZP_VERSION };
  process.env.npm_package_version = "1.0.0";
  delete process.env.EZP_VERSION;
  assert.equal(runningVersion(), root.version);
  process.env.EZP_VERSION = "9.9.9";
  assert.equal(runningVersion(), "9.9.9");
  for (const [k, v] of [["npm_package_version", before.npm], ["EZP_VERSION", before.ezp]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
