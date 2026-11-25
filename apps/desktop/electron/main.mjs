// The EZPipeline desktop app (design sheet section 17, f149–f154).
//
//   node scripts/launch.mjs                 dev: the repo's server (TypeScript, the machine's Node)
//   node scripts/launch.mjs --prod          the staged server (stage/server), as an installed app runs it
//   node scripts/launch.mjs --prod --smoke  start, load the page, ask the server, print, exit
//
// Two ways to run, chosen at first launch and changed with EZPipeline › Change Server…:
//   On this computer   the app starts its own server (server.mjs) on 127.0.0.1, with its
//                      data in userData. Closing the window leaves it running in the menu
//                      bar or tray, so schedules and watches still run.
//   Connect to a server  the window shows an EZPipeline that runs elsewhere. The app is a
//                      window onto it; quitting stops nothing there.

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, session, shell, Tray } from "electron";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLocalServer } from "./server.mjs";
import { createTray } from "./tray.mjs";
import { createUpdater } from "./update.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const args = new Set(process.argv.slice(app.isPackaged ? 1 : 2));
const packaged = app.isPackaged;
const prod = packaged || args.has("--prod");
const smoke = args.has("--smoke");
const mac = process.platform === "darwin";
// Run from the repo, Electron reports its own version: the app's is in package.json.
const VERSION = packaged ? app.getVersion() : JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;

// Name first: userData comes from it. A dev copy keeps its data apart from an installed one.
app.setName(prod ? "EZPipeline" : "EZPipeline Dev");
if (smoke) app.setPath("userData", mkdtempSync(join(tmpdir(), "ezp-smoke-")));
else if (process.env.EZP_USER_DATA) app.setPath("userData", process.env.EZP_USER_DATA);

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => void openWindow());
if (process.env.EZP_NO_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");

const userData = app.getPath("userData");
const UI = join(here, "ui");
const UI_URL = pathToFileURL(UI).href;
const PRELOAD = join(here, "preload.cjs");
const ICONS = join(here, "icons");

// ---------------------------------------------------------------------------
// What the person chose, kept in userData/desktop.json.
const configFile = join(userData, "desktop.json");
const readConfig = () => { try { return JSON.parse(readFileSync(configFile, "utf8")); } catch { return {}; } };
let config = readConfig();
const saveConfig = (patch) => { config = { ...config, ...patch }; mkdirSync(userData, { recursive: true }); writeFileSync(configFile, JSON.stringify(config, null, 2)); };

// ---------------------------------------------------------------------------
// A log per launch, kept in userData/logs: a desktop app has no console anyone reads.
let logFile = "", logStream, logged = 0;
function startLog() {
  try {
    const dir = join(userData, "logs");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "desktop.log");
    try { renameSync(logFile, logFile.replace(/\.log$/, ".old.log")); } catch { /* first launch */ }
    logStream = createWriteStream(logFile, { flags: "w" });
    logStream.on("error", () => { logStream = undefined; });
  } catch { /* nowhere to write */ }
}
function log(text) {
  if (process.env.EZP_DEBUG) process.stderr.write(String(text).endsWith("\n") ? String(text) : `${text}\n`);
  if (!logStream || logged > 5 * 1024 ** 2) return;
  const s = String(text);
  logged += s.length;
  logStream.write(s.endsWith("\n") ? s : `${s}\n`);
}

// ---------------------------------------------------------------------------
let server = null;       // the local server, when running on this computer
let origin = "";         // what the window shows: http://127.0.0.1:<port>, or the server's
let win = null;
let tray = null;
let poll = null;
let quitting = false, quitWhenDone = null;

const mode = () => (smoke ? "local" : config.mode);
const where = () => (mode() === "local" ? "This computer" : (() => { try { return new URL(origin).host; } catch { return "a server"; } })());

const updater = createUpdater({ app, net, BrowserWindow }, {
  version: VERSION,
  quit: () => void reallyQuit(),
  busy: () => tray?.busy ?? 0,
  onChange: (s) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send("ezp:update", s); tray?.refresh(); },
});

/** Requests from a page the app trusts: its own pages, or the EZPipeline the window shows. */
function trusted(e) {
  const u = e.senderFrame?.url ?? "";
  return u.startsWith(UI_URL) || (!!origin && (u === origin || u.startsWith(`${origin}/`)));
}

