// Updates (design sheet f153). Modelled on knitted's: the app reads EZPipeline's release
// folder on FileFreak, where the release script puts each version's installers, so a
// release is offered as soon as its files are up. When there is a newer version it
// downloads this computer's file, checks it against the SHA-256 in that version's
// SHA256SUMS.txt, puts it in place and restarts. If the folder cannot be read, it asks the
// website's /releases.json, the list the Downloads page shows.
//
// Not electron-updater: on a Mac it needs a paid Apple certificate (Squirrel.Mac refuses
// an ad-hoc signed app), and the release list already says everything it needs.
// Electron is passed in, so test/update.test.mjs can load this file in plain Node.
//
//   macOS    the .zip, unzipped in userData, its signature and bundle id checked, then
//            swapped for the EZPipeline.app that is running (the old one comes back if
//            the new one cannot take its place).
//   Windows  the installer, run silently: it closes this copy, installs and starts the new.
//   Linux    the AppImage, written over the one that is running (process.env.APPIMAGE).
// A copy that cannot replace itself sends the person to the Downloads page instead.
//
// Unlike knitted's, it reports a state the window shows as a card at the foot of the
// sidebar (and the tray as menu items): available, downloading, ready, failed.
// Only the app and the server it runs on this computer are updated: a server you
// connect to updates itself.

import { createHash } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { accessSync, chmodSync, constants, createWriteStream, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DOWNLOADS, FILES, RELEASES, SITE } from "./release.mjs";

export { FILES, RELEASES };
const HOURS6 = 6 * 60 * 60 * 1000;

const parse = (v) => {
  const s = String(v).replace(/^v/, "");
  const i = s.indexOf("-");
  return { nums: (i < 0 ? s : s.slice(0, i)).split(".").map(Number), pre: i < 0 ? null : s.slice(i + 1) };
};

/** Is version b newer than version a? 0.2.0 is newer than 0.2.0-beta.1, which is newer than 0.1.9. */
export function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (y.nums[i] || 0) - (x.nums[i] || 0);
    if (d) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (y.pre === null) return true;
  if (x.pre === null) return false;
  return y.pre.localeCompare(x.pre, "en", { numeric: true }) > 0;
}

/** A release's file for this copy's system and chip, or null. Windows on Arm runs the x64 installer. */
export function fileFor(release, platform, arch) {
  const files = release?.files ?? [];
  const find = (system, ext, chip) => files.find((f) => f.system === system && String(f.name).toLowerCase().endsWith(ext) && (f.arch === chip || f.arch === null));
  if (platform === "darwin") return find("macOS", ".zip", arch) ?? null;
  if (platform === "win32") return find("Windows", ".exe", arch) ?? (arch === "arm64" ? find("Windows", ".exe", "x64") : undefined) ?? null;
  if (platform === "linux") return find("Linux", ".appimage", arch) ?? null;
  return null;
}

/**
 * The releases newer than `current` that it may be offered, newest first. Test versions
 * (0.2.0-beta.1) are only offered to a copy that is itself a test version.
 */
export function offered(releases, current) {
  const testing = String(current).includes("-");
  return (Array.isArray(releases) ? releases : [])
    .filter((r) => r && (testing || !String(r.version).includes("-")) && newer(current, r.version))
    .sort((a, b) => (newer(a.version, b.version) ? 1 : newer(b.version, a.version) ? -1 : 0));
}

/** The newest release newer than `current` with a file for this computer, or null. */
export function pickUpdate(releases, current, platform, arch) {
  for (const r of offered(releases, current)) {
    const file = fileFor(r, platform, arch);
    if (file) return { version: String(r.version), file };
  }
  return null;
}

/** Only a file whose SHA-256 the release list records can be checked, so only that is installed. */
export const checkable = (file) => /^[0-9a-f]{64}$/i.test(String(file?.sha256));

// The release folder, as FileFreak's public answers give it. A file's system and chip come
// from its name, as the site's list says them (apps/site/scripts/releases-lib.mjs:
// test/update.test.mjs holds the two to the same answers).
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYSTEMS = [[/\.dmg$|\.zip$/i, "macOS"], [/\.exe$|\.msi$/i, "Windows"], [/\.appimage$|\.deb$|\.rpm$/i, "Linux"]];
const systemOf = (name) => (/\.zip$/i.test(name) && /linux/i.test(name) ? "Linux" : /\.zip$/i.test(name) && /win/i.test(name) ? "Windows" : SYSTEMS.find(([re]) => re.test(name))?.[1] ?? null);
const archOf = (name) => (/[-_.](arm64|aarch64)[-_.]/i.test(name) ? "arm64" : /[-_.](x64|x86_64|amd64)[-_.]/i.test(name) ? "x64" : null);
const raw = (id) => `${FILES}/api/public/files/${id}/raw`;

