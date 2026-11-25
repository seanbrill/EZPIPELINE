/* eslint-disable */
// Landing sections (f36).
// Generated from the design sheet, then wired by hand where marked LIVE.
import Link from "next/link";
import { GITHUB } from "../../lib/site";
import { CopyButton } from "../CopyButton";
import { DownloadButton, ReleaseMeta } from "../Downloads";
export function LandingSections() {
  return (
    <>
<section className="hero">
  <div className="hero-grid"></div><div className="hero-glow"></div>
  <svg viewBox="0 0 1440 680" aria-hidden="true" style={{ position: "absolute", left: "0", top: "-30px", width: "1440px", height: "680px", pointerEvents: "none" }}><defs><linearGradient id="rg" x1="0" x2="1440" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset=".12" stopColor="#34d399" stopOpacity="0" /><stop offset=".3" stopColor="#34d399" stopOpacity=".55" /><stop offset=".7" stopColor="#34d399" stopOpacity=".55" /><stop offset=".9" stopColor="#34d399" stopOpacity="0" /></linearGradient><linearGradient id="pk" x1="0" x2="1"><stop offset="0" stopColor="#6ee7b7" stopOpacity="0" /><stop offset="1" stopColor="#6ee7b7" /></linearGradient></defs><g opacity=".5"><path d="M577 54H313V626H577M313 340H929M731 54H1127L731 626H1111" fill="none" stroke="url(#rg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></g><rect x="700" y="339" width="190" height="2" rx="1" fill="url(#pk)" opacity=".6" /><circle cx="929" cy="340" r="22" fill="#10b981" opacity=".12" /><circle cx="929" cy="340" r="6" fill="#6ee7b7" opacity=".85" /><circle cx="1127" cy="626" r="16" fill="#09090b" stroke="#6ee7b7" strokeOpacity=".6" strokeWidth="2" /><circle cx="1127" cy="626" r="5" fill="#6ee7b7" opacity=".7" /></svg>
  <div className="wrap">
    <Link className="pill" href="/download/"><span className="new">New in 2.0</span><b>A desktop app for macOS, Windows and Linux</b><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg></Link>
    <h1 className="disp"><span className="gw">CI/CD you run</span><br /><span className="ge">yourself.</span></h1>
    <p className="lead">Write a pipeline in YAML. EZPipeline runs each step as a shell command on your own machine and streams the log to your browser as it prints. Free and open source.</p>
    <div className="cta">
      {/* LIVE */}<DownloadButton />
      <a className="btn btn-secondary btn-xl" href={GITHUB}><svg className="ic" viewBox="0 0 24 24"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>View on GitHub</a>
    </div>
    {/* LIVE */}<ReleaseMeta />

    <div className="shot" aria-hidden="true">
      <div className="shot-glow"></div>
      <div className="win">
        <div className="win-bar"><span className="tl"><i></i><i></i><i></i></span><span className="win-title">EZPipeline</span></div>
        <div className="win-body" style={{ height: "680px" }}>
          <aside className="side">
            <span className="logo" style={{ padding: "4px 6px" }}><svg className="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#10b981" /><path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23" fill="none" stroke="#022c22" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 16H20.5L16 22.5H25" fill="none" stroke="#ecfdf5" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6.5" cy="16" r="2.3" fill="#022c22" /><circle cx="6.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="20.5" cy="16" r="2.3" fill="#022c22" /><circle cx="20.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="25" cy="22.5" r="2.65" fill="#022c22" /><circle cx="25" cy="22.5" r="1.5" fill="#ecfdf5" /></svg><span><b>EZ</b>Pipeline</span></span>
            <div className="srch"><svg className="ic ic-sm" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>Search<span className="kbd">⌘K</span></div>
            <span className="nav"><svg className="ic" viewBox="0 0 24 24"><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></svg>Overview</span>
            <span className="nav"><svg className="ic" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></svg>Pipelines</span>
            <span className="nav on"><svg className="ic" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3" /></svg>Runs<span className="n">1</span></span>
            <span className="nav"><svg className="ic" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>Docs</span>
            <div className="eyebrow gl">Groups</div>
            <div className="grp" style={{ color: "var(--text)" }}><span className="dot pulse" style={{ color: "var(--run)" }}></span>4SeasonsWharton</div>
            <div className="grp"><span className="dot" style={{ color: "var(--primary)" }}></span>FileFreak</div>
            <div className="grp"><span className="dot" style={{ color: "var(--primary)" }}></span>Knitted</div>
            <div className="grp"><span className="dot" style={{ color: "var(--primary)" }}></span>Notch.fm</div>
            <div className="grp"><span className="dot" style={{ color: "var(--line-3)" }}></span>PortfolioSite</div>
            <div className="grp"><span className="dot" style={{ color: "var(--line-3)" }}></span>test</div>
            <div className="me"><span className="avatar">SB</span><span>admin</span></div>
          </aside>
          <div style={{ minWidth: "0", display: "flex", flexDirection: "column" }}>
            <div className="top"><div className="crumbs">4SeasonsWharton <svg className="ic ic-sm" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg> <b>4 Seasons Wharton release</b></div><span style={{ marginLeft: "auto" }} className="faint"><svg className="ic" viewBox="0 0 24 24"><path d="M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></svg></span><span className="btn btn-secondary btn-sm"><svg className="ic ic-sm" viewBox="0 0 24 24"><rect width="14" height="14" x="5" y="5" rx="2" /></svg>Cancel run</span></div>
            <div className="mm" style={{ gap: "16px" }}>
              <div className="rh" style={{ alignItems: "center" }}>
                <div><div className="row" style={{ gap: "10px" }}><h4>Run #7</h4><span className="badge env">PROD</span><span className="badge run"><span className="dot pulse"></span>Running · step 4 of 6</span><span className="badge">manual · admin</span></div>
                <div className="sub">Started 11s ago by admin</div></div>
                <span className="mono" style={{ fontSize: "20px", color: "var(--run)" }}>0:11</span>
              </div>
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "14px 16px", border: "1px solid var(--line-2)", borderRadius: "12px", background: "var(--bg-2)" }}>
                <span className="avatar">SB</span>
                <div className="grow">
                  <div style={{ fontSize: "15px", fontWeight: "600", letterSpacing: "-.01em" }}>Pipeline: clone the now-private repository over SSH</div>
                  <div className="row" style={{ gap: "9px", marginTop: "6px", fontSize: "12.5px", whiteSpace: "nowrap" }}><b style={{ fontWeight: "500" }}>Sean Brill</b><span className="faint">authored 2 hours ago</span><span style={{ width: "1px", height: "14px", background: "var(--line-3)" }}></span><span className="chip" style={{ gap: "5px", height: "22px" }}><svg className="ic ic-sm" viewBox="0 0 24 24"><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>main</span><span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--text)", background: "var(--surface-3)", padding: "2px 7px", borderRadius: "5px", fontSize: "11.5px" }}>d2d4fdf<svg className="ic ic-sm" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg></span><span style={{ width: "1px", height: "14px", background: "var(--line-3)" }}></span><span className="mono faint" style={{ fontSize: "11.5px" }}>3 files</span><span className="mono" style={{ fontSize: "11.5px", color: "var(--primary-hi)" }}>+18</span><span className="mono" style={{ fontSize: "11.5px", color: "var(--fail)" }}>−7</span><span style={{ display: "flex", gap: "2px", width: "56px", height: "6px" }}><i style={{ flex: "72", background: "var(--primary)", borderRadius: "2px" }}></i><i style={{ flex: "28", background: "var(--fail)", borderRadius: "2px" }}></i></span></div>
                </div>
                <span style={{ color: "var(--primary-hi)", fontSize: "13px", fontWeight: "500", whiteSpace: "nowrap", alignSelf: "center" }}>View on GitHub ↗</span>
              </div>
              <div className="steps"><i className="ok"></i><i className="ok"></i><i className="ok"></i><i className="run"></i><i></i><i></i></div>
              <div className="rgrid">
                <div className="sl">
                  <div className="si ok"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>Preflight<span className="t">0.6s</span></div>
                  <div className="si ok"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>Fetch photos<span className="t">1.8s</span></div>
                  <div className="si ok"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>Install<span className="t">3.9s</span></div>
                  <div className="si on"><span className="sp-run"></span>Build<span className="t">4.7s</span></div>
                  <div className="si"><span className="o"></span>Deploy to FileFreak Sites</div>
                  <div className="si"><span className="o"></span>Verify</div>
                </div>
                <div className="log">
                  <div className="ln dim"><span className="no">1</span>Loading env file: /app/apps/server/data/.env.global</div>
                  <div className="ln"><span className="no">2</span>🔑 git in this run reads with "4SeasonsWharton-deploy-key", stored on 4SeasonsWharton</div>
                  <div className="ln hd"><span className="no">3</span>Step: Preflight</div>
                  <div className="ln cmd"><span className="no">4</span>$ command -v filefreak &gt;/dev/null || {"{"} echo "MISSING program: filefreak. Install the FileFreak CLI plugin…"; exit 1; {"}"}</div>
                  <div className="ln cmd"><span className="no">5</span>$ filefreak --version</div>
                  <div className="ln"><span className="no">6</span>filefreak 0.34.0</div>
                  <div className="ln cmd"><span className="no">7</span>$ filefreak sites list</div>
                  <div className="ln ok"><span className="no">8</span>✓ Preflight  0.6s</div>
                  <div className="ln hd"><span className="no">9</span>Step: Fetch photos</div>
                  <div className="ln ok"><span className="no">10</span>✓ Fetch photos  1.8s</div>
                  <div className="ln hd"><span className="no">11</span>Step: Install</div>
                  <div className="ln cmd"><span className="no">12</span>$ npm ci</div>
                  <div className="ln"><span className="no">13</span>added 312 packages in 3s</div>
                  <div className="ln ok"><span className="no">14</span>✓ Install  3.9s</div>
                  <div className="ln hd"><span className="no">15</span>Step: Build</div>
                  <div className="ln cmd"><span className="no">16</span>$ npm run build</div>
                  <div className="ln"><span className="no">17</span>✓ 214 modules transformed.</div>
                  <div className="ln"><span className="no">18</span><span className="cur"></span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