function makeWindow({ width = 1360, height = 860, about = false } = {}) {
  const w = new BrowserWindow({
    width, height,
    minWidth: about ? width : 900, minHeight: about ? height : 600,
    resizable: !about, maximizable: !about, fullscreenable: !about,
    show: false,
    title: about ? "About EZPipeline" : "EZPipeline",
    backgroundColor: "#09090b",
    // The Mac title bar is drawn by the page (DesktopTitleBar), with the lights over it.
    ...(mac ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 13 } } : { autoHideMenuBar: about }),
    icon: mac ? undefined : join(here, "../build/icon.png"),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  // No second windows, and nothing navigates off EZPipeline: links elsewhere open in the browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(UI_URL) || (origin && (url === origin || url.startsWith(`${origin}/`)))) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  w.once("ready-to-show", () => { if (!smoke) w.show(); });
  w.webContents.on("did-fail-load", (_e, code, desc, url) => log(`did-fail-load ${code} ${desc} ${url}`));
  return w;
}

/** The window, made if it was closed, at a path in the app (/runs/<id>). */
async function openWindow(path) {
  if (!win || win.isDestroyed()) {
    win = makeWindow();
    win.on("focus", () => tray?.seen());
    win.on("closed", () => { win = null; });
    if (!origin) { await win.loadFile(join(UI, "first-run.html")); return; }
    await win.loadURL(origin + (path ?? "/"));
  } else if (path && origin) {
    // In the page, without a reload: React Router listens for popstate.
    const ok = await win.webContents.executeJavaScript(`(() => { if (location.origin !== ${JSON.stringify(origin)}) return false; history.pushState({}, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate")); return true; })()`).catch(() => false);
    if (!ok) await win.loadURL(origin + path);
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

// ---------------------------------------------------------------------------
// Running on this computer.
function starting(step) { win?.webContents.send("ezp:starting", step); }

async function startLocal() {
  const fresh = !readConfig().started;
  starting({ step: "data" });
  server = createLocalServer({
    dir: packaged ? join(process.resourcesPath, "server") : join(here, "../stage/server"),
    dev: !prod,
    repo,
    userData,
    version: VERSION,
    log,
    onState: (s, err) => {
      log(`server ${s}`);
      tray?.server(s === "running" ? "running" : s === "crashed" ? "stopped" : s);
      if (s === "starting") starting({ step: "server" });
      if (s === "crashed") void failed(err);
    },
  });
  starting({ step: "database" });
  await server.start();
  origin = server.origin;
  if (fresh) saveConfig({ started: new Date().toISOString() });
  starting({ step: "done" });
  // The tray asks the server every few seconds, with the token only this app has.
  clearInterval(poll);
  poll = setInterval(async () => {
    if (!server?.running) return;
    try {
      const r = await fetch(`${origin}/api/desktop/state`, { headers: { "x-ezp-desktop-token": server.token }, signal: AbortSignal.timeout(4000) });
      if (r.ok) tray?.set(await r.json());
    } catch { /* restarting */ }
  }, 2500);
}

/** Connect: is there an EZPipeline at this address? */
async function probe(raw) {
  let u;
  try {
    const s = String(raw ?? "").trim();
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch { return { ok: false, message: "That is not a web address. It looks like https://pipelines.example.com." }; }
  const at = u.origin;
  try {
    const r = await net.fetch(`${at}/api/instance`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    const j = r.ok ? await r.json().catch(() => null) : null;
    if (!j || (j.app !== "ezpipeline" && typeof j.name !== "string")) return { ok: false, message: `Something answered at ${at}, but it is not EZPipeline.` };
    return { ok: true, origin: at, name: j.name || "EZPipeline", version: j.version ?? null, secure: u.protocol === "https:" };
  } catch (e) {
    const cert = /CERT|SSL|certificate/i.test(String(e?.message ?? e) + String(e?.cause ?? ""));
    return { ok: false, message: cert ? `${at} answered, but its HTTPS certificate is not valid.` : `Nothing answered at ${at}. Check the address, and that this computer can reach it.` };
  }
}

async function failed(e) {
  console.error(String(e?.stack ?? e));
  log(`EZPipeline could not start: ${e?.stack ?? e}`);
  if (smoke) return reallyQuit(1);
  const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: "error", title: "EZPipeline", message: "EZPipeline could not start its server",
    detail: `${e?.say ?? "Something went wrong as it started."}${logStream ? `\n\nWhat happened is in its log, ${logFile}.` : ""}`,
    buttons: ["Try Again", ...(logStream ? ["Open the Log"] : []), "Change Server…", "Quit"], defaultId: 0, noLink: true,
  }).catch(() => ({ response: 99 }));
  const b = ["again", ...(logStream ? ["log"] : []), "change", "quit"][response] ?? "quit";
  if (b === "again") { app.relaunch(); return reallyQuit(0); }
  if (b === "log") { await shell.openPath(logFile); return reallyQuit(1); }
  if (b === "change") return changeServer(true);
  return reallyQuit(1);
}

async function changeServer(skipAsk = false) {
  if (!skipAsk) {
    const local = mode() === "local";
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: "question", message: "Change where EZPipeline runs?",
      detail: local ? "The server on this computer stops. Its pipelines and history stay in its data folder, and come back if you choose this computer again." : `This window stops showing ${where()}. Nothing on that server changes.`,
      buttons: ["Change…", "Cancel"], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (response !== 0) return;
  }
  saveConfig({ mode: null, url: null });
  app.relaunch();
  await reallyQuit(0);
}

// ---------------------------------------------------------------------------
// Quitting. A run going on this computer stops with the server, so it asks first.
async function reallyQuit(code = 0) {
  if (quitting && code === 0) return;
  quitting = true;
  clearInterval(poll);
  clearInterval(quitWhenDone);
  tray?.destroy();
  await server?.stop().catch(() => {});
  updater.finish();
  // A smoke run's data was made for it, in the system's temp folder.
  if (smoke) { try { (await import("node:fs")).rmSync(userData, { recursive: true, force: true }); } catch { /* the system clears it */ } }
  app.exit(code);
}

app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  void (async () => {
    const busy = mode() === "local" ? (tray?.busy ?? 0) : 0;
    if (busy && !smoke) {
      const r = tray.state.running[0];
      const { response } = await dialog.showMessageBox(win ?? undefined, {
        type: "warning", message: busy === 1 ? "Quit while a run is going?" : `Quit while ${busy} runs are going?`,
        detail: `${r ? `${r.pipeline} #${r.number} is at ${r.step ?? "its start"}. ` : ""}Quitting stops the server on this computer, and ${busy === 1 ? "the run is" : "the runs are"} marked stopped.`,
        buttons: ["Quit Now", "Quit When It Finishes", "Cancel"], defaultId: 2, cancelId: 2, noLink: true,
      });
      if (response === 2) return;
      if (response === 1) {
        clearInterval(quitWhenDone);
        quitWhenDone = setInterval(() => { if ((tray?.busy ?? 0) === 0) void reallyQuit(0); }, 2000);
        win?.close();
        return;
      }
    }
    await reallyQuit(0);
  })();
});

