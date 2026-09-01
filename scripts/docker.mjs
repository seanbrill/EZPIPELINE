#!/usr/bin/env node
// One command to get the whole stack running, on any machine.
//
//   node scripts/docker.mjs            start it (first run builds the images)
//   node scripts/docker.mjs down       stop it
//   node scripts/docker.mjs logs       follow the logs
//   node scripts/docker.mjs rebuild    rebuild the images from scratch
//   node scripts/docker.mjs reset      the above, and delete the data volume
//
// Everything a first-time contributor would otherwise have to be told happens
// here, so that none of it has to be remembered or written down somewhere it
// can go stale.
//
// The port check in the middle is the part worth reading. EZPIPELINE has two
// places that decide a port and only one of them is a variable, so a stack
// that looks configured can be broken in a way nothing at run time reports.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const configPath = join(root, "ezpipeline.config.json");

function run(command, args) {
  // The resolved ports are passed to the CHILD, not just used for the banner.
  //
  // docker-compose.yml interpolates ${CLIENT_PORT} and ${SERVER_PORT} from the
  // environment and falls back to its own literals. This script resolved the
  // ports from ezpipeline.config.json and then spawned compose WITHOUT them,
  // so a port set in the config was ignored: compose bound its own fallback
  // while the banner printed the config's number. The banner was wrong, which
  // is worse than either number on its own.
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, CLIENT_PORT: String(clientPort), SERVER_PORT: String(serverPort) },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function quiet(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Docker is present and actually running
// ---------------------------------------------------------------------------
// `docker --version` answers from the CLI binary alone and says nothing about
// whether the daemon is up, which is the failure people actually hit. `docker
// info` is the one that needs the daemon, so both checks are here with the
// message that matches.
if (!quiet("docker", ["--version"])) {
  fail(
    "Docker is not installed, or is not on your PATH.\n" +
      "Install Docker Desktop from https://www.docker.com/products/docker-desktop,\n" +
      "open it, and wait until it reports 'Running'."
  );
}
if (!quiet("docker", ["compose", "version"])) {
  fail("Docker Compose is missing. Update Docker Desktop to a current version.");
}
if (!quiet("docker", ["info"])) {
  fail(
    "Docker is installed but the daemon is not responding.\n" +
      "Start Docker Desktop and wait until it reports 'Running', then try again."
  );
}

// ---------------------------------------------------------------------------
// Read the two files that hold configuration
// ---------------------------------------------------------------------------
// Deliberately minimal parsing rather than pulling in dotenv: this script runs
// on the HOST, before any container exists, so it cannot rely on anything
// having been installed. Node's own process.loadEnvFile would mutate this
// process's environment, which is not wanted - the values are only being read
// to check them against the config file.
function readEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue; // comments and blank lines
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

const env = readEnvFile(envPath);

if (!existsSync(envPath)) {
  // Not an error. .env only carries optional SMTP settings here, and the
  // server falls back to ezpipeline.config.json for everything else. Saying so
  // is better than either failing or staying silent, because "why is email
  // off" is otherwise a half hour of confusion.
  console.log(
    "\nNo .env at the repository root. That is fine for a first run:\n" +
      "  - ports come from ezpipeline.config.json\n" +
      "  - outbound email stays off until you add SMTP_* settings\n"
  );
}

let config = {};
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  fail(
    `Could not read ezpipeline.config.json at ${configPath}.\n` +
      `  ${error.message}\n` +
      "  The server, the client build and this script all read their ports from it,\n" +
      "  so the stack cannot be started without it."
  );
}

const configuredServerPort = String(config?.ports?.server ?? 5001);
const configuredClientPort = String(config?.ports?.client ?? 5000);

// ---------------------------------------------------------------------------
// The effective ports
// ---------------------------------------------------------------------------
// Precedence: real shell environment, then .env, then ezpipeline.config.json.
// The shell wins so a one-off clash can be stepped around without editing a
// file that is shared with everyone else:
//
//   CLIENT_PORT=5010 node scripts/docker.mjs
//
// Compose interpolates ${CLIENT_PORT} from the same shell environment, so the
// number printed at the end and the number the container publishes cannot
// disagree.
//
// These are computed BEFORE the check below, not after, and that ordering is
// the whole point: an earlier version of this script compared .env against the
// config file and a shell-level SERVER_PORT went straight past it - which is
// precisely the silent breakage the check exists to stop.
const serverPort = process.env.SERVER_PORT || env.SERVER_PORT || configuredServerPort;
const clientPort = process.env.CLIENT_PORT || env.CLIENT_PORT || configuredClientPort;

