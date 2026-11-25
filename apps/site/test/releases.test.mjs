import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildReleases } from "../scripts/releases-lib.mjs";

const dir = (id, name) => ({ id, kind: "folder", name, parentId: null });
const file = (id, parentId, name, extra = {}) => ({ id, kind: "file", name, parentId, sizeBytes: 150 * 1024 ** 2, publicUrl: `https://files.example/${id}`, clientSha256: "ab".repeat(32), ...extra });

test("versions are newest first, files are labelled by platform, and the address is the public one", () => {
  const { releases } = buildReleases([
    dir("a", "v0.1.0"), dir("b", "v0.10.0"), dir("c", "v0.2.0"),
    file("1", "a", "ezpipeline-0.1.0-mac-arm64.dmg"), file("2", "b", "ezpipeline-0.10.0-linux-x64.AppImage"), file("3", "b", "ezpipeline-0.10.0-win-x64.exe"),
  ]);
  assert.deepEqual(releases.map((r) => r.version), ["0.10.0", "0.1.0"], "0.10.0 sorts above 0.2.0 and 0.1.0, not as text");
  assert.deepEqual(releases[0].files.map((f) => f.platform), ["Linux (x64)", "Windows"]);
  assert.equal(releases[1].files[0].url, "https://files.example/1");
  assert.equal(releases[1].files[0].size, "150 MB");
});

test("each download says which chip it is for, so nobody has to know what arm64 means", () => {
  const names = ["ezpipeline-1.0.0-mac-arm64.dmg", "ezpipeline-1.0.0-mac-x64.zip", "ezpipeline-1.0.0-mac-universal.dmg", "ezpipeline-1.0.0-win-x64.exe", "ezpipeline-1.0.0-win-arm64.exe", "ezpipeline-1.0.0-linux-arm64.AppImage", "ezpipeline-1.0.0-linux-x86_64.AppImage"];
  const { releases } = buildReleases([dir("a", "v1.0.0"), ...names.map((n, i) => file(String(i), "a", n))]);
  assert.deepEqual(Object.fromEntries(releases[0].files.map((f) => [f.name, f.platform])), {
    "ezpipeline-1.0.0-mac-arm64.dmg": "macOS (Apple silicon)", "ezpipeline-1.0.0-mac-x64.zip": "macOS (Intel)", "ezpipeline-1.0.0-mac-universal.dmg": "macOS",
    "ezpipeline-1.0.0-win-x64.exe": "Windows", "ezpipeline-1.0.0-win-arm64.exe": "Windows (Arm)",
    "ezpipeline-1.0.0-linux-arm64.AppImage": "Linux (ARM64)", "ezpipeline-1.0.0-linux-x86_64.AppImage": "Linux (x64)",
  });
});

test("each file gives its system and chip as data too, for the button that picks one", () => {
  const { releases } = buildReleases([dir("a", "v1.0.0"), file("1", "a", "ezpipeline-1.0.0-mac-universal.dmg"), file("2", "a", "ezpipeline-1.0.0-linux-x86_64.AppImage")]);
  assert.deepEqual(releases[0].files.map(({ system, arch }) => ({ system, arch })), [{ system: "Linux", arch: "x64" }, { system: "macOS", arch: null }]);
});

test("checksums, blockmaps, stray folders and loose files never become buttons", () => {
  const { releases } = buildReleases([dir("a", "v1.0.0"), dir("x", "drafts"), file("1", "a", "SHA256SUMS.txt"), file("2", "a", "x.blockmap"), file("3", "x", "ezpipeline.dmg"), file("4", null, "ezpipeline.dmg")]);
  assert.deepEqual(releases, []);
});

test("a file that is not public is left out and reported, because its button could not work", () => {
  const { releases, skipped } = buildReleases([dir("a", "v1.0.0"), file("1", "a", "k.dmg", { publicUrl: null })]);
  assert.deepEqual(releases, []); assert.deepEqual(skipped, ["k.dmg"]);
});

test("a file with no recorded checksum says so instead of inventing one", () => {
  const { releases } = buildReleases([dir("a", "v1.0.0"), file("1", "a", "k.dmg", { clientSha256: null })]);
  assert.equal(releases[0].files[0].sha256, "not recorded");
});

test("a version folder nested one level too deep is not listed a second time", () => {
  // What a first upload did: v0.1.0 inside a folder called release, inside the release folder.
  const { releases } = buildReleases([
    dir("top", "v0.1.0"), { id: "stray", kind: "folder", name: "release", parentId: "outside" }, { id: "deep", kind: "folder", name: "v0.1.0", parentId: "stray" },
    file("1", "top", "ezpipeline-0.1.0-linux-arm64.AppImage"), file("2", "deep", "ezpipeline-0.1.0-linux-arm64.AppImage"),
  ].map((i) => (i.id === "top" ? { ...i, parentId: "outside" } : i)));
  assert.equal(releases.length, 1);
  assert.deepEqual(releases[0].files.map((f) => f.url), ["https://files.example/1"]);
});

test("the same holds when the listing includes the release folder itself", () => {
  const { releases } = buildReleases([
    { id: "root", kind: "folder", name: "release", parentId: null }, { ...dir("a", "v1.0.0"), parentId: "root" }, { ...dir("b", "v1.1.0"), parentId: "root" },
    file("1", "a", "k-1.0.0.dmg"), file("2", "b", "k-1.1.0.dmg"),
  ]);
  assert.deepEqual(releases.map((r) => r.version), ["1.1.0", "1.0.0"]);
});

test("a folder with no versions in it lists nothing, and does not throw", () => {
  assert.deepEqual(buildReleases([]).releases, []);
  assert.deepEqual(buildReleases([dir("x", "drafts")]).releases, []);
});

test("one version: the repo, the desktop app and the site say the same", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8")).version;
  const version = read("../../../package.json");
  assert.equal(read("../../desktop/package.json"), version, "apps/desktop/package.json");
  assert.equal(read("../package.json"), version, "apps/site/package.json");
});