// Closing the window: on this computer the server keeps running in the tray. Connected
// elsewhere, a Mac keeps the app in the Dock and other systems quit.
app.on("window-all-closed", () => {
  if (quitting || smoke) return;
  if (mode() === "local" && origin) {
    if (!config.toldTray && Notification.isSupported()) {
      saveConfig({ toldTray: true });
      new Notification({ title: "EZPipeline is still running", body: `Schedules and auto deploys keep going. It is in the ${mac ? "menu bar" : "tray"}; Quit is there.` }).show();
    }
    return;
  }
  if (!mac) void reallyQuit(0);
});
app.on("activate", () => void openWindow());

// ---------------------------------------------------------------------------
// What the pages may ask (preload.cjs).
ipcMain.handle("ezp:info", (e) => {
  if (!trusted(e)) return null;
  return {
    version: VERSION, electron: process.versions.electron, node: process.versions.node, platform: process.platform,
    mode: mode() ?? null, where: where(), server: mode() === "local" ? (origin ? origin.replace("http://", "") : null) : origin || null,
    dataDir: server?.dataDir ?? null, logsDir: server?.logsDir ?? null, instance: tray?.state.instance ?? null, update: updater.state,
  };
});
ipcMain.handle("ezp:probe", (e, url) => (trusted(e) ? probe(url) : null));
ipcMain.handle("ezp:choose", async (e, choice) => {
  if (!trusted(e) || !e.senderFrame.url.startsWith(UI_URL) || mode()) return { ok: false };
  if (choice?.mode === "remote") {
    const p = await probe(choice.url);
    if (!p.ok) return p;
    saveConfig({ mode: "remote", url: p.origin });
    origin = p.origin;
    tray.start();
    appMenu();
    tray?.server("running");
    await win.loadURL(origin + "/login");
    return { ok: true };
  }
  saveConfig({ mode: "local" });
  tray.start();
  try {
    await startLocal();
    appMenu();
  } catch (err) {
    saveConfig({ mode: null });
    await failed(err);
    return { ok: false };
  }
  await win.loadURL(origin + (choice?.then === "import" ? "/import" : "/"));
  return { ok: true };
});
ipcMain.handle("ezp:update", async (e, what) => {
  if (!trusted(e)) return null;
  if (what === "check") return updater.check();
  if (what === "download") void updater.download();
  if (what === "cancel") updater.cancel();
  if (what === "restart") updater.restart();
  if (what === "restart-idle") updater.restart({ whenIdle: true });
  if (what === "dismiss") updater.dismiss();
  return updater.state;
});
ipcMain.on("ezp:state", (e, s) => {
  // Only the page of a server elsewhere reports; on this computer the server is asked directly.
  if (!trusted(e) || mode() !== "remote" || !s || typeof s !== "object") return;
  const list = (v) => (Array.isArray(v) ? v.slice(0, 20).map((r) => ({ id: String(r.id ?? ""), pipeline: String(r.pipeline ?? "").slice(0, 120), number: Number(r.number) || 0, step: r.step ? String(r.step).slice(0, 120) : null, percent: Math.max(0, Math.min(100, Number(r.percent) || 0)), endedAt: r.endedAt ? String(r.endedAt) : null })) : []);
  tray?.set({ instance: typeof s.instance === "string" ? s.instance.slice(0, 80) : undefined, running: list(s.running), waiting: list(s.waiting), failed: list(s.failed) });
});
ipcMain.handle("ezp:change-server", (e) => (trusted(e) ? changeServer() : null));
ipcMain.handle("ezp:show-data", (e) => (trusted(e) && server ? shell.openPath(server.dataDir) : null));
ipcMain.handle("ezp:show-log", (e) => (trusted(e) && logFile ? shell.showItemInFolder(logFile) : null));
ipcMain.handle("ezp:open-external", (e, url) => (trusted(e) && /^https:\/\//.test(String(url)) ? shell.openExternal(String(url)) : null));

// ---------------------------------------------------------------------------
let about = null;
function openAbout() {
  if (about && !about.isDestroyed()) { about.focus(); return; }
  about = makeWindow({ width: 460, height: 520, about: true });
  about.on("closed", () => { about = null; });
  void about.loadFile(join(UI, "about.html"));
}

function appMenu() {
  const sep = { type: "separator" };
  const go = (path) => () => void openWindow(path);
  const updates = { label: "Check for Updates…", click: () => void checkNow() };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: "EZPipeline", submenu: [
      { label: "About EZPipeline", click: openAbout }, updates, sep,
      { label: "Settings…", accelerator: "Cmd+,", click: go("/settings") },
      { label: "Change Server…", click: () => void changeServer() }, sep,
      { role: "services" }, sep, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, sep, { role: "quit" },
    ] }] : []),
    { label: "File", submenu: [
      { label: "Open EZPipeline", accelerator: "CmdOrCtrl+O", click: go() },
      { label: "Run a Pipeline…", accelerator: "CmdOrCtrl+R", click: go("/pipelines") },
      { label: "Import a Bundle…", click: go("/import") }, sep,
      ...(mac ? [{ role: "close" }] : [{ label: "Settings", click: go("/settings") }, { label: "Change Server…", click: () => void changeServer() }, sep, { role: "quit" }]),
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, ...(prod ? [] : [{ role: "toggleDevTools" }]), sep, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, sep, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    { role: "help", submenu: [
      { label: "Documentation", click: go("/docs") },
      ...(server ? [{ label: "Show Data Folder", click: () => void shell.openPath(server.dataDir) }] : []),
      ...(logFile ? [{ label: "Show the Log", click: () => shell.showItemInFolder(logFile) }] : []),
      { label: "EZPipeline on GitHub", click: () => void shell.openExternal("https://github.com/seanbrill/EZPIPELINE") },
      ...(mac ? [] : [sep, updates, { label: "About EZPipeline", click: openAbout }]),
    ] },
  ]));
}

