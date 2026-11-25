// Puts the server the desktop app runs in stage/server, laid out as the Docker image
// lays it out (see the Dockerfile): the compiled server at apps/server/src, the built
// client at apps/server/public, docs/ beside them, and its production dependencies in
// node_modules. electron-builder copies the folder into the app as resources/server.
//
//   node scripts/stage.mjs                         for this computer
//   node scripts/stage.mjs --arch x64              another chip (a Mac builds both)
//   node scripts/stage.mjs --platform win32 --arch x64
//   node scripts/stage.mjs --skip-build            reuse the last client and server build
//
// The server runs inside Electron's own Node (ELECTRON_RUN_AS_NODE). Its two native
// modules, better-sqlite3 (13+) and bcrypt (6+), are N-API and ship a build for each
// system, so the one Node and Electron both load is already there: nothing is compiled.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const repo = join(desktop, "../..");
const out = join(desktop, "stage/server");

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const platform = opt("platform", process.platform);
const arch = opt("arch", process.arch);
const electron = JSON.parse(readFileSync(join(desktop, "node_modules/electron/package.json"), "utf8")).version;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

if (!["darwin", "win32", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) {
  console.error(`stage: no desktop build for ${platform}-${arch}.`);
  process.exit(1);
}

// 1. Build the client (into apps/server/public) and the server (into apps/server/compile).
if (!argv.includes("--skip-build")) {
  run(npm, ["run", "build", "-w", "apps/client"], repo);
  run(npm, ["run", "build", "-w", "apps/server"], repo);
}
for (const need of ["apps/server/compile/src/server.js", "apps/server/public/index.html"]) {
  if (!existsSync(join(repo, need))) { console.error(`stage: ${need} is missing. Run without --skip-build.`); process.exit(1); }
}

// 2. Lay it out.
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "apps/server"), { recursive: true });
cpSync(join(repo, "apps/server/compile/src"), join(out, "apps/server/src"), { recursive: true });
cpSync(join(repo, "apps/server/public"), join(out, "apps/server/public"), { recursive: true });
cpSync(join(repo, "docs"), join(out, "docs"), { recursive: true });

const server = JSON.parse(readFileSync(join(repo, "apps/server/package.json"), "utf8"));
const deps = Object.fromEntries(Object.entries(server.dependencies).filter(([n]) => !n.startsWith("@types/")));
// One version for everything: the repo's package.json. The app's own must say the same,
// since an installed app reports it and the updater compares it.
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const appVersion = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version;
if (appVersion !== version) { console.error(`stage: apps/desktop/package.json says ${appVersion}, the repo says ${version}. Make them the same.`); process.exit(1); }
// type: module at both levels: the compiled server is ES modules.
writeFileSync(join(out, "apps/server/package.json"), JSON.stringify({ name: "server", private: true, type: "module", version }, null, 2));
// Read at start (config/index.ts); empty, so the defaults and the app's environment decide.
writeFileSync(join(out, "ezpipeline.config.json"), "{}\n");

// 3. Production dependencies, for the target system. The repo's lock pins the same tree the
// Docker image gets, so the versions match what the tests ran against.
const lock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8")).packages;
const pinned = Object.fromEntries(Object.keys(deps).map((n) => [n, lock[`node_modules/${n}`]?.version ?? deps[n]]));
writeFileSync(join(out, "package.json"), JSON.stringify({ name: "ezpipeline-server", private: true, type: "module", version, dependencies: pinned }, null, 2));
run(npm, ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", "--workspaces=false"], out, { npm_config_platform: platform, npm_config_arch: arch });

// 4. Check the native modules have a build for the target. Both are N-API, so the same
// file loads in Node and in Electron, and one machine can stage every system.
const prebuilt = {
  "better-sqlite3": `prebuilds/${platform}-${arch}.node`,
  // Linux has a glibc and a musl build; the AppImage uses glibc.
  bcrypt: platform === "linux" ? `prebuilds/${platform}-${arch}/bcrypt.glibc.node` : `prebuilds/${platform}-${arch}/bcrypt.node`,
};
for (const [mod, file] of Object.entries(prebuilt)) {
  if (!existsSync(join(out, "node_modules", mod, file))) { console.error(`stage: ${mod} has no build for ${platform}-${arch} (${file}).`); process.exit(1); }
}
// Builds for the other systems are not needed in this one's app.
for (const mod of Object.keys(prebuilt)) {
  for (const f of readdirSync(join(out, "node_modules", mod, "prebuilds"))) {
    if (!f.startsWith(`${platform}-${arch}`)) rmSync(join(out, "node_modules", mod, "prebuilds", f), { recursive: true, force: true });
  }
  for (const junk of ["deps", "src", "build"]) if (mod === "better-sqlite3") rmSync(join(out, "node_modules", mod, junk), { recursive: true, force: true });
}

// What is here, for the smoke test and anyone opening the folder.
writeFileSync(join(out, "STAGED.json"), JSON.stringify({ version, platform, arch, electron, at: new Date().toISOString() }, null, 2));
console.log(`stage: server ${version} for ${platform}-${arch}, Electron ${electron}, in ${out}`);