<section className="where"><div className="wrap">
  <div className="eyebrow">Runs where you do</div>
  <div className="tiles">
    <div className="tile-os"><b><svg className="ic" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8M12 17v4" /></svg>macOS</b><span>Desktop app</span></div>
    <div className="tile-os"><b><span className="win4"><i></i><i></i><i></i><i></i></span>Windows</b><span>Desktop app</span></div>
    <div className="tile-os"><b><svg className="ic" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></svg>Linux</b><span>AppImage</span></div>
    <div className="tile-os"><b><svg className="ic" viewBox="0 0 24 24"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12M3.29 7 12 12l8.71-5M7.5 4.27l9 5.15" /></svg>Docker</b><span>Server</span></div>
    <div className="tile-os"><b style={{ color: "#FF9900" }}>AWS</b><span>Self-host wizard</span></div>
    <div className="tile-os"><b style={{ color: "#3B9CFF" }}>Azure</b><span>Self-host wizard</span></div>
    <div className="tile-os"><b style={{ color: "#6EA8FE" }}>Google Cloud</b><span>Self-host wizard</span></div>
  </div>
</div></section>
<section className="sec" id="features"><div className="wrap">
  <div className="sh">
    <div><span className="kick"><span className="n">01</span>Live logs</span><h2 className="h2">Watch every step happen,<br />line by line.</h2></div>
    <p className="p">Each line a step prints reaches your browser as it is printed. Every step has its own clock, so a slow build is obvious, and a failure tells you the step, the line and the exit code instead of "something went wrong".</p>
  </div>
  <div className="vig" aria-hidden="true">
    <div className="lv-top" style={{ position: "relative", flexDirection: "column", alignItems: "stretch", gap: "12px" }}>
      <div className="row" style={{ gap: "12px" }}><h4>4 Seasons Wharton release</h4><span className="mono faint">#6</span><span className="badge env">PROD</span><span className="badge fail"><span className="dot"></span>Failed at step 6 of 6</span><span className="faint" style={{ marginLeft: "auto", fontSize: "13px" }}>Triggered by admin · 14s</span></div>
      <div className="row" style={{ gap: "10px", fontSize: "13.5px" }}><span className="chip" style={{ height: "22px", gap: "5px" }}><svg className="ic ic-sm" viewBox="0 0 24 24"><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>main@81edb60</span><span className="muted">Smaller photos on phones: FileFreak's 2048 copy, and a 2x cap on phones</span><span className="faint" style={{ fontSize: "12.5px" }}>· Sean Brill</span></div>
    </div>
    <div className="lv-grid" style={{ position: "relative" }}>
      <div className="gantt">
        <div className="eyebrow" style={{ marginBottom: "8px" }}>Step timeline</div>
        <div className="gr"><span>Preflight</span><span className="tr"><i style={{ left: "0", width: "4.3%" }}></i></span><span className="tm">0.6s</span></div>
        <div className="gr"><span>Fetch photos</span><span className="tr"><i style={{ left: "4.3%", width: "12.9%" }}></i></span><span className="tm">1.8s</span></div>
        <div className="gr"><span>Install</span><span className="tr"><i style={{ left: "17.2%", width: "27.9%" }}></i></span><span className="tm">3.9s</span></div>
        <div className="gr"><span>Build</span><span className="tr"><i style={{ left: "45.1%", width: "22.1%" }}></i></span><span className="tm">3.1s</span></div>
        <div className="gr"><span>Deploy to FileFreak…</span><span className="tr"><i style={{ left: "67.2%", width: "20%" }}></i></span><span className="tm">2.8s</span></div>
        <div className="gr fl"><span>Verify</span><span className="tr"><i className="f" style={{ left: "87.2%", width: "12.8%" }}></i></span><span className="tm">1.8s</span></div>
        <div className="axis"><span></span><div><span>0s</span><span>7s</span><span>14s</span></div><span></span></div>
        <div className="gsum"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></svg><div>Verify exited with code 22 on line 49. Steps 1 to 5 finished; the deploy is live, the check is what failed.</div></div>
      </div>
      <div className="log lv-log">
        <div className="ln hd"><span className="no">40</span>Step: Deploy to FileFreak Sites</div>
        <div className="ln cmd"><span className="no">41</span>$ filefreak sites deploy dist --site 4seasonswharton</div>
        <div className="ln"><span className="no">42</span>Uploading 58 files (12.4 MB)</div>
        <div className="ln"><span className="no">43</span>Deployed 4seasonswharton</div>
        <div className="ln ok"><span className="no">44</span>✓ Deploy to FileFreak Sites  2.8s</div>
        <div className="ln hd"><span className="no">45</span>Step: Verify</div>
        <div className="ln cmd"><span className="no">46</span>$ curl -fsS "$SITE_URL" -o /dev/null</div>
        <div className="ln dim"><span className="no">47</span>  % Total    % Received   Time    Current</div>
        <div className="ln dim"><span className="no">48</span>  0     0    0     0    0:00:01      0</div>
        <div className="ln err"><span className="no">49</span>curl: (22) The requested URL returned error: 503</div>
        <div className="ln err"><span className="no">50</span>✗ Verify failed after 1.8s (exit code 22)</div>
        <div className="ln dim"><span className="no">51</span>Run #6 failed at step 6 of 6 after 14s.</div>
      </div>
    </div>
  </div>
  <div className="f3">
    <div className="row" style={{ alignItems: "flex-start", gap: "14px" }}><span className="icon-tile ok"><svg className="ic" viewBox="0 0 24 24"><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg></span><div><b style={{ fontSize: "16px", fontWeight: "600" }}>Every run shows its commit, from the moment it's pushed</b><p className="muted" style={{ fontSize: "15px", lineHeight: "1.55", marginTop: "4px" }}>Subject, author and diffstat, before the run even starts.</p></div></div>
    <div className="row" style={{ alignItems: "flex-start", gap: "14px" }}><span className="icon-tile ok"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg></span><div><b style={{ fontSize: "16px", fontWeight: "600" }}>Every step timed</b><p className="muted" style={{ fontSize: "15px", lineHeight: "1.55", marginTop: "4px" }}>See where the minutes go, run after run.</p></div></div>
    <div className="row" style={{ alignItems: "flex-start", gap: "14px" }}><span className="icon-tile ok"><svg className="ic" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></svg></span><div><b style={{ fontSize: "16px", fontWeight: "600" }}>Failures point at the line</b><p className="muted" style={{ fontSize: "15px", lineHeight: "1.55", marginTop: "4px" }}>The step, the line number and the exit code, marked in the log.</p></div></div>
  </div>
