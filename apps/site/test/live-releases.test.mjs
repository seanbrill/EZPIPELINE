// The Download page's list, read from the release folder in the browser: the same list the
// site's build makes, with only what changed since read again. FileFreak is a fake here.

import assert from "node:assert/strict";
import test from "node:test";
import { FILES, FOLDER, liveReleases } from "../lib/live-releases.ts";
import { buildReleases, readReleases } from "../scripts/releases-lib.mjs";
import { FILES as UPDATER_FILES, RELEASES } from "../../desktop/electron/update.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// The release folder is not made yet (FOLDER null): the fake uses one of its own.
const F = FOLDER ?? "00000000-0000-4000-8000-0000000000ff";
const INSTALLERS = (v) => [`ezpipeline-${v}-mac-arm64.zip`, `ezpipeline-${v}-mac-x64.zip`, `ezpipeline-${v}-win-x64.exe`, `ezpipeline-${v}-linux-x86_64.AppImage`];

/** A release folder: versions, each { version, names, sums? }, as FileFreak's public answers give it. */
function folder(versions) {
  let n = 1;
  const top = [];
  const inside = new Map();
  for (const { version, names = INSTALLERS(version), sums = true } of versions) {
    const id = uuid(n++);
    top.push({ id, parentId: F, kind: "folder", name: `v${version}`, sizeBytes: 0, publicUrl: null, clientSha256: null });
    const files = [...names, ...(sums ? ["SHA256SUMS.txt"] : [])].map((name) => {
      const fid = uuid(n++);
      return { id: fid, parentId: id, kind: "file", name, sizeBytes: 180 * 1024 ** 2, publicUrl: `${FILES}/api/public/files/${fid}/raw`, clientSha256: "cd".repeat(32) };
    });
    inside.set(id, files);
  }
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    const m = /\/api\/public\/files\/([^/]+)\/items\?offset=(\d+)&limit=(\d+)$/.exec(url);
    const items = m && (m[1] === F ? top : inside.get(m[1]));
    if (!items) return new Response("{}", { status: 404 });
    const [offset, limit] = [Number(m[2]), Number(m[3])];
    const next = offset + limit < items.length ? offset + limit : null;
    return Response.json({ items: items.slice(offset, offset + limit), nextOffset: next, total: items.length });
  };
  // Everything in it, as the site's build reads it with its key.
  const tree = [...top.map((t) => ({ ...t, parentId: null })), ...[...inside.values()].flat()];
  return { fetch, asked, tree };
}

test("the page's folder is the one the desktop app updates from", () => {
  assert.equal(FOLDER, RELEASES);
  assert.equal(FILES, UPDATER_FILES);
});

test("a version that went up since the build is listed, newest first, as the build would list it", async () => {
  const ff = folder([{ version: "0.1.9" }, { version: "0.1.10" }, { version: "0.1.11" }]);
  const built = buildReleases(ff.tree.filter((i) => !i.name.includes("0.1.11"))).releases;
  assert.deepEqual(built.map((r) => r.version), ["0.1.10", "0.1.9"]);
  const now = await liveReleases(ff.fetch, built, F);
  assert.deepEqual(now, buildReleases(ff.tree).releases, "the same names, platforms, sizes and checksums as the build");
  assert.equal(now[0].version, "0.1.11");
});

test("a visit reads the folder's top and only the versions that may have changed", async () => {
  const versions = Array.from({ length: 12 }, (_, i) => ({ version: `0.1.${i}` }));
  const ff = folder(versions);
  const built = buildReleases(ff.tree).releases;
  assert.deepEqual(await liveReleases(ff.fetch, built, F), built);
  // The top, and the two newest versions the page knows, again: a Mac adds its .dmg later.
  assert.equal(ff.asked.length, 3, ff.asked.join("\n"));
});