async function ask(fetch, url, as = "json") {
  const res = await fetch(url, { headers: { accept: as === "json" ? "application/json" : "text/plain" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`FileFreak answered ${res.status} for the release folder.`);
  return as === "json" ? res.json() : res.text();
}

/** Everything directly in a public folder, every page of its listing. */
async function listing(fetch, id) {
  const items = [];
  for (let offset = 0; offset !== null;) {
    const page = await ask(fetch, `${FILES}/api/public/files/${id}/items?offset=${offset}&limit=200`);
    if (!Array.isArray(page?.items) || !(page.nextOffset === null || page.nextOffset > offset)) throw new Error("FileFreak's answer is not the release folder's listing.");
    items.push(...page.items.filter((i) => i && UUID.test(String(i.id)) && typeof i.name === "string"));
    offset = page.nextOffset;
  }
  return items;
}

/** The release folder's versions, from its v<version> folders. */
export async function versionsIn(fetch, folder = RELEASES) {
  return (await listing(fetch, folder)).filter((i) => i.kind === "folder" && VERSION.test(i.name)).map((i) => ({ version: i.name.replace(/^v/, ""), id: i.id }));
}

/**
 * A version's installers, as the site's list has them, each with the SHA-256 its folder's
 * SHA256SUMS.txt records. the release script sends that file last, so until it is there
 * the version is still going up (finished: false).
 */
export async function releaseIn(fetch, { version, id }) {
  const files = (await listing(fetch, id)).filter((i) => i.kind === "file");
  const sums = files.find((i) => i.name === "SHA256SUMS.txt");
  const hashes = new Map();
  for (const line of sums ? (await ask(fetch, raw(sums.id), "text")).split("\n") : []) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (m) hashes.set(m[2], m[1].toLowerCase());
  }
  return {
    version,
    finished: !!sums,
    files: files.filter((i) => systemOf(i.name)).map((i) => ({ system: systemOf(i.name), arch: archOf(i.name), name: i.name, url: raw(i.id), sha256: hashes.get(i.name) ?? "not recorded" })),
  };
}

/** pickUpdate, from the release folder itself. Only the versions it may offer are opened, newest first. */
export async function latest(fetch, current, platform, arch, folder = RELEASES) {
  for (const v of offered(await versionsIn(fetch, folder), current)) {
    const release = await releaseIn(fetch, v);
    if (!release.finished) continue;
    const found = pickUpdate([release], current, platform, arch);
    if (found) return found;
  }
  return null;
}

const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { maxBuffer: 1 << 20 }, (e, out, err) => (e ? fail(new Error(`${basename(cmd)}: ${String(err || e.message).trim()}`)) : ok(String(out)))));
const plist = async (app, key) => (await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")])).trim();
const writable = (p) => { try { accessSync(p, constants.W_OK); return true; } catch { return false; } };

/**
 * The app macOS is really running. A downloaded app opened where it was downloaded runs
 * from a read-only copy (App Translocation, at .../AppTranslocation/<id>/d/EZPipeline.app);
 * the copy is mounted from the real one, and the mount says where that is.
 */
export function untranslocated(bundle, mounts) {
  const m = /^(.+\/AppTranslocation\/[^/]+)\/d\/[^/]+\.app$/.exec(bundle);
  if (!m) return bundle;
  const on = ` on ${m[1]} (`;
  const line = mounts.split("\n").find((l) => l.includes(on));
  return line ? line.slice(0, line.indexOf(on)) : null;
}

/**
 * @param electron { app, net, BrowserWindow }
 * @param o.onChange  (state) => void, whenever the state changes
 * @param o.quit      stops the server and exits, as main.mjs does
 * @param o.busy      () => number of runs going on this computer (0 when connected elsewhere)
 *
 * state: { phase: "idle"|"checking"|"current"|"available"|"downloading"|"ready"|"failed"|"manual",
 *          current, version?, size?, got?, total?, message?, page? }
 */
export function createUpdater({ app, net, BrowserWindow }, { version, onChange, quit, busy = () => 0, feed = process.env.EZP_UPDATE_URL }) {
  const dir = join(app.getPath("userData"), "update");
  const prefsFile = join(app.getPath("userData"), "updates.json");
  const current = version ?? app.getVersion();
  const mac = process.platform === "darwin";
  let state = { phase: "idle", current };
  let found = null;        // { version, file } of what is on offer
  let install = null;      // (relaunch) => void, once the download is in place
  let stop = null;         // aborts the download
  let afterRuns = null;    // the timer waiting for runs to finish before a restart
  let timer = null;

  const set = (patch) => { state = { current, ...patch }; onChange?.(state); };
  const prefs = () => { try { return JSON.parse(readFileSync(prefsFile, "utf8")); } catch { return {}; } };
  const fetch = (url, init) => net.fetch(url, init);
  const fromList = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`The website answered ${res.status}.`);
    return pickUpdate((await res.json()).releases, current, process.platform, process.arch);
  };
  async function find() {
    if (feed) return fromList(feed);
    if (RELEASES) {
      try { return await latest(fetch, current, process.platform, process.arch, RELEASES); }
      catch (e) { console.error("[update] release folder:", e?.message ?? e); }
    }
    return fromList(`${SITE}/releases.json`);
  }

  /** Where this copy lives, if it can replace itself there; otherwise why not. */
  async function here() {
    if (!app.isPackaged) return { why: "This copy runs from the source code. Pull the newest code instead." };
    if (mac) {
      const running = resolve(app.getPath("exe"), "../../..");
      const bundle = untranslocated(running, running.includes("/AppTranslocation/") ? await run("/sbin/mount", []).catch(() => "") : "");
      if (!bundle?.endsWith(".app") || (bundle !== running && await plist(bundle, "CFBundleIdentifier").catch(() => null) !== await plist(running, "CFBundleIdentifier"))) {
        return { why: "EZPipeline cannot find its own app to replace. Move it to your Applications folder and open it from there." };
      }
      if (!writable(dirname(bundle)) || !writable(bundle)) {
        return { why: "Move EZPipeline to your Applications folder and open it from there. It cannot replace a copy that runs from the disk image or from a folder it cannot write to." };
      }
      return { kind: "mac", bundle, exe: join(bundle, "Contents/MacOS", basename(app.getPath("exe"))) };
    }
    if (process.platform === "win32") return { kind: "win" };
    if (process.platform === "linux") {
      const image = process.env.APPIMAGE;
      if (!image) return { why: "This copy was not installed as an AppImage, so it cannot replace itself." };
      if (!writable(dirname(image)) || !writable(image)) return { why: "EZPipeline is in a folder it cannot write to." };
      return { kind: "linux", image, staged: join(dirname(image), `.${basename(image)}.update`) };
    }
    return { why: "EZPipeline cannot update itself on this system." };
  }

  async function download(file, to) {
    const w = BrowserWindow.getAllWindows()[0];
    const ctl = new AbortController();
    stop = () => ctl.abort(new Error("Cancelled."));
    let idle;
    const wait = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new Error("The download stopped answering.")), 60_000); };
    wait();
    try {
      const res = await net.fetch(file.url, { signal: ctl.signal });
      if (!res.ok || !res.body) throw new Error(`The download answered ${res.status}.`);
      const total = Number(res.headers.get("content-length")) || 0;
      const hash = createHash("sha256");
      let got = 0, shown = -1;
      const count = new Transform({
        transform(chunk, _enc, done) {
          wait();
          hash.update(chunk);
          got += chunk.length;
          const pct = total ? Math.floor((got * 100) / total) : -1;
          if (pct !== shown) { shown = pct; w?.setProgressBar(pct / 100); set({ phase: "downloading", version: found.version, got, total }); }
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), count, createWriteStream(to));
      if (hash.digest("hex") !== String(file.sha256).toLowerCase()) throw Object.assign(new Error("The download is not the file the release lists: its SHA-256 is different, so it was deleted and nothing changed. This can be a bad connection."), { mismatch: true });
    } finally {
      clearTimeout(idle);
      stop = null;
      w?.setProgressBar(-1);
    }
  }

  // Each returns what installs it: now (and restart), or when the person quits.
  async function prepare(where, version, file) {
    await mkdir(dir, { recursive: true });
    if (where.kind === "mac") {
      const zip = join(dir, "ezpipeline-next.zip"), out = join(dir, "ezpipeline-next");
      await download(file, zip);
      await rm(out, { recursive: true, force: true });
      await run("/usr/bin/ditto", ["-x", "-k", zip, out]);
      const apps = (await readdir(out)).filter((n) => n.endsWith(".app"));
      if (apps.length !== 1) throw new Error("The download does not hold one app.");
      const staged = join(out, apps[0]);
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged]);
      if (await plist(staged, "CFBundleIdentifier") !== await plist(where.bundle, "CFBundleIdentifier")) throw new Error("The download is a different app.");
      if (await plist(staged, "CFBundleShortVersionString") !== version) throw new Error(`The download is not version ${version}.`);
      return (relaunch) => { swap(where.bundle, staged); if (relaunch) app.relaunch({ execPath: where.exe, args: process.argv.slice(1) }); };
    }
    if (where.kind === "win") {
      const exe = join(dir, "ezpipeline-next.exe");
      await download(file, exe);
      return (relaunch) => spawn(exe, ["--updated", "/S", ...(relaunch ? ["--force-run"] : [])], { detached: true, stdio: "ignore" }).unref();
    }
    await download(file, where.staged);
    chmodSync(where.staged, 0o755);
    return (relaunch) => { renameSync(where.staged, where.image); if (relaunch) app.relaunch({ execPath: where.image, args: process.argv.slice(1) }); };
  }

  // The old app steps aside, the new one takes its name, then the old one goes. If the
  // new one cannot take its place, the old one comes back, so there is always an EZPipeline.
  function swap(bundle, staged) {
    const old = `${bundle}.old`;
    rmSync(old, { recursive: true, force: true });
    renameSync(bundle, old);
    try {
      try { renameSync(staged, bundle); } catch (e) { if (e.code !== "EXDEV") throw e; execFileSync("/usr/bin/ditto", [staged, bundle]); }
    } catch (e) {
      rmSync(bundle, { recursive: true, force: true });
      renameSync(old, bundle);
      throw e.code === "EPERM" || e.code === "EACCES"
        ? new Error("macOS did not let EZPipeline replace itself. Allow it in System Settings, Privacy & Security, App Management, then try again.")
        : e;
    }
    rmSync(old, { recursive: true, force: true });
  }

  /** Looks for a newer version. Returns the state it ends in. */
  async function check() {
    if (["checking", "downloading", "ready"].includes(state.phase)) return state;
    set({ phase: "checking" });
    try {
      found = await find();
    } catch (e) {
      set({ phase: "failed", message: `EZPipeline could not check for updates. ${e?.message ?? e}`, page: DOWNLOADS });
      return state;
    }
    if (!found) { set({ phase: "current" }); return state; }
    const where = await here();
    if (where.why) set({ phase: "manual", version: found.version, message: where.why, page: DOWNLOADS });
    else if (!checkable(found.file)) set({ phase: "manual", version: found.version, message: "The release does not list this file's SHA-256, so EZPipeline cannot check the download and will not install it by itself.", page: DOWNLOADS });
    else set({ phase: "available", version: found.version, size: found.file.size ?? null });
    return state;
  }

  async function get() {
    if (state.phase !== "available" && state.phase !== "failed") return;
    if (!found) return;
    const where = await here();
    if (where.why) return set({ phase: "manual", version: found.version, message: where.why, page: DOWNLOADS });
    set({ phase: "downloading", version: found.version, got: 0, total: 0 });
    try {
      install = await prepare(where, found.version, found.file);
      set({ phase: "ready", version: found.version });
    } catch (e) {
      // Nothing half-downloaded or refused is kept.
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      if (where.staged) await rm(where.staged, { force: true }).catch(() => {});
      set({ phase: "failed", version: found.version, message: String(e?.message ?? e), mismatch: !!e?.mismatch, page: DOWNLOADS });
    }
  }

  function restart() {
    const go = install;
    if (!go) return;
    install = null;
    clearInterval(afterRuns);
    afterRuns = null;
    try { go(true); } catch (e) { set({ phase: "failed", version: found?.version, message: `EZPipeline could not install the update. ${e?.message ?? e}`, page: DOWNLOADS }); return; }
    quit(0);
  }

  function setAuto(on) {
    try { writeFileSync(prefsFile, JSON.stringify({ ...prefs(), auto: on })); } catch { /* the default next launch */ }
    clearInterval(timer);
    if (on) timer = setInterval(() => void check(), HOURS6);
  }

  return {
    get state() { return state; },
    get auto() { return prefs().auto !== false; },
    check,
    /** Download what check() found. */
    download: () => get(),
    cancel: () => stop?.(),
    /** Restart into the new version now, or once no run is going (whenIdle). */
    restart({ whenIdle = false } = {}) {
      if (state.phase !== "ready") return;
      if (!whenIdle || busy() === 0) return restart();
      set({ ...state, waiting: true });
      clearInterval(afterRuns);
      afterRuns = setInterval(() => { if (busy() === 0) restart(); }, 3000);
    },
    dismiss() { if (["available", "failed", "manual", "current"].includes(state.phase)) set({ phase: "idle" }); },
    setAuto,
    /** After the window opens: tidy what an earlier update left, then check now and every 6 hours. */
    start() {
      rm(dir, { recursive: true, force: true }).catch(() => {});
      here().then((where) => {
        if (where.kind === "mac") return rm(`${where.bundle}.old`, { recursive: true, force: true });
        if (where.kind === "linux") return rm(where.staged, { force: true });
      }).catch(() => {});
      if (prefs().auto !== false && app.isPackaged) { setTimeout(() => void check(), 10_000); setAuto(true); }
    },
    /** On quit: a downloaded update goes in now, without a restart. */
    finish() {
      const go = install;
      install = null;
      if (go) try { go(false); } catch (e) { console.error("[update] install on quit:", e?.message ?? e); }
    },
  };
}
