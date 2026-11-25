// The menu bar (tray) icon and its menu (design sheet f152).
//
// The icon is the E-Z path inside a ring:
//   idle      nothing running (a template image on a Mac: it takes the menu bar's colour)
//   running   the ring fills sky as the furthest-along run finishes its steps
//   waiting   an amber dot: a run waits on a person (an approval gate)
//   failed    rose: a run failed, until you open it or the window
//   stopped   greyed: the server on this computer is not running
// The Dock shows how many runs want you as a badge; the Windows taskbar a dot.
//
// The state comes from the server on this computer (GET /api/desktop/state with the app's
// token, so it works with no window open) or, when connected to a server elsewhere, from
// the page in the window (preload: ezpDesktop.reportState).

import { join } from "node:path";

const ago = (iso) => { const t = Date.parse(String(iso).replace(" ", "T") + (String(iso).endsWith("Z") ? "" : "Z")); return Number.isFinite(t) ? t : 0; };

/**
 * @param e  { app, Tray, Menu, nativeImage, Notification }
 * @param o  { icons, where: () => string, openRun(id), openWindow(path?), runPipeline(), checkUpdates(), quit(), loginItem: {get,set}, notify: {get,set}, update: () => state }
 */
export function createTray({ app, Tray, Menu, nativeImage, Notification }, o) {
  const mac = process.platform === "darwin";
  let tray = null;
  let state = { instance: "EZPipeline", running: [], waiting: [], failed: [] };
  let server = "running";
  let ackAt = Date.now();            // failures before this are seen
  const told = new Set();            // runs a notification was shown for
  let first = true;

  const img = (name) => {
    const i = nativeImage.createFromPath(join(o.icons, `tray-${name}.png`));
    if (mac && (name === "idle" || name === "stopped")) i.setTemplateImage(true);
    return i;
  };
  const unseen = () => state.failed.filter((f) => ago(f.endedAt) > ackAt);

  function iconName() {
    if (server !== "running") return "stopped";
    if (unseen().length) return "fail";
    if (state.waiting.length) return "wait";
    if (state.running.length) {
      const pct = Math.max(...state.running.map((r) => r.percent || 0));
      return `run-${Math.min(8, Math.max(0, Math.round(pct / 12.5)))}`;
    }
    return "idle";
  }

  function tooltip() {
    if (server !== "running") return `EZPipeline: the server is ${server}`;
    const bits = [];
    if (state.running.length) bits.push(`${state.running.length} running`);
    if (state.waiting.length) bits.push(`${state.waiting.length} waiting on you`);
    if (unseen().length) bits.push(`${unseen().length} failed`);
    return `${state.instance}: ${bits.join(", ") || "nothing running"}`;
  }

  function menu() {
    const sep = { type: "separator" };
    const runLabel = (r) => `${r.pipeline} #${r.number}`;
    const items = [
      { label: state.instance, enabled: false },
      { label: `${o.where()} · ${server === "running" ? "server running" : `server ${server}`}`, enabled: false },
      sep,
    ];
    if (state.running.length) {
      items.push({ label: `Running · ${state.running.length}`, enabled: false });
      for (const r of state.running.slice(0, 5)) items.push({ label: `${runLabel(r)}  —  ${r.step ?? "starting"} · ${r.percent}%`, click: () => o.openRun(r.id) });
    }
    if (state.waiting.length) {
      items.push({ label: `Waiting on you · ${state.waiting.length}`, enabled: false });
      for (const r of state.waiting.slice(0, 5)) items.push({ label: `${runLabel(r)}  —  Review…`, click: () => o.openRun(r.id) });
    }
    if (unseen().length) {
      items.push({ label: `Failed · ${unseen().length}`, enabled: false });
      for (const r of unseen().slice(0, 3)) items.push({ label: `${runLabel(r)}  —  at ${r.step ?? "the start"}`, click: () => { o.openRun(r.id); seen(); } });
    }
    if (items.length > 3) items.push(sep);
    const u = o.update();
    items.push(
      { label: "Open EZPipeline", accelerator: mac ? "Cmd+O" : "Ctrl+O", click: () => o.openWindow() },
      { label: "Run a pipeline…", click: () => o.runPipeline() },
      sep,
      { label: "Open at login", type: "checkbox", checked: o.loginItem.get(), click: (i) => o.loginItem.set(i.checked) },
      { label: "Notify me when a run fails or waits", type: "checkbox", checked: o.notify.get(), click: (i) => o.notify.set(i.checked) },
      u.phase === "ready" ? { label: `Restart to update to ${u.version}`, click: () => o.restartToUpdate() }
        : u.phase === "available" ? { label: `Download ${u.version}`, click: () => o.downloadUpdate() }
        : u.phase === "downloading" ? { label: `Downloading ${u.version}…`, enabled: false }
        : { label: "Check for updates…", click: () => o.checkUpdates() },
      sep,
      { label: "Quit EZPipeline", accelerator: mac ? "Cmd+Q" : "Ctrl+Q", click: () => o.quit() },
    );
    return Menu.buildFromTemplate(items);
  }

  function render() {
    if (!tray) return;
    tray.setImage(img(iconName()));
    tray.setToolTip(tooltip());
    tray.setContextMenu(menu());
    const want = state.waiting.length + unseen().length;
    if (mac) app.dock?.setBadge(want ? String(want) : "");
    else app.setBadgeCount?.(want);
    o.onBadge?.(unseen().length ? "fail" : state.waiting.length ? "wait" : null);
  }

  /** A notification for each run that newly waits or failed; never for what was there at launch. */
  function tell(next) {
    const fresh = [
      ...next.waiting.filter((r) => !told.has(`w${r.id}`)).map((r) => ({ key: `w${r.id}`, r, title: `${r.pipeline} #${r.number} is waiting for you`, body: r.step ? `At ${r.step}. Open it to approve or reject.` : "Open it to approve or reject." })),
      ...next.failed.filter((r) => !told.has(`f${r.id}`) && ago(r.endedAt) > ackAt).map((r) => ({ key: `f${r.id}`, r, title: `${r.pipeline} #${r.number} failed`, body: r.step ? `At ${r.step}.` : "Open it to see why." })),
    ];
    for (const f of fresh) {
      told.add(f.key);
      if (first || !o.notify.get() || !Notification.isSupported()) continue;
      const n = new Notification({ title: f.title, body: f.body, silent: false });
      n.on("click", () => o.openRun(f.r.id));
      n.show();
    }
    first = false;
  }

  /** Failures shown so far are seen: the window was opened. */
  function seen() { ackAt = Date.now(); render(); }

  return {
    start() {
      if (tray) return;
      tray = new Tray(img("idle"));
      // On Windows and Linux a click opens the window; the menu is the right click.
      if (!mac) tray.on("click", () => o.openWindow());
      render();
    },
    set(next) {
      tell(next);
      state = { instance: next.instance || state.instance, running: next.running ?? [], waiting: next.waiting ?? [], failed: next.failed ?? [] };
      render();
    },
    server(s) { server = s; render(); },
    refresh: render,
    seen,
    get busy() { return state.running.length; },
    get state() { return state; },
    destroy() { tray?.destroy(); tray = null; },
  };
}
