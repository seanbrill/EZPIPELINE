// Start Electron with a clean environment (from knitted's launch.mjs).
//
// Editors built on Electron (VS Code and friends) export ELECTRON_RUN_AS_NODE=1 to their
// terminals. Inherited, it makes the electron binary behave as plain Node, and main.mjs
// dies with "does not provide an export named 'BrowserWindow'", which reads like a bug.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electron = require("electron"); // the path of the binary
const main = join(dirname(fileURLToPath(import.meta.url)), "../electron/main.mjs");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const early = process.env.EZP_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
const child = spawn(electron, [...early, main, ...process.argv.slice(2)], { env, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
