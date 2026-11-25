"use client";
// The Download page: with a release (design f75), or before the first one (f89).
//
// It is built with the release list as it was (content/releases.json) and brought up to date
// in the browser from the release folder (useReleases). The big button is the file for this
// computer; every file, its size and its SHA-256 are listed below it.

import Link from "next/link";
import { useEffect, useState } from "react";
import changelog from "../content/changelog.json";
import releasesFile from "../content/releases.json";
import type { Download as File, Release } from "../lib/downloads";
import { GITHUB } from "../lib/site";
import { CopyButton } from "./CopyButton";
import { Arrow, Book, Box, ChevronDown, ChevronRight, Cloud, Download, External, Folder, GitHub, Info, Monitor, Shield, Star, Terminal, Windows } from "./icons";
import { chipName, systemName, useOffer, useReleases } from "./useDownloads";

const BUILT = releasesFile.releases as Release[];
const NOTES = changelog.entries as { version: string; date: string; notes: [string, string][] }[];
const DOCKER = "git clone https://github.com/seanbrill/EZPIPELINE\ncd EZPIPELINE\nnode scripts/docker.mjs";
const SOURCE = "git clone https://github.com/seanbrill/EZPIPELINE\ncd EZPIPELINE\nnpm run init\nnpm run start";

const short = (sha: string) => (/^[0-9a-f]{64}$/i.test(sha) ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : sha);
const date = (iso?: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const ext = (f: File) => f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
const kind = (f: File) => ({ ".dmg": "disk image", ".exe": "installer", ".msi": "installer", ".appimage": "AppImage", ".deb": ".deb", ".rpm": ".rpm", ".zip": ".zip" })[ext(f)] ?? ext(f);
const archWord = (f: File) => (f.arch === "arm64" ? "arm64" : f.arch === "x64" ? (f.system === "Linux" ? "x86_64" : "x64") : "universal");
/** "macOS · Apple silicon", "Windows", "Linux" */
const title = (f: File) => [f.system, f.system === "macOS" ? chipName(f.platform) : null].filter(Boolean).join(" · ");
const OsIcon = ({ f }: { f: File }) =>
  ext(f) === ".zip" ? <>.zip</> : f.system === "Windows" ? <Windows /> : f.system === "Linux" ? <Terminal size="lg" /> : <Monitor size="lg" />;

/** Download links go to the file; with JavaScript, the install page opens and starts it. */
function useInstallLink() {
  return (f: File) => ({
    href: f.url,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      window.location.assign(`/download/install/?file=${encodeURIComponent(f.name)}`);
    },
  });
}

const ServerCards = ({ cls }: { cls: "sc" | "svc" }) => (
  <div className="srv">
    <div className={cls}><span className="icon-tile ok"><Box /></span><h3>Run it with Docker</h3><p>Checks Docker is running, builds on the first run and starts the stack. Then open localhost:5000 and create the first admin.</p>
      <div className="term">{DOCKER.split("\n").map((l) => <div key={l}><span className="pp">$</span>{l}</div>)}<CopyButton text={DOCKER} /></div>
      <Link className="lnk" href="/docs/deployment/">Deployment guide<Arrow size="sm" /></Link></div>
    {cls === "sc" && (
      <div className={cls}><span className="icon-tile ok"><Cloud /></span><h3>Deploy to your own cloud</h3><p>The self-host wizard in the app sets the server up in your own account, and lists everything it will create before it creates it.</p>
        <div className="cl3"><span style={{ color: "#FF9900" }}>AWS</span><span style={{ color: "#3B9CFF" }}>Azure</span><span style={{ color: "#6EA8FE" }}>Google Cloud</span></div>
        <Link className="lnk" href="/docs/deployment/">How the wizard works<Arrow size="sm" /></Link></div>
    )}
    <div className={cls}><span className="icon-tile ok"><Terminal /></span><h3>From source</h3><p>Node 20 or newer. Set JWT_SECRET in .env before anyone else signs in.{cls === "svc" ? " Then open localhost:5173." : ""}</p>
      <div className="term">{SOURCE.split("\n").map((l) => <div key={l}><span className="pp">$</span>{l}</div>)}<CopyButton text={SOURCE} /></div>
      <Link className="lnk" href="/docs/setup/">Setup guide<Arrow size="sm" /></Link></div>
  </div>
);

