// Builds the installers, and SHA256SUMS.txt beside them (the updater checks downloads
// against it). Both native modules are N-API with a build for each system (stage.mjs),
// so one Mac can build all three systems.
//
//   node scripts/dist.mjs                          this system, its usual chips
//   node scripts/dist.mjs --platform linux         another system
//   node scripts/dist.mjs --platform darwin --arch arm64
//   node scripts/dist.mjs --all                    macOS, Windows and Linux
//
// Out: dist/ezpipeline-<version>-<mac|win|linux>-<arch>.<dmg|zip|exe|AppImage>

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const CHIPS = { darwin: ["arm64", "x64"], win32: ["x64"], linux: ["x64", "arm64"] };
const FLAG = { darwin: "--mac", win32: "--win", linux: "--linux" };
const platforms = argv.includes("--all") ? Object.keys(CHIPS) : [opt("platform") ?? process.platform];
const version = JSON.parse(readFileSync(join(desktop, "../../package.json"), "utf8")).version;
const builder = join(desktop, "node_modules/.bin/electron-builder");

let built = false;
for (const platform of platforms) {
  for (const arch of opt("arch")?.split(",") ?? CHIPS[platform]) {
    console.log(`\n== ${platform}-${arch} ==`);
    execFileSync(process.execPath, [join(desktop, "scripts/stage.mjs"), "--platform", platform, "--arch", arch, ...(built ? ["--skip-build"] : [])], { stdio: "inherit" });
    built = true;
    execFileSync(builder, [FLAG[platform], `--${arch}`, "--publish", "never", `-c.extraMetadata.version=${version}`], { cwd: desktop, stdio: "inherit" });
  }
}

// One SHA256SUMS.txt for every installer of this version in dist/.
const sha = (f) => new Promise((ok, fail) => { const h = createHash("sha256"); createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", fail); });
const dist = join(desktop, "dist");
const files = readdirSync(dist).filter((f) => f.startsWith(`ezpipeline-${version}-`) && /\.(dmg|zip|exe|AppImage)$/.test(f)).sort();
const lines = [];
for (const f of files) lines.push(`${await sha(join(dist, f))}  ${f}`);
writeFileSync(join(dist, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log(`\n${files.length} installers for ${version}, and SHA256SUMS.txt, in ${dist}`);
