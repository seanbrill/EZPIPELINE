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

function readGitStamp(root: string): { build: number; commit: string; branch: string } {
  const gitDir = path.resolve(root, '../../.git');
  const out = { build: 0, commit: 'unknown', branch: 'unknown' };
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    const ref = head.startsWith('ref: ') ? head.slice(5).trim() : null;

    if (ref) {
      out.branch = ref.replace(/^refs\/heads\//, '');
      const refFile = path.join(gitDir, ref);
      if (fs.existsSync(refFile)) {
        out.commit = fs.readFileSync(refFile, 'utf-8').trim().slice(0, 7);
      } else {
        // Packed away, which is how a fresh clone stores refs.
        const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf-8');
        const line = packed.split('\n').find(l => l.endsWith(' ' + ref));
        if (line) out.commit = line.split(' ')[0].slice(0, 7);
      }
    } else {
      // Detached HEAD holds the sha itself.
      out.commit = head.slice(0, 7);
      out.branch = 'detached';
    }

    const reflog = path.join(gitDir, 'logs', 'HEAD');
    if (fs.existsSync(reflog)) {
      out.build = fs.readFileSync(reflog, 'utf-8').split('\n').filter(Boolean).length;
    }
  } catch {
    // A stamp that cannot be read says so in the corner. It must never be the
    // reason the application fails to build.
  }
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
      const gitDir = path.resolve(__dirname, '../../.git');
      // HEAD and the reflog cover a commit, a checkout and a reset. The refs
      // directory covers a branch moving under us, which is what a push to
      // main from elsewhere looks like from in here.
      const watched = [
        path.join(gitDir, 'HEAD'),
        path.join(gitDir, 'logs', 'HEAD'),
        path.join(gitDir, 'refs', 'heads'),
      ];
      server.watcher.add(watched);
      const refresh = (file: string) => {
        if (!file.startsWith(gitDir)) return;
        const mod = server.moduleGraph.getModuleById('\0' + VERSION_MODULE);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', refresh);
      server.watcher.on('add', refresh);
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