// ---------------------------------------------------------------------------
// The port check
// ---------------------------------------------------------------------------
// Why this refuses to start rather than warning and continuing.
//
// apps/client/src/config/api.ts builds its API base URL in dev as
// `http://localhost:${import.meta.env.VITE_SERVER_PORT}`, and VITE_SERVER_PORT
// is not an environment variable at all - vite.config.ts injects it with
// `define`, reading ezpipeline.config.json at BUILD time. So the browser
// bundle has the config file's number compiled into it.
//
// If .env and the config file disagree, the server listens on one port and the
// browser calls another. The container is healthy, the logs are clean, the
// page loads, and every request fails with a connection refused that appears
// only in the browser console. Nothing in the stack reports the cause. A stack
// that cannot honour the port you asked for should say so before it starts,
// not pretend.
if (serverPort !== configuredServerPort) {
  fail(
    `SERVER_PORT and ezpipeline.config.json disagree about the server port.\n\n` +
      `  SERVER_PORT               ${serverPort}${process.env.SERVER_PORT ? " (from your shell)" : " (from .env)"}\n` +
      `  ezpipeline.config.json    "ports": { "server": ${configuredServerPort} }\n\n` +
      "  Both have to say the same number today. The dev client's API URL is\n" +
      "  compiled into the browser bundle by a `define` in vite.config.ts that\n" +
      "  reads ezpipeline.config.json, so the browser would keep calling\n" +
      `  http://localhost:${configuredServerPort} while the server listened on ${serverPort},\n` +
      "  and the only sign would be failed requests in the browser console.\n\n" +
      `  Fix: set "ports": { "server": ${serverPort} } in ezpipeline.config.json,\n` +
      `  or set SERVER_PORT=${configuredServerPort} in .env.`
  );
}

// PORT in .env is a different trap. docker-compose.yml sets PORT for the
// server service from SERVER_PORT, and compose's `environment:` wins over
// `env_file:`, so a PORT line in .env is read by the server on the host and
// ignored inside the container. Silently having two meanings is worse than
// either of them.
if (env.PORT && env.PORT !== configuredServerPort) {
  fail(
    `PORT=${env.PORT} in .env has no effect on the containers and would mislead you.\n\n` +
      "  docker-compose.yml sets PORT for the server service from SERVER_PORT, and\n" +
      "  compose's `environment:` takes precedence over `env_file:`. So the container\n" +
      `  would listen on ${configuredServerPort} regardless, while `+
      "running the server directly on\n" +
      `  your host with npm start would listen on ${env.PORT}.\n\n` +
      "  Fix: remove the PORT line from .env and use SERVER_PORT, which both halves read."
  );
}

// ---------------------------------------------------------------------------
// Are those ports actually free on this machine
// ---------------------------------------------------------------------------
// Docker's own message for a taken port is
//
//   Error response from daemon: ports are not available: exposing port TCP
//   0.0.0.0:5000 -> 127.0.0.1:0: listen tcp 0.0.0.0:5000: bind: address
//   already in use
//
// which names the port and nothing else, and arrives after the images have
// been built and half the containers started. Worse, on macOS the default
// client port 5000 is held by ControlCenter, because AirPlay Receiver listens
// there out of the box - so the very first `docker compose up` on a Mac fails
// with a message that points at Docker rather than at System Settings.
async function whoHolds(port) {
  // lsof is on macOS and most Linux distributions. If it is missing, the check
  // still reports the clash, just without a name for the culprit.
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return null;
  const line = result.stdout.split("\n")[1];
  return line ? line.split(/\s+/).slice(0, 2).join(" pid ") : null;
}

async function isFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(Number(port), "0.0.0.0");
  });
}

