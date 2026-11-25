"use client";
// After the download starts (design f90). The Download page sends people here with
// ?file=<name>; this page starts that file and says how to install it, for its system.
// Opened without a file (from a link, or with nothing released yet) it is the install guide.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import releasesFile from "../content/releases.json";
import type { Download as File, Release, System } from "../lib/downloads";
import { CopyButton } from "./CopyButton";
import { Arrow, Check, Monitor, Shield, Terminal, Users, Warning } from "./icons";
import { chipName, useOffer, useReleases } from "./useDownloads";

const BUILT = releasesFile.releases as Release[];
const ext = (f: File) => f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
const kind = (f: File) => ({ ".dmg": ".dmg", ".exe": ".exe", ".msi": ".msi", ".appimage": "AppImage", ".deb": ".deb", ".rpm": ".rpm", ".zip": ".zip" })[ext(f)] ?? ext(f);
const label = (f: File) => [f.system, f.system === "macOS" ? chipName(f.platform) : f.arch === "arm64" ? "arm64" : f.system === "Linux" ? "x86_64" : "x64"].filter(Boolean).join(" · ");
const Mono = ({ children }: { children: React.ReactNode }) => <span className="mono">{children}</span>;
const Win4 = () => <span className="win4" aria-hidden="true"><i /><i /><i /><i /></span>;