const GhLinks = ({ none }: { none: boolean }) => (
  <div className="ghl">
    <a className="gl" href={GITHUB}><span className="icon-tile"><GitHub /></span><div><b>Source code</b><span>seanbrill/EZPIPELINE</span></div><External className="ext" /></a>
    <a className="gl" href={`${GITHUB}/issues`}><span className="icon-tile"><Info /></span><div><b>Issues</b><span>{none ? "Ask about the desktop app" : "Report a problem with a download"}</span></div><External className="ext" /></a>
    <a className="gl" href={`${GITHUB}/releases`}><span className="icon-tile"><Book /></span><div><b>{none ? "Releases" : "Release notes"}</b><span>{none ? "Nothing for 2.0 published yet" : "Every version on GitHub Releases"}</span></div><External className="ext" /></a>
  </div>
);

export function DownloadPage() {
  const releases = useReleases(BUILT);
  return releases.length ? <WithRelease releases={releases} /> : <NoRelease />;
}

function WithRelease({ releases }: { releases: Release[] }) {
  const { offer, label } = useOffer(releases);
  const link = useInstallLink();
  const latest = releases[0];
  const v = latest.version;
  const note = NOTES.find((n) => n.version === v);
  const mine = offer?.kind === "file" ? offer.file : null;
  const zip = mine?.system === "macOS" ? latest.files.find((f) => f.system === "macOS" && f.arch === mine.arch && ext(f) === ".zip" && f !== mine) : null;
  const others = latest.files.filter((f) => f !== mine);
  return (
    <div className="p-dl">
      <section className="dh">
        <div className="hgrid" /><div className="hglow" />
        <svg className="appic" viewBox="0 0 32 32" aria-label="EZPipeline app icon"><rect width="32" height="32" rx="9" fill="#10b981" /><path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H22" fill="none" stroke="#022c22" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="20.5" cy="16" r="2.1" fill="#022c22" /><circle cx="25" cy="22.5" r="2.9" fill="#ecfdf5" stroke="#022c22" strokeWidth="1.9" /></svg>
        <div className="vp"><span className="dot" />v{v}{note ? ` · released ${date(note.date)}` : ""} · <a href="#versions" style={{ color: "var(--primary-hi)" }}>What&rsquo;s new</a></div>
        <h1><span className="gw">Download EZPipeline</span></h1>
        <p className="lead">The desktop app runs EZPipeline on this computer, in one window. Free and open source, Apache 2.0.</p>
        <div className="get">
          {label && <div className="detect"><Monitor size="sm" />Looks like <b>{label}</b>{offer?.kind === "none" ? " · no build for it yet" : ""}</div>}
          {mine ? (
            <>
              <a className="btn btn-primary bigbtn" {...link(mine)}><Download size="lg" />Download for {systemName(mine.platform)}<span className="chx">{[chipName(mine.platform), `v${v}`, mine.size].filter(Boolean).join(" · ")}</span></a>
              <p className="fname"><b>{mine.name}</b> · SHA-256 {short(mine.sha256)}</p>
              <div className="alts">
                {offer?.kind === "file" && offer.intel && <span>Not your Mac? <a {...link(offer.intel)}>Intel build</a></span>}
                {offer?.kind === "file" && offer.diskImage && <span>Prefer a disk image? <a {...link(offer.diskImage.file)}>v{offer.diskImage.version} .dmg</a>, which updates itself</span>}
                {zip && <span>Prefer a <a {...link(zip)}>.zip</a></span>}
                <Link href="/download/install/">Install guide</Link>
              </div>
            </>
          ) : (
            <>
              <a className="btn btn-primary bigbtn" href="#platforms"><Download size="lg" />Choose a download<span className="chx">v{v} · {latest.files.length} files</span></a>
              <p className="fname">{offer?.kind === "mobile" ? "The desktop app is for a computer. Open this page on one, or run the server for your team." : "Pick the file for your computer below."}</p>
            </>
          )}
        </div>
      </section>

      <section className="sec" id="platforms"><div className="wrap">
        <div className="sh"><div><span className="kick">Desktop app</span><h2>{mine ? "Other platforms" : "Every platform"}</h2></div><p>Every file for v{v}. On Linux, make the AppImage executable and run it.</p></div>
        <div className="plat">
          {others.map((f) => (
            <div className="pc" key={f.name}>
              <span className="os"><OsIcon f={f} /></span>
              <div className="grow"><b>{title(f)}</b><div className="k2">{archWord(f)} · {kind(f)} · {f.size}</div><div className="f">{f.name}</div></div>
              <a className="btn btn-secondary btn-icon" aria-label={`Download ${f.name}`} {...link(f)}><Download /></a>
            </div>
          ))}
        </div>
      </div></section>

      <section className="sec" id="server"><div className="wrap">
        <div className="sh"><div><span className="kick">For a team</span><h2>Run the server instead</h2></div><p>The desktop app is one person on one computer. For a team, run the server somewhere everyone can reach. Same app, in the browser.</p></div>
        <ServerCards cls="sc" />
      </div></section>

      <section className="sec"><div className="wrap vfy">
        <div>
          <span className="kick">Checksums</span>
          <h2>Verify your download</h2>
          <p className="p">Every release folder has a SHA256SUMS.txt. Compare before you open an installer, especially one you got from anywhere but here or GitHub.</p>
          <div className="sums"><Shield style={{ color: "var(--primary-hi)" }} /><div className="grow"><b>SHA256SUMS.txt</b><div className="faint" style={{ fontSize: "12.5px" }}>v{v}/ · {latest.files.length} files</div></div>
            {latest.sums && <a className="btn btn-secondary btn-sm" href={latest.sums}><Download size="sm" />Download</a>}</div>
          <div className="cl"><span className="eyebrow">macOS and Linux, in the download folder</span><div className="term"><span className="pp">$</span>shasum -a 256 -c SHA256SUMS.txt --ignore-missing<CopyButton text="shasum -a 256 -c SHA256SUMS.txt --ignore-missing" /></div></div>
          <div className="cl"><span className="eyebrow">Windows, PowerShell</span><div className="term"><span className="pp">&gt;</span>Get-FileHash .\ezpipeline-{v}-win-x64.exe<CopyButton text={`Get-FileHash .\\ezpipeline-${v}-win-x64.exe`} /></div></div>
        </div>
        <div className="tbl" role="table" aria-label={`Files in v${v}`}>
          <div className="tr h" role="row"><span role="columnheader">File</span><span role="columnheader">Platform</span><span role="columnheader" style={{ textAlign: "right" }}>Size</span><span role="columnheader">SHA-256</span></div>
          {latest.files.map((f) => (
            <div className="tr" role="row" key={f.name}><span className="fn" role="cell">{f.name}</span><span className="pf" role="cell">{f.system} · {f.system === "Linux" ? archWord(f) : chipName(f.platform) ?? archWord(f)}</span><span className="sz" role="cell">{f.size}</span>
              <span className="sha" role="cell" title={f.sha256}>{short(f.sha256)}<CopyButton className="shc" text={f.sha256} /></span></div>
          ))}
        </div>
      </div></section>

      <section className="sec" id="versions"><div className="wrap">
        <div className="sh"><div><span className="kick">Releases</span><h2>All versions</h2></div><p>Every release stays here with its checksums. To go back, install an older one over the newer.</p></div>
        <div className="vl">{releases.map((r, i) => <Version key={r.version} r={r} latest={i === 0} />)}</div>
      </div></section>

      <section className="sec" style={{ paddingTop: "80px" }}><div className="wrap">
        <GhLinks none={false} />
        <p className="fnote"><span className="ff"><i />Files served from FileFreak.io</span>One folder per release, each with its SHA256SUMS.txt.</p>
      </div></section>
    </div>
  );
}

