// electron-builder's afterPack: puts the staged server (stage/server) in the app as
// resources/server. Not extraResources: that leaves out every node_modules folder, and the
// server cannot run without its dependencies. (A copy built inside the repo still started,
// because Node found the repo's own node_modules by walking up: the test that runs the app
// from outside the repo is the one that caught it.) Runs before the app is signed.

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const stage = join(dirname(fileURLToPath(import.meta.url)), "../stage/server");

export default async function afterPack({ appOutDir, electronPlatformName, packager }) {
  if (!existsSync(join(stage, "node_modules"))) throw new Error("after-pack: stage/server has no node_modules. Run scripts/stage.mjs first.");
  const resources = electronPlatformName === "darwin"
    ? join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents/Resources")
    : join(appOutDir, "resources");
  const to = join(resources, "server");
  rmSync(to, { recursive: true, force: true });
  cpSync(stage, to, { recursive: true, verbatimSymlinks: true });
  console.log(`  • after-pack      server copied  to=${to}`);
}