export function InstallPage() {
  const releases = useReleases(BUILT);
  const { offer } = useOffer(releases);
  const [name, setName] = useState<string | null>(null);
  const [os, setOs] = useState<System | null>(null);
  useEffect(() => { setName(new URLSearchParams(window.location.search).get("file")); }, []);

  const found = useMemo(() => {
    if (!name) return null;
    for (const r of releases) { const f = r.files.find((x) => x.name === name); if (f) return { file: f, release: r }; }
    return null;
  }, [name, releases]);
  const file = found?.file ?? (offer?.kind === "file" ? offer.file : null);
  const version = found?.release.version ?? releases[0]?.version;
  const tab: System = os ?? file?.system ?? "macOS";

  // Start it once: a hidden frame downloads without leaving this page.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!found || started) return;
    setStarted(true);
    const f = document.createElement("iframe");
    f.style.display = "none"; f.src = found.file.url;
    document.body.appendChild(f);
    return () => { setTimeout(() => f.remove(), 60_000); };
  }, [found, started]);

  const latest = releases[0];
  const others = latest ? latest.files.filter((f) => f.name !== found?.file.name).slice(0, 4) : [];
  const shown = found?.file ?? (latest?.files.find((f) => f.system === tab) ?? null);
  const fname = shown?.name ?? `ezpipeline-${version ?? "2.0.0"}-${tab === "macOS" ? "mac-arm64.dmg" : tab === "Windows" ? "win-x64.exe" : "linux-x86_64.AppImage"}`;

  return (
    <div className="p-in">
      <section className="ty"><div className="hgrid" /><div className="hglow" /><div className="wrap">
        <span className="bigok">{found ? <Check style={{ width: 32, height: 32, strokeWidth: 2 }} /> : <Monitor style={{ width: 30, height: 30 }} />}</span>
        <div className="grow">
          <span className="kick">{found ? `Download started · v${version}` : version ? `Install guide · v${version}` : "Install guide"}</span>
          <h1>{found ? "Thanks for downloading EZPipeline." : "Installing EZPipeline."}</h1>
          {found ? (
            <p className="lead">Your download of <Mono>{found.file.name}</Mono> should start. If it didn&rsquo;t, <a className="alink" href={found.file.url}>download it again</a>.</p>
          ) : name ? (
            <p className="lead">There is no file called <Mono>{name}</Mono> in the release folder any more. <Link className="alink" href="/download/">Pick one on the Download page</Link>.</p>
          ) : latest ? (
            <p className="lead">How to open the desktop app on each system. <Link className="alink" href="/download/">Download it first</Link> if you haven&rsquo;t.</p>
          ) : (
            <p className="lead">The desktop app isn&rsquo;t released yet, so there&rsquo;s nothing to install. This guide is here ahead of time. <Link className="alink" href="/download/">The Download page</Link> shows the first build when it lands.</p>
          )}
        </div>
        {others.length > 0 && (
          <div className="wf"><h6>{found ? "Not the right file?" : "Files in v" + latest.version}</h6><ul>
            {others.map((f) => <li key={f.name}><Link href={`/download/install/?file=${encodeURIComponent(f.name)}`} onClick={() => { setName(f.name); setStarted(false); }}>{label(f)}</Link><span>{kind(f)} · {f.size}</span></li>)}
            <li><Link href="/download/#platforms">All downloads →</Link></li>
          </ul></div>
        )}
      </div></section>

      <section><div className="wrap">
        <div className="tabs ost" role="tablist" aria-label="Your system">
          {(["macOS", "Windows", "Linux"] as System[]).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={tab === s} className={`tab${tab === s ? " on" : ""}`} onClick={() => setOs(s)}>
              {s === "macOS" ? <Monitor /> : s === "Windows" ? <Win4 /> : <Terminal />}{s}
            </button>
          ))}
        </div>
        <div className="ig">
          <div className="stp">
            {tab === "macOS" ? <MacSteps name={fname} /> : tab === "Windows" ? <WindowsSteps name={fname} /> : <LinuxSteps name={fname} />}
            <div className="st"><span className="num">4</span><div><h3>Create the first admin</h3><p>The first account on a new install becomes the primary admin. Add everyone else later from Settings → People, with only the permissions they need.</p>
              <div className="next"><Link className="btn btn-primary btn-lg" href="/docs/setup/">Read the quick start<Arrow /></Link><Link className="btn btn-ghost btn-lg" href="/docs/pipeline-schema/">Pipeline schema</Link></div></div></div>
          </div>
          <aside className="asd">
            <div className="ac"><span className="icon-tile ok"><Shield /></span><h4>Check it&rsquo;s the real file</h4><p>Before you open it, compare its SHA-256 with the one in SHA256SUMS.txt{found?.release.sums ? <> (<a className="alink" href={found.release.sums}>download</a>)</> : null}.</p>
              {shown && <div className="hash"><span className="k">SHA-256</span><span className="hv" title={shown.sha256}>{shown.sha256.slice(0, 4)}…{shown.sha256.slice(-4)}</span><CopyButton text={shown.sha256} /></div>}
              {tab === "Windows" ? (
                <div className="term"><div><span className="pp">&gt;</span>Get-FileHash .\{fname}</div><CopyButton text={`Get-FileHash .\\${fname}`} /></div>
              ) : (
                <div className="term"><div><span className="pp">$</span>cd ~/Downloads</div><div><span className="pp">$</span>shasum -a 256 {fname}</div><CopyButton text={`cd ~/Downloads\nshasum -a 256 ${fname}`} /></div>
              )}
            </div>
            <div className="ac"><span className="icon-tile"><Terminal /></span><h4>Pipelines run on this computer, as you</h4><p>Steps are shell commands. They run here, unisolated, with your files and your keys. Only add pipelines you&rsquo;d run in your own terminal.</p><Link className="alink" href="/docs/permissions/">Read this before you deploy →</Link></div>
            <div className="ac"><span className="icon-tile"><Users /></span><h4>For a team, run the server</h4><p>The desktop app is one person on one computer. For a team, run it with Docker or in your own cloud, and everyone signs in from a browser.</p><Link className="alink" href="/download/#server">Server options →</Link></div>
          </aside>
        </div>
      </div></section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <div className="st"><span className="num">{n}</span><div><h3>{title}</h3>{children}</div></div>;
}