test("a .dmg a Mac added to the newest version after the build is listed", async () => {
  const before = folder([{ version: "0.1.4" }, { version: "0.1.5" }]);
  const built = buildReleases(before.tree).releases;
  const after = folder([{ version: "0.1.4" }, { version: "0.1.5", names: [...INSTALLERS("0.1.5"), "ezpipeline-0.1.5-mac-arm64.dmg"] }]);
  const now = await liveReleases(after.fetch, built, F);
  assert.ok(now[0].files.some((f) => f.name === "ezpipeline-0.1.5-mac-arm64.dmg" && f.system === "macOS" && f.arch === "arm64"));
});

test("an empty version folder is not opened", async () => {
  const ff = folder([{ version: "0.1.4" }, { version: "0.1.5" }]);
  const built = buildReleases(ff.tree).releases;
  const empty = { id: uuid(999), parentId: F, kind: "folder", name: "v0.1.3", childCount: 0 };
  const fetch = async (url) => {
    const res = await ff.fetch(url);
    if (!url.includes(`/${F}/`)) return res;
    const page = await res.json();
    return Response.json({ ...page, items: [...page.items, empty] });
  };
  assert.deepEqual((await liveReleases(fetch, built, F)).map((r) => r.version), ["0.1.5", "0.1.4"]);
  assert.ok(!ff.asked.some((u) => u.includes(uuid(999))));
});

test("a version still going up, with no SHA256SUMS.txt yet, is not offered", async () => {
  const ff = folder([{ version: "0.1.4" }, { version: "0.1.5", names: INSTALLERS("0.1.5").slice(0, 2), sums: false }]);
  const built = buildReleases(ff.tree.filter((i) => !i.name.includes("0.1.5"))).releases;
  const now = await liveReleases(ff.fetch, built, F);
  assert.deepEqual(now.map((r) => r.version), ["0.1.4"]);
});

test("a version taken out of the folder goes from the list", async () => {
  const ff = folder([{ version: "0.1.4" }, { version: "0.1.5" }]);
  const built = [...buildReleases(ff.tree).releases, { version: "0.1.3", files: [] }];
  assert.deepEqual((await liveReleases(ff.fetch, built, F)).map((r) => r.version), ["0.1.5", "0.1.4"]);
});

test("a listing of more than one page is read to its end", async () => {
  const ff = folder(Array.from({ length: 205 }, (_, i) => ({ version: `1.0.${i}`, names: [`ezpipeline-1.0.${i}-win-x64.exe`] })));
  const built = buildReleases(ff.tree).releases;
  assert.equal((await liveReleases(ff.fetch, built, F)).length, 205);
  assert.ok(ff.asked.some((u) => u.includes("offset=200")));
});

test("when FileFreak does not answer, or answers with something else, it says so and the page keeps its list", async () => {
  const built = buildReleases(folder([{ version: "0.1.4" }]).tree).releases;
  await assert.rejects(liveReleases(async () => new Response("no", { status: 503 }), built, F), /503/);
  await assert.rejects(liveReleases(async () => Response.json({ items: "nope" }), built, F), /not the release folder's listing/);
  await assert.rejects(liveReleases(async () => Response.json({ items: [], nextOffset: null }), built, F), /no versions/);
});

test("the site's build reads every version with no key, the same list as a full listing", async () => {
  const ff = folder([{ version: "0.1.9" }, { version: "0.1.10" }, { version: "0.1.11", sums: false }]);
  const built = await readReleases(ff.fetch, [], F, { empty: true });
  assert.deepEqual(built, buildReleases(ff.tree).releases.filter((r) => r.version !== "0.1.11"), "a version without SHA256SUMS.txt is still going up");
  assert.deepEqual(built.map((r) => r.version), ["0.1.10", "0.1.9"]);
  assert.ok(ff.asked.every((u) => u.startsWith(`${FILES}/api/public/files/`)), "only FileFreak's public answers");
});

test("a build before the first release lists nothing; a page does not believe an empty folder", async () => {
  const ff = folder([]);
  assert.deepEqual(await readReleases(ff.fetch, [], F, { empty: true }), []);
  await assert.rejects(readReleases(ff.fetch, [], F), /lists no versions/);
});
