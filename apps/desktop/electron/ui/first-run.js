// First launch (f149, f150). The app (main.mjs) does the work; this page asks and shows.
const $ = (id) => document.getElementById(id);
const d = window.ezpDesktop;
if (d?.platform === "darwin") document.body.classList.add("mac");
const show = (id) => { for (const v of ["choose", "starting", "connect"]) $(v).hidden = v !== id; };

let mode = "local";
const opts = [...document.querySelectorAll(".opt")];
function pick(m) {
  mode = m;
  for (const o of opts) o.setAttribute("aria-checked", String(o.dataset.mode === m));
  $("go").textContent = m === "local" ? "Start on this computer" : "Connect to a server…";
  $("go-hint").textContent = m === "local" ? "Takes a few seconds the first time." : "You give the address next.";
}
for (const o of opts) {
  o.addEventListener("click", () => pick(o.dataset.mode));
  o.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = opts[(opts.indexOf(o) + 1) % 2]; n.focus(); pick(n.dataset.mode); } });
}

// Starting: the app says each step as it is done.
const ORDER = ["data", "database", "server", "done"];
function step(s) {
  const at = ORDER.indexOf(s);
  for (const el of document.querySelectorAll(".chk div")) {
    const i = ORDER.indexOf(el.dataset.step);
    el.className = i < at || s === "done" ? "done" : i === at ? "now" : "";
    el.firstElementChild.outerHTML = i < at || s === "done"
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
      : i === at ? '<span class="spin"></span>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
  }
  $("bar").style.width = `${[20, 45, 75, 100][Math.max(0, at)]}%`;
}
d?.onStarting?.((s) => step(s.step));

async function startLocal(then) {
  show("starting");
  step("data");
  const r = await d.choose({ mode: "local", then });
  if (!r?.ok) show("choose");
}
$("go").addEventListener("click", () => { if (mode === "local") void startLocal(); else { show("connect"); $("url").focus(); } });
$("import").addEventListener("click", () => void startLocal("import"));
$("back").addEventListener("click", () => show("choose"));

// Connect: check the address, say what is there, then go.
let checked = null;
$("url").addEventListener("input", () => { checked = null; $("found").hidden = true; $("err").hidden = true; $("connect-go").textContent = "Check this address"; });
$("connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("connect-go");
  btn.disabled = true;
  try {
    if (checked) {
      btn.textContent = "Opening…";
      const r = await d.choose({ mode: "remote", url: checked });
      if (!r?.ok) { $("err-text").textContent = r?.message ?? "It could not be opened."; $("err").hidden = false; btn.textContent = "Check this address"; checked = null; }
      return;
    }
    btn.textContent = "Checking…";
    const p = await d.probe($("url").value);
    if (!p?.ok) { $("err-text").textContent = p?.message ?? "Nothing answered."; $("err").hidden = false; $("found").hidden = true; btn.textContent = "Check this address"; return; }
    checked = p.origin;
    $("found-name").textContent = p.name;
    $("found-meta").textContent = [p.version ? `EZPipeline v${p.version}` : "EZPipeline", p.secure ? "HTTPS" : "Not encrypted (http): only use this on a network you trust"].join(" · ");
    $("found").hidden = false;
    $("err").hidden = true;
    btn.textContent = "Continue to sign in";
  } finally {
    btn.disabled = false;
  }
});

if (new URLSearchParams(location.search).get("view") === "starting") {
  $("start-title").textContent = "Starting EZPipeline";
  $("start-lede").textContent = "The server on this computer is starting.";
  show("starting");
  step("data");
} else {
  show("choose");
  d?.info?.().then((i) => { if (i?.platform === "darwin") $("datadir").textContent = "~/Library/Application Support/EZPipeline"; else if (i?.platform === "win32") $("datadir").textContent = "%APPDATA%\\EZPipeline"; else $("datadir").textContent = "~/.config/EZPipeline"; });
}