</div></section>
<section className="sec"><div className="wrap split">
  <div>
    <span className="kick"><span className="n">02</span>Groups</span>
    <h2 className="h2b">A group holds what its pipelines share.</h2>
    <p className="p" style={{ marginTop: "18px" }}>Groups are folders for pipelines, and they nest. Set environment variables, files, git watches and credentials once on the group, and every pipeline in it uses them.</p>
    <ul className="ticks">
      <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Generate a deploy key in the app.</b> An ed25519 key: add its public half to GitHub, keep the private half on your server.</span></li>
      <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Test it.</b> One click says whether the key can read and whether it can push.</span></li>
      <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Auto deploy.</b> Watch a branch and run a pipeline on every new commit.</span></li>
    </ul>
  </div>
  <div className="vig" aria-hidden="true">
    <div style={{ position: "relative", padding: "18px 20px 0", display: "flex", alignItems: "center", gap: "10px" }}><svg className="ic faint" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg><b style={{ fontSize: "15px" }}>FileFreak</b><span className="faint" style={{ fontSize: "12.5px" }}>4 pipelines</span></div>
    <div className="tabs kv-tabs" style={{ position: "relative", marginTop: "8px" }}><span className="tab">Pipelines</span><span className="tab">Environment</span><span className="tab">Resources</span><span className="tab">Auto deploy</span><span className="tab on">Credentials</span></div>
    <div className="kc" style={{ position: "relative" }}>
      <div className="card" style={{ padding: "18px" }}>
        <div className="keyrow"><span className="icon-tile ok"><svg className="ic" viewBox="0 0 24 24"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r=".5" /></svg></span>
          <div className="grow"><h5>FileFreak.io EZPipeline GitHub SSH Key</h5><div className="row" style={{ marginTop: "6px" }}><span className="badge">SSH key · ed25519</span><span className="badge ok"><span className="dot"></span>Can read</span></div></div>
          <span className="btn btn-secondary btn-sm">Test</span></div>
        <div className="pk"><span>ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM2t…kasobGoHG8t8e35uc6pLs ezpipeline: FileFreak.io EZPipeline GitHub SSH Key</span><svg className="ic ic-sm" viewBox="0 0 24 24" style={{ marginLeft: "auto" }}><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg></div>
        <div className="tst"><div className="y"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>Can read</div><div className="n"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>Cannot push</div></div>
        <p className="faint" style={{ fontSize: "12.5px", marginTop: "10px" }}>Can read — all a clone and a watch need. It cannot push.</p>
        <div className="swrow"><span className="switch on"></span><span><b style={{ fontWeight: "500" }}>Use for reading</b> <span className="faint">· pipelines in FileFreak clone with this key</span></span></div>
      </div>
    </div>
  </div>
