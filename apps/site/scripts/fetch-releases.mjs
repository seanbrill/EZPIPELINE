// Before the site builds (npm run build runs it): read what has been released from the public
// release folder on FileFreak and write it to content/releases.json, which the Download page reads.
//
// No key: the folder is public, and is read the way the Download page and the desktop app read
// it (readReleases in releases-lib.mjs). Each button points at the file's permanent public address.
//
// With no folder yet (EZP_RELEASE_FOLDER unset and FOLDER null) this does nothing and the
// committed list is used, so the site always builds.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FOLDER, readReleases } from "./releases-lib.mjs";

const target = join(dirname(fileURLToPath(import.meta.url)), "../content/releases.json");
const folder = process.env.EZP_RELEASE_FOLDER || FOLDER;
if (!folder) {
  console.log("releases: no release folder yet, keeping the list already in content/releases.json");
  process.exit(0);
}

let releases;
try {
  releases = await readReleases(globalThis.fetch, [], folder, { empty: true });
} catch (e) {
  // A build that silently shipped an empty Download page would be worse than one that stops.
  console.error(`releases: the release folder could not be read: ${e.message}. Is it public in FileFreak?`);
  process.exit(1);
}

const old = JSON.parse(await readFile(target, "utf8"));
await writeFile(target, JSON.stringify({ note: old.note, releases }, null, 2) + "\n");
console.log(`releases: ${releases.length} version(s)${releases[0] ? `, newest ${releases[0].version} with ${releases[0].files.length} file(s)` : ""}`);
