// Turn a FileFreak folder listing into the site's releases list.
//
// The release folder holds one folder per version, named v<semver>, with the
// installers inside. Anything else in it is ignored, so a stray file cannot
// become a download button.

const PLATFORMS = [
  [/\.dmg$|\.zip$/i, "macOS"], [/\.exe$|\.msi$/i, "Windows"], [/\.appimage$|\.deb$|\.rpm$/i, "Linux"],
];
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const systemOf = (name) => (name.toLowerCase().endsWith(".zip") && /linux/i.test(name) ? "Linux" : name.toLowerCase().endsWith(".zip") && /win/i.test(name) ? "Windows" : PLATFORMS.find(([re]) => re.test(name))?.[1] ?? null);
// The chip, from the arch in the name (ezpipeline-2.0.0-mac-arm64.dmg is for Apple silicon).
// None in the name (a universal Mac build) means every chip.
const ARCHS = [[/[-_.](arm64|aarch64)[-_.]/i, "arm64"], [/[-_.](x64|x86_64|amd64)[-_.]/i, "x64"]];
const archOf = (name) => ARCHS.find(([re]) => re.test(name))?.[1] ?? null;
// What each system calls each chip. Windows on x64 gets no word: that is nearly every
// Windows PC, and Windows on Arm runs it.
const CHIPS = { arm64: { macOS: "Apple silicon", Windows: "Arm", Linux: "ARM64" }, x64: { macOS: "Intel", Windows: null, Linux: "x64" } };

export const size = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);
/** For sort(): the newer of two versions first. */
export const newestFirst = (a, b) => { const p = (v) => v.replace(/^v/, "").split("-")[0].split(".").map(Number); const [x, y] = [p(a), p(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

/** @param items every item in the folder, files and folders, as the FileFreak tree gives them */
export function buildReleases(items) {
  // Only the version folders nearest the top count. A v1.2.3 folder that ended up
  // inside another folder (a release uploaded one level too deep) would otherwise
  // be listed as a second copy of that version.
  const byId = new Map(items.map((i) => [i.id, i]));
  const depth = (i) => { let d = 0; for (let x = byId.get(i.parentId); x; x = byId.get(x.parentId)) d++; return d; };
  const versionFolders = items.filter((i) => i.kind === "folder" && VERSION.test(i.name));
  const top = Math.min(...versionFolders.map(depth));
  const folders = new Map(versionFolders.filter((i) => depth(i) === top).map((i) => [i.id, i]));
  const skipped = [];
  const byVersion = new Map();
  const sums = new Map();                                       // version -> SHA256SUMS.txt's link
  for (const f of items) {
    if (f.kind !== "file" || !folders.has(f.parentId)) continue;
    if (f.name === "SHA256SUMS.txt" && f.publicUrl) { sums.set(folders.get(f.parentId).name.replace(/^v/, ""), f.publicUrl); continue; }
    const system = systemOf(f.name);
    if (!system) continue;                                     // checksums, blockmaps and the like
    if (!f.publicUrl) { skipped.push(f.name); continue; }       // a download button that cannot work is worse than none
    const version = folders.get(f.parentId).name.replace(/^v/, "");
    const arch = archOf(f.name);
    const chip = arch && CHIPS[arch][system];
    // system and arch are for the button that picks the visitor's file (lib/downloads.ts).
    (byVersion.get(version) ?? byVersion.set(version, []).get(version)).push({
      platform: chip ? `${system} (${chip})` : system, system, arch, name: f.name, url: f.publicUrl, size: size(f.sizeBytes), sha256: f.clientSha256 ?? "not recorded",
    });
  }
  const releases = [...byVersion].sort(([a], [b]) => newestFirst(a, b)).map(([version, files]) => ({ version, files: files.sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name)), ...(sums.has(version) ? { sums: sums.get(version) } : {}) }));
  return { releases, skipped };
}

// ---- Reading the public release folder, with no key ----------------------------------
// The folder is public: FileFreak answers anyone, and lets any page read the answer. The
// site's build (scripts/fetch-releases.mjs) and the Download page in the browser
// (lib/live-releases.ts) both read it this way, as the desktop app does
// (apps/desktop/electron/update.mjs), so no key is needed to list a release.

/** Where FileFreak answers for public files. */
export const FILES = "https://filefreak.link";
/** The public release folder ("releases" in EZPipeline's FileFreak app): one v<version> folder in it per release. Same as RELEASES in apps/desktop/electron/release.mjs. */
export const FOLDER = "0fe590d4-cbd6-4274-b40e-3413eddabab0";
/** How many of the newest versions a page that knows them reads again: a Mac adds its .dmg after the pipeline's upload. */
const RECHECK = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything directly in a public folder, every page of its listing. */
export async function publicListing(fetch, id) {
  const items = [];
  for (let offset = 0; offset !== null;) {
    const res = await fetch(`${FILES}/api/public/files/${id}/items?offset=${offset}&limit=200`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`FileFreak answered ${res.status} for the release folder.`);
    const page = await res.json();
    const next = page?.nextOffset;
    if (!Array.isArray(page?.items) || !(next === null || (typeof next === "number" && next > offset))) throw new Error("FileFreak's answer is not the release folder's listing.");
    items.push(...page.items.filter((i) => i && UUID.test(String(i.id)) && typeof i.name === "string"));
    offset = next;
  }
  return items;
}

/**
 * The releases, newest first, as the folder has them now. `known` is a list already had (the
 * one a page was built with): only the versions it lacks, and its newest few, are opened. With
 * none known, every version is. A version is listed once its SHA256SUMS.txt is up, which
 * scripts/publish-release.mjs sends last, so a version still going up is not offered.
 * A folder with no versions throws, unless `empty` says that is fine (a build before the first release).
 */
export async function readReleases(fetch, known, folder, { empty = false } = {}) {
  const versions = (await publicListing(fetch, folder)).filter((i) => i.kind === "folder" && VERSION.test(i.name));
  if (!versions.length) {
    if (empty) return [];
    // A folder with no versions in it is not one a page should believe over its own list.
    throw new Error("The release folder lists no versions.");
  }
  const had = new Map(known.map((r) => [r.version, r]));
  const recheck = new Set(known.slice(0, RECHECK).map((r) => r.version));
  const versionOf = (i) => i.name.replace(/^v/, "");
  // An empty folder (a version whose upload failed) has nothing to read.
  const open = versions.filter((v) => v.childCount !== 0 && (!had.has(versionOf(v)) || recheck.has(versionOf(v))));
  const opened = await Promise.all(open.map(async (v) => ({ v, items: await publicListing(fetch, v.id) })));
  const fresh = new Map();
  for (const { v, items } of opened) {
    if (!items.some((i) => i.kind === "file" && i.name === "SHA256SUMS.txt")) continue;
    const r = buildReleases([{ ...v, parentId: null }, ...items.map((i) => ({ ...i, parentId: v.id }))]).releases[0];
    if (r) fresh.set(r.version, r);
  }
  // A version taken out of the folder goes too: its buttons would not work.
  return [...new Set(versions.map(versionOf))].map((v) => fresh.get(v) ?? had.get(v)).filter((r) => !!r)
    .sort((a, b) => newestFirst(a.version, b.version));
}
