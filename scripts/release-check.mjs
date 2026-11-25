#!/usr/bin/env node
// Check a published version the way the apps and the site will read it: FileFreak's public
// answers, no key (apps/desktop/electron/update.mjs). Run after publish-release.mjs.
//
//   node scripts/release-check.mjs [dir]       dir: where SHA256SUMS.txt was written (apps/desktop/dist)
//   node scripts/release-check.mjs --exists    exit 0 if this version is in the folder with its SHA256SUMS.txt, 3 if not
//   node scripts/release-check.mjs --strict    a system with no file fails the check (otherwise a warning)
//
//   EZP_RELEASE_FOLDER   the public release folder's id, until apps/desktop/electron/release.mjs has it
//
// It fails when the version is missing or not public, has no SHA256SUMS.txt, or holds a file
// whose SHA-256 is not the one built. A system with no file (a Linux host cannot make the macOS
// disk image) is a warning, or a failure with --strict: installed apps there cannot update.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASES, fileFor, releaseIn, versionsIn } from "../apps/desktop/electron/update.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every system and chip an installed copy updates itself on, as Node names them. */
export const SYSTEMS = [["darwin", "arm64"], ["darwin", "x64"], ["win32", "x64"], ["linux", "x64"], ["linux", "arm64"]];

/** What is wrong with v<version> in the folder ({ error } or { missing: systems }), or null. */
export async function problem(version, built, folder, fetch = globalThis.fetch, strict = false) {
  let release;
  try {
    const v = (await versionsIn(fetch, folder)).find((x) => x.version === version);
    release = v ? await releaseIn(fetch, v) : null;
  } catch (e) {
    return `the release folder could not be read the way the apps read it: ${e.message}`;
  }
  if (!release) return `the release folder shows no v${version}. Make it public in FileFreak, so the apps and the site can see it.`;
  if (!release.finished) return `v${version} has no SHA256SUMS.txt in the release folder, so the apps take it for a release still going up.`;
  for (const f of release.files) {
    if (built.includes(`  ${f.name}`) && !built.includes(`${f.sha256}  ${f.name}`)) return `the release folder's SHA-256 for ${f.name} is not the one built here.`;
  }
  const missing = SYSTEMS.filter(([platform, arch]) => !fileFor(release, platform, arch)).map((x) => x.join(" "));
  if (missing.length && strict) return `v${version} has no file the ${missing.join(", ")} app can update itself with.`;
  return missing.length ? { missing } : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.env.EZP_RELEASE_FOLDER || RELEASES;
  if (!folder) { console.error("release-check: no release folder. Set EZP_RELEASE_FOLDER, or RELEASES in apps/desktop/electron/release.mjs."); process.exit(1); }
  const flags = process.argv.slice(2);
  const dir = resolve(flags.find((a) => !a.startsWith("--")) ?? join(ROOT, "apps/desktop/dist"));
  const version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version;
  if (flags.includes("--exists")) {
    // Published means finished: SHA256SUMS.txt goes up last, so a version whose upload stopped
    // part way is published again rather than skipped.
    const v = (await versionsIn(globalThis.fetch, folder)).find((x) => x.version === version);
    const there = v ? (await releaseIn(globalThis.fetch, v)).finished : false;
    console.log(`release-check: v${version} is ${there ? "already" : v ? "only part way" : "not yet"} in the release folder`);
    process.exit(there ? 0 : 3);
  }
  const built = await readFile(join(dir, "SHA256SUMS.txt"), "utf8").catch(() => null);
  if (built === null) { console.error(`release-check: no SHA256SUMS.txt in ${dir}. Run publish-release.mjs first.`); process.exit(1); }
  const why = await problem(version, built, folder, globalThis.fetch, flags.includes("--strict"));
  if (typeof why === "string") { console.error(`release-check: ${why}`); process.exit(1); }
  if (why?.missing) console.warn(`release-check: v${version} has no file for ${why.missing.join(", ")}: installed apps there will not update to it. Publish those from a Mac (see docs/RELEASING.md).`);
  console.log(`release-check: v${version} is published and public, and every file's SHA-256 is the one built`);
}
