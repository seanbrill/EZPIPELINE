// The updater's choices, in plain Node (no Electron): which version, which file, whether it can be checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkable, fileFor, newer, offered, pickUpdate, untranslocated } from "../electron/update.mjs";

const sha = "a".repeat(64);
const rel = (version, names) => ({ version, files: names.map((name) => ({ name, system: /mac/.test(name) ? "macOS" : /win/.test(name) ? "Windows" : "Linux", arch: /arm64/.test(name) ? "arm64" : "x64", url: `https://x/${name}`, sha256: sha })) });
const all = (v) => rel(v, [`ezpipeline-${v}-mac-arm64.zip`, `ezpipeline-${v}-mac-arm64.dmg`, `ezpipeline-${v}-mac-x64.zip`, `ezpipeline-${v}-win-x64.exe`, `ezpipeline-${v}-linux-x86_64.AppImage`, `ezpipeline-${v}-linux-arm64.AppImage`]);

test("versions in order, a test version before its release", () => {
  assert.equal(newer("2.0.0", "2.0.1"), true);
  assert.equal(newer("2.0.1", "2.0.0"), false);
  assert.equal(newer("2.0.0", "2.0.0"), false);
  assert.equal(newer("2.1.0-beta.1", "2.1.0"), true);
  assert.equal(newer("2.0.9", "2.1.0-beta.1"), true);
  assert.equal(newer("v2.0.0", "2.0.10"), true);
});

test("a release copy is never offered a test version", () => {
  assert.deepEqual(offered([{ version: "2.1.0-beta.1" }, { version: "2.0.1" }], "2.0.0").map((r) => r.version), ["2.0.1"]);
  assert.deepEqual(offered([{ version: "2.1.0-beta.2" }], "2.1.0-beta.1").map((r) => r.version), ["2.1.0-beta.2"]);
});

test("the file for each system and chip: the Mac zip, the Windows installer, the AppImage", () => {
  const r = all("2.0.1");
  assert.equal(fileFor(r, "darwin", "arm64").name, "ezpipeline-2.0.1-mac-arm64.zip");
  assert.equal(fileFor(r, "darwin", "x64").name, "ezpipeline-2.0.1-mac-x64.zip");
  assert.equal(fileFor(r, "win32", "x64").name, "ezpipeline-2.0.1-win-x64.exe");
  assert.equal(fileFor(r, "win32", "arm64").name, "ezpipeline-2.0.1-win-x64.exe");
  assert.equal(fileFor(r, "linux", "arm64").name, "ezpipeline-2.0.1-linux-arm64.AppImage");
  assert.equal(fileFor(rel("2.0.1", ["ezpipeline-2.0.1-mac-arm64.dmg"]), "darwin", "arm64"), null);
});

test("the newest version with a file for this computer", () => {
  const newest = rel("2.2.0", ["ezpipeline-2.2.0-win-x64.exe"]);
  assert.equal(pickUpdate([all("2.0.1"), newest, all("2.1.0")], "2.0.0", "darwin", "arm64").version, "2.1.0");
  assert.equal(pickUpdate([all("1.9.0")], "2.0.0", "darwin", "arm64"), null);
});

test("only a file with a SHA-256 on record is installed by itself", () => {
  assert.equal(checkable({ sha256: sha }), true);
  assert.equal(checkable({ sha256: "not recorded" }), false);
  assert.equal(checkable({}), false);
});

test("the real app behind a translocated copy", () => {
  const mounts = "/Users/x/Downloads/EZPipeline.app on /private/var/folders/ab/T/AppTranslocation/1234 (nullfs, local)\n";
  assert.equal(untranslocated("/Applications/EZPipeline.app", mounts), "/Applications/EZPipeline.app");
  assert.equal(untranslocated("/private/var/folders/ab/T/AppTranslocation/1234/d/EZPipeline.app", mounts), "/Users/x/Downloads/EZPipeline.app");
  assert.equal(untranslocated("/private/var/folders/ab/T/AppTranslocation/9999/d/EZPipeline.app", mounts), null);
});