// A port this project is ALREADY publishing is not a clash, it is this stack
// still running. Without this, a second `node scripts/docker.mjs` - which is how
// people restart after an edit - would refuse to start over itself and blame
// the port. Compose is asked rather than guessed at, because the answer has to
// be about this project's containers specifically and not about Docker in
// general.
const ownPorts = new Set();
{
  const ps = spawnSync("docker", ["compose", "ps", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
  });
  for (const line of (ps.stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      for (const publisher of JSON.parse(line).Publishers ?? []) {
        if (publisher.PublishedPort) ownPorts.add(String(publisher.PublishedPort));
      }
    } catch {
      // A compose version that formats this differently is not worth failing
      // over. The worst case is the clash check below being too strict, and it
      // tells you exactly how to get past it.
    }
  }
}

const mode = process.argv[2] ?? "up";

// Read the subcommand BEFORE the port preflight below.
// The preflight used to run at module top level, so `down`, `logs` and
// `reset` - none of which bind a port - died on the same conflict as
// `up`. On a stock Mac, where AirPlay Receiver holds 5000, that made the
// stack impossible to STOP with this script: the only way out was raw
// docker compose. A command that tears things down must not require the
// thing it is tearing down to be startable.
const NEEDS_FREE_PORTS = mode === "up" || mode === "rebuild" || mode === "reset";

if (NEEDS_FREE_PORTS)
for (const [name, port] of [["server", serverPort], ["client", clientPort]]) {
  if (ownPorts.has(String(port))) continue;
  if (await isFree(port)) continue;

  const holder = await whoHolds(port);
  const airplay =
    process.platform === "darwin" && String(port) === "5000"
      ? "\n  On macOS this is almost always AirPlay Receiver. Turn it off under\n" +
        "  System Settings > General > AirDrop & Handoff > AirPlay Receiver,\n" +
        "  or pick another port.\n"
      : "";

  fail(
    `Port ${port} is already in use, so the ${name} container cannot publish it.\n\n` +
      (holder ? `  Held by: ${holder}\n` : "") +
      airplay +
      `\n  Either free the port, or start on a different one for this run:\n` +
      `    ${name === "client" ? "CLIENT_PORT" : "SERVER_PORT"}=<port> node scripts/docker.mjs\n` +
      (name === "server"
        ? "\n  A permanent change to the server port also needs ezpipeline.config.json's\n" +
          "  ports.server updated to match, for the reason explained above.\n"
        : "")
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const compose = ["compose"];

if (mode === "down") {
  run("docker", [...compose, "down"]);
  process.exit(0);
}

if (mode === "logs") {
  run("docker", [...compose, "logs", "-f"]);
  process.exit(0);
}

if (mode === "reset") {
  // -v removes the named volume, which is the whole database and every
  // pipeline workspace. It is not recoverable, and it takes the admin account
  // with it: after a reset the app has no users and asks for first-run setup
  // again. Saying so in a log line and doing it anyway is not enough, because
  // `reset` is one keystroke away from `restart`.
  //
  // --yes keeps it usable from a script, where there is nobody to answer.
  const forced = process.argv.includes("--yes") || process.argv.includes("-y");
  if (!forced) {
    if (!process.stdin.isTTY) {
      fail(
        "reset destroys the ezpipeline_data volume and there is no terminal here to confirm it.\n" +
          "  If you are certain, run it again with --yes."
      );
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      "\nThis DESTROYS the ezpipeline_data volume: the database, every pipeline\n" +
        "workspace and all build history. Your admin account goes with it, and\n" +
        "the app will ask you to create a new one.\n\n" +
        'Type "reset" to continue, anything else to stop: '
    );
    rl.close();
    if (answer.trim() !== "reset") {
      console.log("\nStopped. Nothing was removed.\n");
      process.exit(0);
    }
  }
  console.log("\nRemoving containers AND the ezpipeline_data volume (database, pipelines, build history)...\n");
  run("docker", [...compose, "down", "-v"]);
}

if (mode === "rebuild" || mode === "reset") {
  run("docker", [...compose, "build", "--no-cache"]);
}

console.log("\nStarting EZPIPELINE (the first run downloads images and installs packages)...\n");
run("docker", [...compose, "up", "-d", "--build"]);

console.log(
  `\nRunning.\n` +
    `  App        http://localhost:${clientPort}\n` +
    `  Server     http://localhost:${serverPort}\n` +
    `  Health     http://localhost:${serverPort}/health\n\n` +
    `  Logs       node scripts/docker.mjs logs\n` +
    `  Stop       node scripts/docker.mjs down\n\n` +
    `  The container has its own database, separate from the one your host\n` +
    `  server uses. On a first run the app asks you to create the admin account.\n`
);