function Version({ r, latest }: { r: Release; latest: boolean }) {
  const [open, setOpen] = useState(latest);
  const n = NOTES.find((x) => x.version === r.version);
  return (
    <div className="vi">
      <button type="button" className="vh" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown style={{ color: "var(--text-2)" }} /> : <ChevronRight style={{ color: "var(--text-3)" }} />}
        <b>v{r.version}</b>{latest && <span className="badge ok">Latest</span>}{n && <span className="d">{date(n.date)}</span>}
        <div className="rr"><span>Desktop app + server</span><span className="mono">{r.files.length} files</span></div>
      </button>
      {open && (
        <div className="vb">
          <div><h5>What&rsquo;s new</h5>{n ? <ul>{n.notes.map(([b, t]) => <li key={b}><span><b>{b}</b> {t}</span></li>)}</ul> : <p className="faint">See the release notes on GitHub.</p>}</div>
          <div className="vf">
            {r.files.map((f) => <div className="x" key={f.name}><a href={f.url}>{f.name}</a><span>{f.size}</span></div>)}
            {r.sums && <div className="x"><a href={r.sums}>SHA256SUMS.txt</a><span>checksums</span></div>}
            <div className="lk"><a href={`${GITHUB}/releases/tag/v${r.version}`}>Release notes on GitHub ↗</a></div>
          </div>
        </div>
      )}
    </div>
  );
}

