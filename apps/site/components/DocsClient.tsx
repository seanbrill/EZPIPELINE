"use client";
// The docs pages' moving parts (f155): search the sidebar, the select that replaces it on a
// phone, "On this page" following the scroll, and a copy button on each code block.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "./icons";

export interface NavDoc { href: string; title: string; lead: string; group: string; on: boolean }

export function DocsNav({ docs }: { docs: NavDoc[] }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); box.current?.focus(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = docs.filter((d) => words.every((w) => `${d.title} ${d.lead}`.toLowerCase().includes(w)));
  const groups = [...new Set(shown.map((d) => d.group))];
  return (
    <nav className="dnav" aria-label="Docs">
      <label className="dsrch"><Search size="sm" /><input ref={box} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the docs" aria-label="Search the docs" /><span className="kbd" aria-hidden="true">/</span></label>
      {groups.map((g) => (
        <div key={g}><h6>{g}</h6>{shown.filter((d) => d.group === g).map((d) => <Link key={d.href} href={d.href} className={d.on ? "on" : undefined} aria-current={d.on ? "page" : undefined}>{d.title}</Link>)}</div>
      ))}
      {!shown.length && <p className="dnone">No page matches &ldquo;{q}&rdquo;.</p>}
    </nav>
  );
}

/** On a phone the sidebar is a select above the article. */
export function DocsSelect({ docs }: { docs: NavDoc[] }) {
  const router = useRouter();
  const groups = useMemo(() => [...new Set(docs.map((d) => d.group))], [docs]);
  return (
    <label className="dsel"><span className="eyebrow">Docs</span>
      <select value={docs.find((d) => d.on)?.href} onChange={(e) => router.push(e.target.value)} aria-label="Go to a docs page">
        {groups.map((g) => <optgroup key={g} label={g}>{docs.filter((d) => d.group === g).map((d) => <option key={d.href} value={d.href}>{d.title}</option>)}</optgroup>)}
      </select>
    </label>
  );
}

export function Toc({ headings }: { headings: { depth: number; id: string; text: string }[] }) {
  const [on, setOn] = useState(headings[0]?.id);
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
    const pick = () => {
      let cur = els[0]?.id;
      for (const e of els) if (e.getBoundingClientRect().top < 120) cur = e.id;
      setOn(cur);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    return () => window.removeEventListener("scroll", pick);
  }, [headings]);
  if (!headings.length) return <aside className="toc" />;
  return (
    <aside className="toc" aria-label="On this page"><h6>On this page</h6>
      {headings.map((h) => <a key={h.id} href={`#${h.id}`} className={[h.depth === 3 ? "sub" : "", on === h.id ? "on" : ""].join(" ").trim() || undefined}>{h.text}</a>)}
    </aside>
  );
}

const COPY = '<svg class="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const DONE = '<svg class="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** A copy button in each code block of the article. */
export function CodeCopy({ target }: { target: string }) {
  useEffect(() => {
    const made: HTMLButtonElement[] = [];
    document.getElementById(target)?.querySelectorAll("pre").forEach((pre) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "cpb"; b.setAttribute("aria-label", "Copy"); b.innerHTML = COPY;
      b.onclick = () => void navigator.clipboard?.writeText(pre.querySelector("code")?.textContent ?? pre.textContent ?? "").then(() => {
        b.innerHTML = DONE; b.setAttribute("aria-label", "Copied");
        setTimeout(() => { b.innerHTML = COPY; b.setAttribute("aria-label", "Copy"); }, 1500);
      });
      pre.appendChild(b); made.push(b);
    });
    return () => made.forEach((b) => b.remove());
  }, [target]);
  return null;
}
