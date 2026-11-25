import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Load config
let clientPort = 5173;
let serverPort = 5001;
try {
  const configPath = path.resolve(__dirname, '../../ezpipeline.config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.ports?.client) {
      clientPort = config.ports.client;
    }
    if (config.ports?.server) {
      serverPort = config.ports.server;
    }
  }
} catch (e) {
  console.warn("Could not load ezpipeline.config.json", e);
}
// Set on the command line, it wins: a second server (a worktree, a test run)
// must not have its UI quietly talking to the instance on the config's port.
if (process.env.VITE_SERVER_PORT) serverPort = Number(process.env.VITE_SERVER_PORT);


// ── THE BUILD STAMP THE HEADER SHOWS ───────────────────────────────────────
//
// Asked for after an evening spent unable to answer one question: is the page
// in front of me running the change that was just made? Three fixes went in
// before the real fault was found, and a good part of that time went on
// wondering whether the browser had the new code at all.
//
// ── READ FROM .git, NOT FROM `git` ─────────────────────────────────────────
//
// This runs inside the client container, which has the repository mounted and
// no git binary in it. So the two files that matter are read directly:
// .git/HEAD names the branch, and the branch's ref file holds the commit.
// packed-refs is the fallback for a ref that has been packed away, which is
// the state a freshly cloned repository is in.
//
// ── A BUILD NUMBER, NOT A COMMIT COUNT, AND THE NAME IS THE HONEST ONE ─────
//
// Counting commits means walking the graph through zlib-compressed objects and
// packfiles, which is a git implementation and not a version stamp. The reflog
// has one line per movement of HEAD, so it increments on every commit, and on
// a few other things too: it reads 79 here against 74 actual commits.
//
// That is why it is labelled `b79` rather than `v79`. It is not the number of
// commits and does not claim to be. What it is, is a number that goes up
// whenever the code moves - which is the entire question it exists to answer.
// The commit beside it is the authoritative half.
//
// ── A VIRTUAL MODULE, NOT `define` ─────────────────────────────────────────
//
// `define` is substituted at transform time and frozen for the life of the dev
// server, so the stamp would have been whatever it was when vite started and
// would sit there getting older while the code changed underneath it. A stamp
// that lies about being current is worse than no stamp: it would have answered
// that evening's question confidently and wrongly.
//
// A virtual module can be invalidated. The watcher below does that whenever
// HEAD or a ref moves, and pushes a reload, so the number in the corner is
// always the code being served.
const VERSION_MODULE = 'virtual:app-version';

function readGitStamp(root: string): { build: number; version: string; commit: string; branch: string } {
  // The version is the repo's package.json: one number for the server, this client, the
  // desktop app and the release. git adds which commit, for the tooltip.
  const out = { build: 0, version: 'v0.0.0', commit: 'unknown', branch: 'unknown' };
  try {
    out.version = `v${JSON.parse(fs.readFileSync(path.resolve(root, '../../package.json'), 'utf-8')).version}`;
  } catch {
    // A stamp that cannot be read says so in the corner. It must never be the
    // reason the application fails to build.
  }
  // `git` itself, not .git/HEAD: in a worktree .git is a file pointing elsewhere.
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    out.commit = git('rev-parse', '--short=7', 'HEAD');
    out.branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    out.build = Number(git('rev-list', '--count', 'HEAD')) || 0;
  } catch { /* not a git checkout: a source download */ }
  return out;
}

function appVersionPlugin() {
  return {
    name: 'ezpipeline-app-version',
    resolveId(id: string) {
      return id === VERSION_MODULE ? '\0' + VERSION_MODULE : null;
    },
    load(id: string) {
      if (id !== '\0' + VERSION_MODULE) return null;
      const stamp = readGitStamp(__dirname);
      return `export default ${JSON.stringify(stamp)};`;
    },
    configureServer(server: any) {
      // ── POLLED, BECAUSE THE WATCHER CANNOT SEE THIS ────────────────────
      //
      // The first version added .git to vite's own watcher and invalidated on
      // change. It did nothing, and the test that caught it was simply making
      // a commit and asking the dev server what it thought the stamp was: the
      // repository had moved to b80 and the module still served b79.
      //
      // Two reasons, either of which is enough. Vite ignores **/.git/** by
      // default, so the paths were added to a watcher that discards them. And
      // this runs in a container reading a macOS bind mount, where inotify
      // events are not delivered reliably whatever the watcher is told.
      //
      // Asking git every few seconds is not elegant and it does work, in a
      // worktree too. It is still cheap next to everything else in this process.
      let last = JSON.stringify(readGitStamp(__dirname));
      const timer = setInterval(() => {
        const now = JSON.stringify(readGitStamp(__dirname));
        if (now === last) return;
        last = now;
        const mod = server.moduleGraph.getModuleById('\0' + VERSION_MODULE);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      }, 3000);
      // Or the dev server cannot exit.
      timer.unref?.();
      server.httpServer?.once('close', () => clearInterval(timer));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), appVersionPlugin()],
  server: {
    port: clientPort
  },
  build: {
    outDir: '../../apps/server/public',
    emptyOutDir: true
  },
  define: {
    'import.meta.env.VITE_SERVER_PORT': JSON.stringify(serverPort)
  }
})