function NoRelease() {
  const { label } = useOffer([{ version: "0.0.0", files: [] }]);
  const [checked, setChecked] = useState<string | null>(null);
  useEffect(() => { setChecked(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })); }, []);
  const PLANNED: [React.ReactNode, string, string][] = [
    [<Monitor size="lg" key="m" />, "macOS", "Apple silicon · .dmg, .zip"],
    [<Monitor size="lg" key="i" />, "macOS", "Intel · .dmg, .zip"],
    [<Windows key="w" />, "Windows", "x64 · installer"],
    [<Terminal size="lg" key="l" />, "Linux", "x86_64 · AppImage"],
    [<Terminal size="lg" key="a" />, "Linux", "arm64 · AppImage"],
  ];
  return (
    <div className="p-none">
      <section className="dh">
        <div className="hgrid" /><div className="hglow" />
        <svg className="appic" viewBox="0 0 32 32" aria-label="EZPipeline app icon, greyed out"><rect width="32" height="32" rx="9" fill="#10b981" /><path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23" fill="none" stroke="#022c22" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 16H20.5L16 22.5H25" fill="none" stroke="#ecfdf5" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6.5" cy="16" r="2.3" fill="#022c22" /><circle cx="6.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="20.5" cy="16" r="2.3" fill="#022c22" /><circle cx="20.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="25" cy="22.5" r="2.65" fill="#022c22" /><circle cx="25" cy="22.5" r="1.5" fill="#ecfdf5" /></svg>
        <div className="vp"><span className="dot" />Desktop app · v2.0.0 · not released yet</div>
        <h1><span className="gw">Not released yet.</span></h1>
        <p className="lead">The 2.0 desktop app isn&rsquo;t out, so there&rsquo;s nothing to download here yet. When the first build lands, this page shows it by itself. The server runs today.</p>
        <div className="get">
          {label && <div className="detect"><Monitor size="sm" />Looks like <b>{label}</b> · no build for it yet</div>}
          <a className="btn btn-primary bigbtn" href={GITHUB}><Star size="lg" />Star on GitHub<span className="chx">seanbrill/EZPIPELINE</span></a>
          <p className="fname">Want an email when it ships? On GitHub, <b>Watch → Custom → Releases</b>.</p>
          <div className="or"><span>Or run the server today, with Docker</span><Link href="/docs/deployment/">Deployment guide →</Link></div>
          <div className="term">{DOCKER.split("\n").map((l) => <div key={l}><span className="pp">$</span>{l}</div>)}<CopyButton text={DOCKER} /></div>
        </div>
      </section>
      <section className="sec" id="versions"><div className="wrap">
        <div className="sh"><div><span className="kick">Planned for 2.0</span><h2>Where the desktop app is going</h2></div><p>None of these can be downloaded yet. Each card turns into a download once its file is in the release folder.</p></div>
        <div className="plan">{PLANNED.map(([ic, os, k], i) => <div className="pl" key={i}><span className="os">{ic}</span><b>{os}</b><div className="k2">{k}</div><span className="badge">Not released yet</span></div>)}</div>
        <div className="rf"><Folder /><span>Release folder on FileFreak.io</span><span className="mono">ezpipeline/releases/</span><span className="badge">Empty</span><span className="grow" /><span className="faint">No v&lt;semver&gt;/ folder yet{checked ? ` · checked ${checked}` : ""}</span></div>
      </div></section>
      <section className="sec" id="server"><div className="wrap">
        <div className="sh"><div><span className="kick">Out now</span><h2>Run the server today</h2></div><p>The server is the same EZPipeline, used in the browser. Run it for yourself, or somewhere your team can reach.</p></div>
        <ServerCards cls="svc" />
      </div></section>
      <section className="sec" style={{ paddingTop: "80px" }}><div className="wrap">
        <GhLinks none />
        <p className="fnote"><span className="ff"><i />Files served from FileFreak.io</span>Downloads appear here as soon as a release folder is published.</p>
      </div></section>
    </div>
  );
}