/** Check for Updates… from a menu: every outcome gets an answer. */
async function checkNow() {
  const s = await updater.check();
  if (s.phase === "available" || s.phase === "ready") { await openWindow(); return; }
  const msg = s.phase === "current" ? { type: "info", message: "EZPipeline is up to date.", detail: `You have ${s.current}, the newest version.` }
    : { type: s.phase === "failed" ? "warning" : "info", message: s.version ? `EZPipeline ${s.version} is out.` : "EZPipeline could not check for updates.", detail: `${s.message ?? ""}`, page: s.page };
  const { response } = await dialog.showMessageBox(win ?? undefined, { ...msg, buttons: msg.page ? ["Open the Downloads Page", "Close"] : ["OK"], defaultId: 0, noLink: true });
  if (msg.page && response === 0) void shell.openExternal(msg.page);
}

// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  startLog();
  log(`EZPipeline ${VERSION} on ${process.platform}-${process.arch}, Electron ${process.versions.electron}, ${prod ? "prod" : "dev"}, started ${new Date().toString()}`);
  if (mac && !smoke) app.dock?.setIcon(nativeImage.createFromPath(join(here, "../build/icon.png")));
  // Nothing EZPipeline does needs a camera, a microphone or a location.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["clipboard-sanitized-write", "fullscreen", "notifications"].includes(permission)));

  tray = createTray({ app, Tray, Menu, nativeImage, Notification }, {
    icons: ICONS, where,
    openRun: (id) => void openWindow(`/runs/${encodeURIComponent(id)}`),
    openWindow: (p) => void openWindow(p),
    runPipeline: () => void openWindow("/pipelines"),
    checkUpdates: () => void checkNow(),
    downloadUpdate: () => { void openWindow(); void updater.download(); },
    restartToUpdate: () => updater.restart({ whenIdle: true }),
    update: () => updater.state,
    quit: () => app.quit(),
    loginItem: { get: () => app.getLoginItemSettings().openAtLogin, set: (on) => { app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true }); tray.refresh(); } },
    notify: { get: () => config.notify !== false, set: (on) => { saveConfig({ notify: on }); tray.refresh(); } },
    onBadge: (kind) => { if (process.platform === "win32" && win && !win.isDestroyed()) win.setOverlayIcon(kind ? nativeImage.createFromPath(join(ICONS, `overlay-${kind}.png`)) : null, kind === "fail" ? "A run failed" : kind === "wait" ? "A run is waiting for you" : ""); },
  });

  try {
    if (!mode()) {
      // First launch (f149): the page asks, and ezp:choose does the rest.
      appMenu();
      win = makeWindow({ width: 1040, height: 700 });
      win.on("closed", () => { win = null; });
      await win.loadFile(join(UI, "first-run.html"));
      return;
    }
    if (!smoke) tray.start();
    if (mode() === "remote") {
      origin = config.url;
      appMenu();
      await openWindow("/");
    } else {
      // The window first, saying it is starting (f150), then the server.
      if (!smoke) {
        win = makeWindow({ width: 1360, height: 860 });
        win.on("focus", () => tray?.seen());
        win.on("closed", () => { win = null; });
        void win.loadFile(join(UI, "first-run.html"), { query: { view: "starting" } });
      }
      await startLocal();
      appMenu();
      if (smoke) {
        win = makeWindow();
        await win.loadURL(origin);
        const instance = await win.webContents.executeJavaScript("fetch('/api/instance').then(r => r.json())");
        const title = await win.webContents.executeJavaScript("document.title");
        const bridge = await win.webContents.executeJavaScript("typeof window.ezpDesktop?.info");
        const state = await (await fetch(`${origin}/api/desktop/state`, { headers: { "x-ezp-desktop-token": server.token } })).json();
        console.log(JSON.stringify({ smoke: "ok", title, instance, bridge, state }));
        return reallyQuit(instance?.app === "ezpipeline" && bridge === "function" ? 0 : 1);
      }
      await win.loadURL(origin);
    }
    updater.start();
  } catch (e) {
    await failed(e);
  }
});