</div></section>
<section className="sec"><div className="wrap bento">
  <div className="bt">
    <span className="kick"><span className="n">03</span>Approval gates</span>
    <h3>Nothing reaches production until someone says so.</h3>
    <p>A step of <span className="mono" style={{ color: "var(--text)" }}>type: approval</span> pauses the run. Everything before it is done; everything after it waits for a person, who sees exactly which commit they are promoting.</p>
    <div className="stage"><div className="panel ap">
      <div className="ap-step"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>Build<span className="t">6m 41s</span></div>
      <div className="ap-step"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>Deploy to staging<span className="t">1m 12s</span></div>
      <div className="gate">
        <h5><span className="hg"><i></i></span>Promote to production<span className="badge warn" style={{ marginLeft: "auto" }}>Waiting · 4m</span></h5>
        <div className="row" style={{ gap: "8px", marginTop: "10px", whiteSpace: "nowrap" }}><span className="chip" style={{ height: "22px", gap: "5px" }}><svg className="ic ic-sm" viewBox="0 0 24 24"><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>main@34749b8</span><span style={{ fontSize: "12.5px", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>feat(app): SD cards on Android, Check for updates and Update behind app_updates</span></div>
        <div className="row"><span className="btn btn-primary btn-sm"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>Approve and continue</span><span className="btn btn-ghost btn-sm">Cancel run</span></div>
      </div>
      <div className="ap-step" style={{ color: "var(--text-3)" }}><span style={{ width: "16px", height: "16px", border: "1.5px dashed var(--line-3)", borderRadius: "50%", flex: "none" }}></span>Deploy to production</div>
    </div></div>
  </div>
  <div className="bt">
    <span className="kick"><span className="n">04</span>Versions</span>
    <h3>Roll back in one click.</h3>
    <p>Every successful build is archived as a version, with its commit. Rolling back unzips that build and runs the deploy again. The last ten are kept.</p>
    <div className="stage"><div className="panel">
      <div className="vh"><b>FileFreak deploy (prod)</b><span className="faint mono" style={{ fontSize: "11.5px" }}>Versions · 10 kept</span></div>
      <div className="vr" style={{ height: "62px" }}><span className="v">#135</span><div className="grow"><div style={{ color: "var(--text)", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>feat(app): a game controller works the desktop client and the app, behind gamepad, and CLI 0.34.0</div><div className="d" style={{ marginTop: "2px" }}>main@5ad62f7 · Sean Brill · 9m 18s</div></div><span className="badge ok"><span className="dot"></span>Live</span></div>
      <div className="vr hi" style={{ height: "62px" }}><span className="v">#134</span><div className="grow"><div style={{ color: "var(--text)", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>feat(v1): kinds on files.list, SDK 0.20.0, and the pages for what was opened today</div><div className="d" style={{ marginTop: "2px" }}>main@9129f9b · Sean Brill · 12m 22s</div></div><span className="btn btn-secondary btn-sm"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>Roll back</span></div>
      <div className="vr" style={{ height: "44px", color: "var(--text-3)", fontSize: "12.5px", justifyContent: "center" }}>8 older versions</div>
    </div></div>
  </div>
</div></section>
<section className="sec"><div className="wrap split flip">
  <div className="vig" aria-hidden="true">
    <div className="pm-h" style={{ position: "relative" }}><span className="avatar" style={{ background: "linear-gradient(135deg,#c4b5fd,#8b5cf6)", color: "#1e1b4b" }}>JK</span><div className="who grow"><b>Jordan K.</b><span>Member · on FileFreak deploy (prod)</span></div><span className="badge">4 of 7 on</span></div>
    <div style={{ position: "relative" }}>
      <div className="pr"><div className="l"><b>View</b><span>See the pipeline, its runs and status</span></div><span className="switch on"></span></div>
      <div className="pr"><div className="l"><b>Run</b><span>Start a run</span></div><span className="switch on"></span></div>
      <div className="pr"><div className="l"><b>Edit YAML</b><span className="w">Shell access on the host: steps run what this says</span></div><span className="switch"></span></div>
      <div className="pr"><div className="l"><b>Edit environment</b><span>Read and change .env values</span></div><span className="switch"></span></div>
      <div className="pr"><div className="l"><b>View resources</b><span>Files copied into the workspace</span></div><span className="switch on"></span></div>
      <div className="pr"><div className="l"><b>Use AI assistant</b><span>Ask about and change this pipeline</span></div><span className="switch on"></span></div>
      <div className="pr"><div className="l"><b>Use terminal</b><span className="w">An interactive shell on the host</span></div><span className="switch"></span></div>
    </div>
  </div>
  <div>
    <span className="kick"><span className="n">05</span>Permissions</span>
    <h2 className="h2b">Seven permissions, set per pipeline.</h2>
    <p className="p" style={{ marginTop: "18px" }}>Being allowed to run a deploy and being allowed to rewrite it are different things. Give each person exactly what they need, one pipeline at a time.</p>
    <ul className="ticks">
      <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Honest labels.</b> Edit YAML and Use terminal say what they really grant: a shell on the host.</span></li>
      <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Admins and members.</b> The first user is the primary admin and can't be locked out.</span></li>
      <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Email-code MFA</b> when you want a second step at sign-in.</span></li>
    </ul>
  </div>
</div></section>
<section className="sec"><div className="wrap bento">
  <div className="bt">
    <span className="kick"><span className="n">06</span>AI assistant</span>
    <h3>An assistant with a short, written-down reach.</h3>
    <p>Ask why a run failed or have it fix a YAML file. It acts through eleven defined tools, reads variable names but never their values, and has no shell.</p>
    <div className="stage"><div className="panel chat">
      <div className="bub-u">Why did 4 Seasons Wharton release #6 fail?</div>
      <div className="row" style={{ gap: "6px" }}><span className="tool"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>get_build_history</span><span className="tool"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>read_yaml_config</span></div>
      <div className="bub-a"><span className="av"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg></span><span>Verify got a 503 one second after the deploy finished. The site was still starting. I can add <span className="mono">sleep 10</span> before the check in Verify. Change the YAML?</span></div>
      <div className="nos"><span>no shell</span><span>no env values</span><span>can't roll back</span><span>can't delete</span></div>
    </div></div>
  </div>
  <div className="bt">
    <span className="kick"><span className="n">07</span>Plugins</span>
    <h3>Official CLIs, one click to install.</h3>
    <p>Install a plugin and every pipeline can call it. The FileFreak CLI copies files, deploys static sites and keeps folders in step.</p>
    <div className="stage"><div className="panel">
      <div className="pl"><span className="lg ff">FF</span><div className="grow"><b>FileFreak CLI</b><div className="d">Hosting · v0.34.0 · uses FILEFREAK_KEY</div></div><span className="badge ok r"><span className="dot"></span>Installed</span></div>
      <div className="pl"><span className="lg" style={{ color: "#FF9900" }}>AWS</span><div className="grow"><b>AWS CLI</b><div className="d">Cloud</div></div><span className="btn btn-secondary btn-sm r">Install</span></div>
      <div className="pl"><span className="lg" style={{ color: "#6EA8FE" }}>GC</span><div className="grow"><b>Google Cloud CLI <span className="badge ok" style={{ height: "18px", fontSize: "10.5px", marginLeft: "4px" }}>New</span></b><div className="d">Cloud · needed for the GCP wizard</div></div><span className="btn btn-secondary btn-sm r">Install</span></div>
      <div className="pl"><span className="lg">tf</span><div className="grow"><b>Terraform</b><div className="d">Infrastructure</div></div><span className="btn btn-secondary btn-sm r">Install</span></div>
      <div className="inc"><span className="eyebrow">Included</span><span className="chip">Git</span><span className="chip">Docker</span><span className="chip">Node.js</span><span className="chip">Python 3</span><span className="chip">curl</span><span className="chip">OpenSSL</span><span className="chip">SSH</span></div>
    </div></div>
  </div>
</div></section>
<section className="sec"><div className="wrap bento">
  <div className="bt">
    <span className="kick"><span className="n">08</span>Export &amp; import <span className="badge" style={{ height: "18px", fontSize: "10px" }}>v2</span></span>
    <h3>Move an instance, a group or one pipeline.</h3>
    <p>Export to a single file, then import it on another machine and choose what comes with it.</p>
    <div className="stage"><div className="panel ex">
      <div className="row between"><span className="seg"><span>Instance</span><span className="on">Group</span><span>Pipeline</span></span><span className="mono faint">FileFreak</span></div>
      <div className="exl">
        <div><span className="check on"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>Pipelines and their YAML<span className="c">4</span></div>
        <div><span className="check on"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>Environment<span className="c">12 variables</span></div>
        <div><span className="check on"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>Resources<span className="c">3 files</span></div>
        <div><span className="check on"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>Auto deploy watches<span className="c">2</span></div>
        <div><span className="check"></span>Versions<span className="c">412 MB</span></div>
      </div>
      <div className="file"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12M3.29 7 12 12l8.71-5M7.5 4.27l9 5.15" /></svg>FileFreak-2026-11-15.ezpipeline.zip · 2.4 MB</div>
    </div></div>
  </div>
  <div className="bt">
    <span className="kick"><span className="n">09</span>Your own cloud <span className="badge" style={{ height: "18px", fontSize: "10px" }}>v2</span></span>
    <h3>Deploy to AWS, Azure or Google Cloud.</h3>
    <p>The self-host wizard sets up the server in your own account, and lists everything it will create before it creates anything.</p>
    <div className="stage"><div className="panel wz">
      <div className="wzs"><span className="s on"><i>1</i>Provider</span><span className="ln2"></span><span className="s"><i>2</i>Sign in</span><span className="ln2"></span><span className="s"><i>3</i>Size</span><span className="ln2"></span><span className="s"><i>4</i>Review</span></div>
      <div className="clouds">
        <div className="cl on"><b style={{ color: "#FF9900" }}>AWS</b><span>EC2 in your account</span></div>
        <div className="cl"><b style={{ color: "#3B9CFF" }}>Azure</b><span>A VM in your subscription</span></div>
        <div className="cl"><b style={{ color: "#6EA8FE" }}>Google Cloud</b><span>Compute Engine</span></div>
      </div>
      <div className="wzf"><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>Uses your AWS CLI sign-in. Nothing is created until you choose Create on Review.</div>
    </div></div>
  </div>
</div></section>
<section className="sec"><div className="wrap">
  <div className="sh" style={{ marginBottom: "0" }}>
    <div><span className="kick">How it works</span><h2 className="h2">From install to first run<br />in three steps.</h2></div>
    <p className="p">No runners to register and no YAML dialect to learn. A pipeline is a list of named shell commands, run in order, in the pipeline's workspace.</p>
  </div>
  <div className="how">
    <div className="hs">
      <div className="hst"><span className="num">1</span><div><h3>Install it</h3><p>Download the desktop app, or start the server with Docker: <code>node scripts/docker.mjs</code>. Open it and create the first admin.</p></div></div>
      <div className="hst"><span className="num">2</span><div><h3>Write a pipeline</h3><p>One step per shell command. Add an approval step where a person should decide, and put shared settings on the group.</p></div></div>
      <div className="hst"><span className="num">3</span><div><h3>Run it and watch</h3><p>Choose Run, or let a schedule or a new commit start it. The log streams live, and a successful build becomes a version you can roll back to.</p></div></div>
    </div>
    <div className="code">
      <div className="code-h"><span className="tl"><i></i><i></i><i></i></span><span style={{ marginLeft: "8px" }}>4SeasonsWharton / 4 Seasons Wharton release / <b style={{ color: "var(--text)", fontWeight: "500" }}>pipeline.yaml</b></span></div>
      <pre><div className="l"><span className="n">1</span><span><span className="k">appName</span><span className="d">:</span> 4 Seasons Wharton release</span></div><div className="l"><span className="n">2</span><span><span className="k">version</span><span className="d">:</span> 1.0.8</span></div><div className="l"><span className="n">3</span><span><span className="k">environment</span><span className="d">:</span> prod</span></div><div className="l"><span className="n">4</span><span><span className="k">description</span><span className="d">:</span> Build the site and deploy it to FileFreak Sites.</span></div><div className="l"><span className="n">5</span><span><span className="k">steps</span><span className="d">:</span></span></div><div className="l"><span className="n">6</span><span>  <span className="d">-</span> <span className="k">name</span><span className="d">:</span> Preflight</span></div><div className="l"><span className="n">7</span><span>    <span className="k">run</span><span className="d">:</span> filefreak --version</span></div><div className="l"><span className="n">8</span><span>  <span className="d">-</span> <span className="k">name</span><span className="d">:</span> Install</span></div><div className="l"><span className="n">9</span><span>    <span className="k">run</span><span className="d">:</span> npm ci</span></div><div className="l"><span className="n">10</span><span>  <span className="d">-</span> <span className="k">name</span><span className="d">:</span> Build</span></div><div className="l"><span className="n">11</span><span>    <span className="k">run</span><span className="d">:</span> npm run build</span></div><div className="l hl"><span className="n">12</span><span>  <span className="d">-</span> <span className="k">name</span><span className="d">:</span> Promote to production</span></div><div className="l hl"><span className="n">13</span><span>    <span className="k">type</span><span className="d">:</span> <span className="y">approval</span>        <span className="c"># the run waits here for a person</span></span></div><div className="l"><span className="n">14</span><span>  <span className="d">-</span> <span className="k">name</span><span className="d">:</span> Deploy to FileFreak Sites</span></div><div className="l"><span className="n">15</span><span>    <span className="k">run</span><span className="d">:</span> filefreak sites deploy dist --site 4seasonswharton</span></div></pre>
    </div>
  </div>
</div></section>
<section className="sec"><div className="wrap">
  <div className="warnc">
    <span className="icon-tile warn"><svg className="ic ic-lg" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></svg></span>
    <div>
      <span className="eyebrow">Read this before you deploy</span>
      <h3>Steps run on the host, with no isolation.</h3>
      <p>There is no container per step and no remote runner. Steps run as the EZPipeline user, on the machine hosting it. <b>Anyone who can edit a pipeline's YAML can run code on that machine.</b> Put it somewhere you would be willing to give those people a shell, and set a JWT secret before anyone else signs in.</p>
      <div className="cmd"><span className="pr">$</span>JWT_SECRET=$(openssl rand -hex 32)</div>
    </div>
    <Link className="btn btn-secondary" style={{ alignSelf: "center" }} href="/docs/deployment/">Deployment guide<svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg></Link>
  </div>
</div></section>
<section className="sec"><div className="wrap os">
  <div>
    <span className="kick">Open source</span>
    <h2 className="h2">Free, open source,<br />Apache 2.0.</h2>
    <p className="p" style={{ marginTop: "20px", maxWidth: "520px" }}>No account, no seats, no paid tier. Read every line, run it wherever you like and change what you need. The docs say plainly what is built and what is not.</p>
    <div className="osb"><a className="btn btn-secondary btn-lg" href={GITHUB}><svg className="ic" viewBox="0 0 24 24"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>Star on GitHub</a><Link className="btn btn-ghost btn-lg" href="/docs/development/">How to contribute<svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg></Link></div>
  </div>
  <div className="repo">
    <div className="repo-h"><svg className="ic" viewBox="0 0 24 24"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg><span className="muted">seanbrill /</span><b>EZPIPELINE</b><span className="badge" style={{ marginLeft: "6px" }}>Public</span></div>
    <div className="repo-m"><span><svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>Apache-2.0</span><span><svg className="ic ic-sm" viewBox="0 0 24 24"><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>main</span><span>TypeScript · React · Express · SQLite</span></div>
    <div className="cm"><span className="h">a21a5c0</span><span className="m"><b>feat:</b> a deploy key can be made on the Credentials tab, and a group reads with it</span></div>
    <div className="cm"><span className="h">8fb475b</span><span className="m"><b>fix:</b> the dashboard is usable on a phone</span></div>
    <div className="cm"><span className="h">bfd2e5c</span><span className="m"><b>fix:</b> the run's time pill stopped counting the step still running</span></div>
    <div className="cm"><span className="h">a22f73a</span><span className="m"><b>fix:</b> clearing build history no longer kills the server</span></div>
  </div>
</div></section>
<section className="final">
  <div className="hero-grid"></div><div className="fglow"></div>
  <div className="wrap" style={{ position: "relative" }}>
    <svg viewBox="0 0 32 32" aria-hidden="true" style={{ width: "72px", height: "72px", margin: "0 auto 32px", display: "block", filter: "drop-shadow(0 12px 32px rgba(16,185,129,.45))" }}><rect width="32" height="32" rx="9" fill="#10b981" /><path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23" fill="none" stroke="#022c22" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 16H20.5L16 22.5H25" fill="none" stroke="#ecfdf5" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6.5" cy="16" r="2.3" fill="#022c22" /><circle cx="6.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="20.5" cy="16" r="2.3" fill="#022c22" /><circle cx="20.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="25" cy="22.5" r="2.65" fill="#022c22" /><circle cx="25" cy="22.5" r="1.5" fill="#ecfdf5" /></svg>
    <h2><span className="gw">Your pipelines,</span><br /><span className="ge">on your machine.</span></h2>
    <p>Download the app and run your first pipeline in a few minutes. It's free, and it stays that way.</p>
    <div className="cta">{/* LIVE */}<DownloadButton /><Link className="btn btn-secondary btn-xl" href="/download/">All downloads</Link></div>
    <div className="dock"><span className="pr">$</span>git clone https://github.com/seanbrill/EZPIPELINE &amp;&amp; cd EZPIPELINE &amp;&amp; node scripts/docker.mjs<CopyButton className="cp" text="git clone https://github.com/seanbrill/EZPIPELINE && cd EZPIPELINE && node scripts/docker.mjs" /></div>
  </div>
</section>
    </>
  );
}
