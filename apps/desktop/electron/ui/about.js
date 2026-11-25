// About (f154).
const $ = (id) => document.getElementById(id);
const d = window.ezpDesktop;
if (d?.platform === "darwin") document.body.classList.add("mac");
const GH = "https://github.com/seanbrill/EZPIPELINE";
function upd(s) {
  const t = { current: "Up to date", available: `${s.version} is out`, downloading: `Downloading ${s.version}`, ready: `${s.version} is ready: restart to update`, checking: "Checking…", failed: "Could not check", manual: `${s.version} is out` }[s.phase] ?? "Not checked yet";
  $("upd-text").textContent = t;
  $("upd").className = s.phase === "current" ? "badge ok" : "badge";
}
d.info().then((i) => {
  $("ver").textContent = `Version ${i.version}`;
  $("srv").textContent = i.mode === "local" ? `This computer, ${i.server ?? "127.0.0.1"}` : i.mode === "remote" ? i.server : "Not chosen yet";
  if (i.dataDir) $("data").textContent = i.dataDir; else { $("data").hidden = true; $("data-k").hidden = true; $("show-data").hidden = true; }
  $("built").textContent = `Electron ${i.electron.split(".")[0]} · Node ${i.node.split(".")[0]}`;
  upd(i.update);
  if (i.update.phase === "idle") d.update.check().then(upd);
});
d.update.onChange(upd);
$("show-data").addEventListener("click", () => d.showDataFolder());
$("gh").addEventListener("click", () => d.openExternal(GH));
$("lic").addEventListener("click", () => d.openExternal(`${GH}/blob/main/LICENSE`));