function Warn({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="wn"><span className="icon-tile warn"><Warning /></span><div className="grow"><b>{title}</b>{children}</div></div>;
}

function MacSteps({ name }: { name: string }) {
  const zip = name.toLowerCase().endsWith(".zip");
  const XATTR = "xattr -dr com.apple.quarantine /Applications/EZPipeline.app";
  return (
    <>
      <Step n={1} title={zip ? "Unzip it" : "Open the disk image"}><p>{zip
        ? <>Double-click <Mono>{name}</Mono> in your Downloads folder (Safari may have unzipped it already). You get EZPipeline.app.</>
        : <>Double-click <Mono>{name}</Mono> in your Downloads folder. A window opens with the app and a shortcut to Applications.</>}</p></Step>
      <Step n={2} title="Drag EZPipeline to Applications"><p>{zip ? "Move it into the Applications folder." : "Drop it on the folder. Then eject the disk image from Finder's sidebar."}</p>
        <div className="finder" aria-hidden="true"><div className="fbar"><i style={{ background: "#ff5f57" }} /><i style={{ background: "#febc2e" }} /><i style={{ background: "#28c840" }} /><span>EZPipeline</span></div>
          <div className="fbody">
            <div className="fi"><svg className="appi" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#10b981" /><path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23" fill="none" stroke="#022c22" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 16H20.5L16 22.5H25" fill="none" stroke="#ecfdf5" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6.5" cy="16" r="2.3" fill="#022c22" /><circle cx="6.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="20.5" cy="16" r="2.3" fill="#022c22" /><circle cx="20.5" cy="16" r="1.15" fill="#ecfdf5" /><circle cx="25" cy="22.5" r="2.65" fill="#022c22" /><circle cx="25" cy="22.5" r="1.5" fill="#ecfdf5" /></svg>EZPipeline</div>
            <svg className="arr" viewBox="0 0 120 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 12h104" strokeDasharray="4 7" /><path d="m104 6 6 6-6 6" /></svg>
            <div className="fi"><svg className="fol" viewBox="0 0 24 22"><path d="M21 19.5a1.5 1.5 0 0 0 1.5-1.5V7.5A1.5 1.5 0 0 0 21 6h-8.4a1.5 1.5 0 0 1-1.25-.67L10.1 3.4A1.5 1.5 0 0 0 8.85 2.7H3A1.5 1.5 0 0 0 1.5 4.2V18A1.5 1.5 0 0 0 3 19.5Z" /></svg>Applications</div>
          </div></div></Step>
      <Step n={3} title="Open it"><p>From Applications or Spotlight. EZPipeline opens in one window, and the server runs inside it while the app is open.</p>
        <Warn title="If macOS says it can't verify the developer"><p className="muted">Click Done, then open <b>System Settings → Privacy &amp; Security</b>, scroll to Security, and click <b>Open Anyway</b> next to EZPipeline. Or, in Terminal:</p>
          <div className="term"><span className="pp">$</span>{XATTR}<CopyButton text={XATTR} /></div></Warn></Step>
    </>
  );
}

function WindowsSteps({ name }: { name: string }) {
  return (
    <>
      <Step n={1} title="Run the installer"><p>Double-click <Mono>{name}</Mono> in your Downloads folder. It installs for you alone, so it does not ask for an administrator.</p></Step>
      <Step n={2} title="Get past SmartScreen"><p>These builds are not signed with a certificate yet, so Windows warns the first time.</p>
        <Warn title="If Windows says it protected your PC"><p className="muted">Click <b>More info</b>, then <b>Run anyway</b>. The publisher shows as unknown until the builds are signed.</p></Warn></Step>
      <Step n={3} title="Open it"><p>From the Start menu or the desktop shortcut. EZPipeline opens in one window, and the server runs inside it while the app is open.</p></Step>
    </>
  );
}

function LinuxSteps({ name }: { name: string }) {
  const RUN = `chmod +x ~/Downloads/${name}\n~/Downloads/${name}`;
  return (
    <>
      <Step n={1} title="Make it executable"><p>An AppImage is the whole app in one file. Allow it to run, then start it:</p>
        <div className="term">{RUN.split("\n").map((l) => <div key={l}><span className="pp">$</span>{l}</div>)}<CopyButton text={RUN} /></div></Step>
      <Step n={2} title="If it does not start"><p>Some distributions need FUSE for AppImages.</p>
        <Warn title="“dlopen(): error loading libfuse.so.2”"><p className="muted">Install it (<Mono>sudo apt install libfuse2</Mono> on Ubuntu and Debian), or run it with <Mono>--appimage-extract-and-run</Mono>.</p></Warn></Step>
      <Step n={3} title="Open it"><p>EZPipeline opens in one window, and the server runs inside it while the app is open. Move the file somewhere permanent first, such as <Mono>~/Applications</Mono>: the app updates itself in place.</p></Step>
    </>
  );
}
