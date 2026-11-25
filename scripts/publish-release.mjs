#!/usr/bin/env node
// Publish the desktop installers as a versioned download on FileFreak.
//
//   node scripts/publish-release.mjs [dir]        dir defaults to apps/desktop/dist
//   node scripts/publish-release.mjs --check      only checks the key can write, before a long build
//
//   FILEFREAK_KEY   a key that may write files (files:write) in EZPipeline's FileFreak app
//
// The release folder is "releases" at the top of what the key reaches. This script makes it if
// it is not there, and makes it public (the apps, the site's build and the Download page read
// it with no key). Each version goes in releases/v<version> (the root package.json's version),
// with SHA256SUMS.txt sent last: the apps and the site take a version without it as one still
// going up. Same-named files are replaced, so running a version again is safe. The folder's id
// is printed: it is EZP_RELEASE_FOLDER, RELEASES in apps/desktop/electron/release.mjs and
// FOLDER in apps/site/scripts/releases-lib.mjs.
//
// Only WRITE calls are made. A folder is made with ifExists "use", which hands back the one
// already there, and each file is uploaded into that folder's id. So a key that may write but
// not read is enough; the filefreak command line looks every path up first, which needs read.
//
// The SDK comes from apps/site (npm ci there first), so the root package needs nothing more.

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = /\.(dmg|zip|exe|msi|appimage|deb|rpm)$/i;
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const RELEASE_FOLDER_NAME = "releases";
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(ROOT, "apps/desktop/dist"));
const fail = (m) => { console.error(`publish: ${m}`); process.exit(1); };

const key = process.env.FILEFREAK_KEY;
if (!key) fail("FILEFREAK_KEY is not set.");
const SDK = join(ROOT, "apps/site/node_modules/@filefreak.io/sdk/dist");
if (!existsSync(SDK)) fail("the FileFreak SDK is not installed. Run npm ci in apps/site first.");
const { FileFreak, FileFreakError } = await import(pathToFileURL(join(SDK, "index.js")).href);
const { fromPath } = await import(pathToFileURL(join(SDK, "node.js")).href);

const version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version;
const ff = new FileFreak({ apiKey: key });
const refused = (e) => { if (e instanceof FileFreakError) fail(`FileFreak refused it (${e.status} ${e.code}): ${e.message}`); throw e; };
/** The release folder: made if missing, and public. */
async function releaseFolder() {
  let folder = await ff.folders.create({ name: RELEASE_FOLDER_NAME, ifExists: "use" }).then((r) => r.item, refused);
  if (folder.visibility !== "public") {
    folder = await ff.files.update(folder.id, { visibility: "public" }).then((r) => r.item, refused);
    console.log(`publish: made ${RELEASE_FOLDER_NAME}/ public, so the apps and the site can read it with no key`);
  }
  if (process.env.EZP_RELEASE_FOLDER && process.env.EZP_RELEASE_FOLDER !== folder.id) {
    fail(`this key's ${RELEASE_FOLDER_NAME}/ folder is ${folder.id}, but EZP_RELEASE_FOLDER is ${process.env.EZP_RELEASE_FOLDER}. The apps and the site would not see this upload.`);
  }
  if (!folder.public) console.warn(`publish: ${RELEASE_FOLDER_NAME}/ is set public, but FileFreak shows it to nobody yet: switch on the account's public page on FileFreak.`);
  console.log(`publish: the release folder is ${RELEASE_FOLDER_NAME}/ (${folder.id})`);
  return folder;
}
const releases = await releaseFolder();
// Only the release folder is made by a check: an empty v<version> would read as a release.
if (checkOnly) {
  console.log(`publish: this key can write to the release folder`);
  process.exit(0);
}
const versionFolder = () => ff.folders.create({ name: `v${version}`, parentId: releases.id, ifExists: "use" }).then((r) => r.item, refused);

// This version's installers only: dist/ can hold older builds.
const installers = (await readdir(dir)).filter((f) => INSTALLER.test(f) && f.startsWith(`ezpipeline-${version}-`)).sort();
if (!installers.length) fail(`no ezpipeline-${version}-* installers in ${dir}, so there is nothing to publish.`);

const mb = (n) => `${(n / 1024 ** 2).toFixed(1)} MB`;
const sha256 = (p) => new Promise((ok, no) => {
  const h = createHash("sha256");
  createReadStream(p).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", no);
});
// Each file's SHA-256 is also kept with it in FileFreak, where the Download page reads it.
const hashes = new Map();
for (const f of installers) hashes.set(f, await sha256(join(dir, f)));
await writeFile(join(dir, "SHA256SUMS.txt"), [...hashes].map(([f, h]) => `${h}  ${f}`).join("\n") + "\n");
hashes.set("SHA256SUMS.txt", await sha256(join(dir, "SHA256SUMS.txt")));

const parentId = (await versionFolder()).id;
console.log(`publish: v${version} in the release folder`);

let hidden = 0;
for (const f of [...installers, "SHA256SUMS.txt"]) {
  const path = join(dir, f);
  const total = (await stat(path)).size;
  let shown = 0;
  const item = await ff.upload(await fromPath(path), {
    // Stored as it is, so its public link downloads it. A file FileFreak keeps compressed has
    // no direct address: its public link opens a FileFreak page that rebuilds it.
    parentId, onConflict: "replace", sha256: hashes.get(f), compress: false,
    onProgress: (sent) => { const pct = Math.floor((sent / total) * 4) * 25; if (pct > shown && pct < 100) { shown = pct; console.log(`  ${f} ${pct}%`); } },
  }).catch(refused);
  if (!item.publicUrl) hidden++;
  console.log(`  ${f}  ${mb(total)}  ${item.publicUrl ?? "(not public)"}`);
}
if (hidden) console.warn(`publish: ${hidden} file(s) are not public. The Download page lists only public files: make the release folder public in FileFreak.`);
