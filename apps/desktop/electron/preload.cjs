// What the pages in the window may ask of the app: no more than this. It is the same for
// the app's own pages (first launch, About) and for the EZPipeline the window shows,
// which may be a server somewhere else; main.mjs checks where each request came from.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, cb) => {
  const h = (_e, v) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld("ezpDesktop", {
  platform: process.platform,
  /** { version, electron, node, mode, server, dataDir, logsDir, instance } */
  info: () => ipcRenderer.invoke("ezp:info"),

  // First launch.
  probe: (url) => ipcRenderer.invoke("ezp:probe", url),
  choose: (choice) => ipcRenderer.invoke("ezp:choose", choice),
  onStarting: (cb) => on("ezp:starting", cb),

  // Updates (the card at the foot of the sidebar, and About).
  update: {
    state: () => ipcRenderer.invoke("ezp:update", "state"),
    check: () => ipcRenderer.invoke("ezp:update", "check"),
    download: () => ipcRenderer.invoke("ezp:update", "download"),
    cancel: () => ipcRenderer.invoke("ezp:update", "cancel"),
    restart: (whenIdle) => ipcRenderer.invoke("ezp:update", whenIdle ? "restart-idle" : "restart"),
    dismiss: () => ipcRenderer.invoke("ezp:update", "dismiss"),
    onChange: (cb) => on("ezp:update", cb),
  },

  /** Connected to a server elsewhere: the page tells the tray what is running. */
  reportState: (s) => ipcRenderer.send("ezp:state", s),
  changeServer: () => ipcRenderer.invoke("ezp:change-server"),
  showDataFolder: () => ipcRenderer.invoke("ezp:show-data"),
  showLog: () => ipcRenderer.invoke("ezp:show-log"),
  openExternal: (url) => ipcRenderer.invoke("ezp:open-external", url),
});
