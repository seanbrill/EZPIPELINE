// The server, when EZPipeline runs on this computer. It is a CHILD process of the
// app, run by this same Electron binary as plain Node (ELECTRON_RUN_AS_NODE), on
// 127.0.0.1 only, so nothing else on the network can reach it. A crash in it cannot
// take the window down, and the app starts it again.
//
// Admin › Health › Restart works because EZP_SUPERVISED=1: the server exits 0 and
// this starts it again. Any other exit is a crash: it is started again up to three
// times in a minute, then the app says so.

import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, join } from "node:path";

/** The port, if it can be listened on now (0: any free one). */
export function freePort(want = 0) {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(want, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * The same port as last time while it stays free, so a run's links and a browser tab
 * left open still work after a restart. Chosen at random the first time.
 */
export async function serverPort(file) {
  let last = 0;
  try { last = Number(readFileSync(file, "utf8")); } catch { /* first launch */ }
  if (Number.isInteger(last) && last > 1024 && last < 65536) {
    try { return await freePort(last); } catch { /* taken */ }
  }
  const port = await freePort();
  try { writeFileSync(file, String(port)); } catch { /* picked again next launch */ }
  return port;
}

/** The key the server signs sessions with: made once, kept in userData, readable only by you. */
export function jwtSecret(file) {
  try {
    const s = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(s)) return s;
  } catch { /* first launch */ }
  const s = randomBytes(32).toString("hex");
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}

/**
 * The PATH a terminal has. An app opened from the Finder or the Dock gets only
 * /usr/bin:/bin:/usr/sbin:/sbin, so a step that runs `node`, `docker` or anything from
 * Homebrew would not find it. The login shell says what the person really has.
 */
export function loginPath() {
  if (process.platform === "win32") return Promise.resolve(process.env.PATH ?? "");
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return new Promise((resolve) => {
    execFile(shell, ["-ilc", 'printf "__EZP__%s__EZP__" "$PATH"'], { timeout: 5000, env: { ...process.env, TERM: "dumb" } }, (err, out) => {
      const m = /__EZP__(.*?)__EZP__/s.exec(String(out ?? ""));
      const fallback = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(delimiter);
      resolve(!err && m?.[1] ? m[1] : fallback);
    });
  });
}

/**
 * @param o.dir         where the server's files are (resources/server, or stage/server)
 * @param o.dev         run the repo's TypeScript with the machine's Node instead
 * @param o.userData    the app's data folder
 * @param o.log         (text) => void, into the app's log
 * @param o.onState     ("starting"|"running"|"restarting"|"stopped"|"crashed", detail?) => void
 */
export function createServer_({ dir, dev, repo, userData, version, log, onState }) {
  const token = randomBytes(32).toString("hex");
  const dataDir = join(userData, "data");
  const logsDir = join(userData, "logs");
  mkdirSync(dataDir, { recursive: true });
  let child = null, port = 0, quitting = false, crashes = [], tail = "", path = process.env.PATH ?? "";

  function env() {
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: dev ? "development" : "production",
      PORT: String(port),
      EZP_HOST: "127.0.0.1",
      EZP_DATA_DIR: dataDir,
      EZP_LOGS_DIR: logsDir,
      EZP_DESKTOP_TOKEN: token,
      EZP_SUPERVISED: "1",
      EZP_VERSION: version,
      JWT_SECRET: jwtSecret(join(userData, "session-key")),
      PATH: path,
    };
  }

  function start() {
    const cmd = dev
      ? { bin: process.env.EZP_DEV_NODE || "node", args: [join(repo, "node_modules/tsx/dist/cli.mjs"), join(repo, "apps/server/src/server.ts")], cwd: join(repo, "apps/server") }
      : { bin: process.execPath, args: [join(dir, "apps/server/src/server.js")], cwd: join(dir, "apps/server") };
    if (!dev && !existsSync(cmd.args[0])) throw Object.assign(new Error(`No server at ${cmd.args[0]}`), { say: "The part of EZPipeline that runs pipelines is missing from this copy. Download it again." });
    log(`server: ${cmd.bin} ${cmd.args.join(" ")} on 127.0.0.1:${port}, data in ${dataDir}`);
    onState("starting");
    const c = spawn(cmd.bin, cmd.args, { cwd: cmd.cwd, env: env(), stdio: ["ignore", "pipe", "pipe"] });
    const keep = (d) => { tail = (tail + d).slice(-6000); log(String(d)); };
    c.stdout.on("data", keep);
    c.stderr.on("data", keep);
    c.on("exit", (code, signal) => {
      if (child === c) child = null;
      log(`server exited (${code ?? signal})`);
      if (quitting) return onState("stopped");
      // Exit 0 is Admin › Health › Restart asking to be started again.
      if (code === 0) { onState("restarting"); return void boot().catch((e) => onState("crashed", e)); }
      const now = Date.now();
      crashes = crashes.filter((t) => now - t < 60_000).concat(now);
      if (crashes.length > 3) return onState("crashed", Object.assign(new Error(`server exited (${code ?? signal})\n${tail}`), { say: "EZPipeline's server stopped four times in a minute, so it was left stopped." }));
      onState("restarting");
      setTimeout(() => boot().catch((e) => onState("crashed", e)), 1000);
    });
    child = c;
    return c;
  }

  /** Waits for it to answer. A first start makes the database, which can take a few seconds. */
  async function waitFor(c, ms = 90_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (c.exitCode !== null) throw Object.assign(new Error(`server exited (${c.exitCode})\n${tail}`), { say: "EZPipeline's server stopped as it started." });
      try { if ((await fetch(`http://127.0.0.1:${port}/api/instance`)).ok) return; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw Object.assign(new Error(`no answer on ${port} within ${ms}ms\n${tail}`), { say: `EZPipeline's server did not answer within ${ms / 1000} seconds.` });
  }

  async function boot() {
    port = await serverPort(join(userData, "server-port"));
    const c = start();
    await waitFor(c);
    onState("running");
  }

  return {
    token,
    dataDir,
    logsDir,
    get origin() { return `http://127.0.0.1:${port}`; },
    get running() { return !!child && child.exitCode === null; },
    async start() { path = await loginPath(); await boot(); },
    /** Ask nicely, then insist: a run's steps are its children and go with it. */
    stop() {
      quitting = true;
      const c = child;
      if (!c) return Promise.resolve();
      return new Promise((resolve) => {
        const t = setTimeout(() => { c.kill("SIGKILL"); resolve(); }, 4000);
        c.once("exit", () => { clearTimeout(t); resolve(); });
        c.kill("SIGTERM");
      });
    },
    tail: () => tail,
  };
}
export { createServer_ as createLocalServer };
