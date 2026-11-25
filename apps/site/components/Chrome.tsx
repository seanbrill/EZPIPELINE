// The header and footer every page shares (from f36's).
import Link from "next/link";
import { GITHUB, NAV, VERSION } from "../lib/site";
import { Download, GitHub, Logo } from "./icons";

export function Header() {
  return (
    <header className="sn"><div className="wrap">
      <Link href="/" aria-label="EZPipeline home"><Logo /></Link>
      <nav className="links" aria-label="Main">{NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}</nav>
      <div className="r">
        <a className="gh" href={GITHUB}><GitHub size="sm" /> GitHub</a>
        <Link className="btn btn-primary btn-sm" href="/download/"><Download size="sm" />Download</Link>
      </div>
    </div></header>
  );
}

const COLS: { h: string; links: [string, string][] }[] = [
  { h: "Product", links: [["Features", "/#features"], ["Download", "/download/"], ["Desktop app", "/download/"], ["Self-host wizard", "/docs/deployment/"], ["Run the server", "/docs/setup/"]] },
  { h: "Docs", links: [["Quick start", "/docs/setup/"], ["Pipeline schema", "/docs/pipeline-schema/"], ["Permissions", "/docs/permissions/"], ["AI assistant", "/docs/ai-assistant/"], ["Deployment", "/docs/deployment/"]] },
  { h: "Project", links: [["GitHub", GITHUB], ["Issues", `${GITHUB}/issues`], ["Releases", "/download/#versions"], ["Contributing", "/docs/development/"], ["License (Apache 2.0)", `${GITHUB}/blob/main/LICENSE`]] },
];

export function Footer() {
  return (
    <footer className="ft"><div className="wrap">
      <div className="ftg">
        <div className="about"><Logo /><p>Self-hosted CI/CD. Pipelines in YAML, steps as shell commands, logs live in your browser.</p></div>
        {COLS.map((c) => (
          <div key={c.h}><h6>{c.h}</h6><ul>{c.links.map(([l, h]) => <li key={l}>{h.startsWith("http") ? <a href={h}>{l}</a> : <Link href={h}>{l}</Link>}</li>)}</ul></div>
        ))}
      </div>
      <div className="ftb"><span>© {new Date().getFullYear()} EZPipeline contributors · v{VERSION}</span><a className="ff" href="https://filefreak.io"><i></i>Hosted on FileFreak.io</a></div>
    </div></footer>
  );
}
