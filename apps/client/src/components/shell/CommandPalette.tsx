/**
 * ⌘K (design sheet f87, f88 on a phone). One box for going anywhere: a
 * pipeline, a run by number, a commit by sha or message, a settings page, or
 * an action. ↵ opens; ⌘↵ on a pipeline runs it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { ArrowRight, Book, GitBranch, LayoutDashboard, Moon, Play, Plus, Search, Settings, Shield, Sun, Workflow, Activity, LogOut } from 'lucide-react';
import { useLive } from '../../contexts/LiveContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Kbd } from '../ui/Badge';
import { cx } from '../ui/cx';
import { RunStatusBadge, runState } from '../run/status';
import { sortRuns } from './useRuns';
import { useRunActions } from '../run/useRunActions';

interface Item {
  id: string;
  section: 'Pipelines' | 'Runs' | 'Commits' | 'Go to' | 'Actions';
  title: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  right?: ReactNode;
  run: () => void;
  /** ⌘↵ */
  alt?: { label: string; run: () => void };
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { pipelines, history } = useLive();
  const { isAdmin, logout } = useAuth();
  const { setTheme } = useTheme();
  const { run: runPipeline } = useRunActions();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setQ(''); setActive(0); }
  }

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => { onClose(); nav(to); };
    const out: Item[] = [];
    for (const p of pipelines) {
      out.push({
        id: `p:${p.id}`, section: 'Pipelines', title: p.appName || p.id, hint: p.group, keywords: `${p.id} ${p.description ?? ''}`,
        icon: <Workflow />, run: go(`/pipelines/${encodeURIComponent(p.id)}`),
        alt: p.permissions?.canRun === false ? undefined : {
          label: 'Run',
          // The same run as everywhere else, so a pipeline that asks to be confirmed is.
          run: () => { onClose(); void runPipeline(p, { open: true }); },
        },
      });
    }
    const seen = new Set<string>();
    for (const r of sortRuns(history).slice(0, 300)) {
      const c = r.commits?.[0];
      out.push({
        id: `r:${r.id}`, section: 'Runs', title: `${r.pipelineName} #${r.buildNumber}`,
        hint: c ? `${c.shortSha} ${c.subject}` : r.triggeredBy, keywords: `#${r.buildNumber} ${r.buildNumber} ${r.commitSha ?? ''}`,
        icon: <Activity />, right: <RunStatusBadge state={runState(r)} />, run: go(`/runs/${r.id}`),
      });
      for (const cm of r.commits ?? []) {
        if (seen.has(cm.sha)) continue;
        seen.add(cm.sha);
        out.push({
          id: `c:${cm.sha}`, section: 'Commits', title: cm.subject, hint: `${cm.shortSha} · ${cm.author} · ${r.pipelineName} #${r.buildNumber}`,
          keywords: `${cm.sha} ${cm.shortSha}`, icon: <GitBranch />, run: go(`/runs/${r.id}`),
        });
      }
    }
    const pages: [string, string, ReactNode, string?][] = [
      ['Overview', '/', <LayoutDashboard />], ['Pipelines', '/pipelines', <Workflow />], ['Runs', '/runs', <Activity />], ['Docs', '/docs', <Book />],
      ['Settings · Account', '/settings/account', <Settings />, 'password codes mfa email profile'], ['Settings · Appearance', '/settings/appearance', <Settings />, 'theme dark light motion'],
      ['Settings · API tokens', '/settings/tokens', <Settings />, 'token ci script'], ['Settings · Plugins', '/settings/plugins', <Settings />, 'filefreak cli aws azure gcloud kubectl'],
    ];
    if (isAdmin) pages.push(
      ['Settings · General', '/settings/general', <Settings />, 'instance name url mail'], ['Settings · Environment', '/settings/environment', <Settings />, 'global env variables'],
      ['Settings · Resources', '/settings/resources', <Settings />, 'files'], ['Admin · Users & roles', '/admin/users', <Shield />, 'people invite'],
      ['Admin · Permissions', '/admin/permissions', <Shield />, 'access roles'], ['Admin · System health', '/admin/health', <Shield />, 'restart disk'],
      ['Admin · Audit log', '/admin/audit', <Shield />, 'history who'], ['Admin · Agent & API tokens', '/admin/tokens', <Shield />, 'mcp agent'],
      ['Admin · Terminal', '/admin/terminal', <Shield />, 'shell console'],
      ['Settings · Data', '/settings/data', <Settings />, 'backup bundle ezp'], ['Export…', '/settings/data?export=1', <Settings />, 'export bundle backup ezp'], ['Import a bundle', '/import', <Settings />, 'import bundle ezp restore'],
    );
    for (const [title, to, icon, kw] of pages) out.push({ id: `g:${to}`, section: 'Go to', title, keywords: kw, icon, run: go(to) });
    out.push(
      { id: 'a:new', section: 'Actions', title: 'New pipeline', icon: <Plus />, run: go('/pipelines?new=1') },
      { id: 'a:classic', section: 'Actions', title: 'Theme: Classic', icon: <Moon />, run: () => { setTheme('classic'); onClose(); } },
      { id: 'a:midnight', section: 'Actions', title: 'Theme: Midnight', icon: <Moon />, run: () => { setTheme('midnight'); onClose(); } },
      { id: 'a:light', section: 'Actions', title: 'Theme: Light', icon: <Sun />, run: () => { setTheme('light'); onClose(); } },
      { id: 'a:logout', section: 'Actions', title: 'Sign out', icon: <LogOut />, run: () => { onClose(); logout(); } },
    );
    return out;
  }, [pipelines, history, isAdmin, nav, onClose, setTheme, logout, runPipeline]);

  const fuse = useMemo(() => new Fuse(items, { keys: [{ name: 'title', weight: 3 }, 'hint', 'keywords'], threshold: 0.38, ignoreLocation: true }), [items]);

  const results = useMemo(() => {
    const term = q.trim();
    if (!term) {
      // Empty: recent runs, pipelines, then places.
      const recent = items.filter((i) => i.section === 'Runs').slice(0, 5);
      return [...recent, ...items.filter((i) => i.section === 'Pipelines').slice(0, 6), ...items.filter((i) => i.section === 'Go to').slice(0, 4)];
    }
    const hex = /^[0-9a-f]{4,40}$/i.test(term);
    const num = /^#?\d+$/.test(term) ? term.replace('#', '') : null;
    let found = fuse.search(term).map((r) => r.item);
    if (hex) found = [...items.filter((i) => i.keywords?.split(' ').some((k) => k.startsWith(term.toLowerCase()))), ...found];
    if (num) found = [...items.filter((i) => i.section === 'Runs' && i.title.endsWith(`#${num}`)), ...found];
    return [...new Map(found.map((i) => [i.id, i])).values()].slice(0, 40);
  }, [q, fuse, items]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Enter') {
      const it = results[active];
      if (!it) return;
      if ((e.metaKey || e.ctrlKey) && it.alt) it.alt.run();
      else it.run();
    } else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };

  let lastSection = '';
  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-start justify-center bg-scrim/70 backdrop-blur-[2px] sm:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search or jump to" onKeyDown={onKey}
        className="menu-enter flex h-dvh w-full flex-col overflow-hidden border-line-2 bg-surface shadow-e3 sm:h-auto sm:max-h-[64vh] sm:max-w-[640px] sm:rounded-modal sm:border">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-[18px] shrink-0 text-fg-3" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="Pipelines, runs, commits, settings…" aria-label="Search"
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-3 sm:text-[15px]" />
          <button type="button" onClick={onClose} className="text-[13px] text-fg-3 sm:hidden">Cancel</button>
          <Kbd className="hidden sm:inline-grid">esc</Kbd>
        </div>
        <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-10 text-center text-[13.5px] text-fg-3">Nothing matches “{q}”. Try a run number like #135, or part of a commit sha.</p>}
          {results.map((it, i) => {
            const head = it.section !== lastSection ? (lastSection = it.section) : null;
            return (
              <div key={it.id}>
                {head && <div className="px-3 pb-1 pt-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3">{head}</div>}
                <button type="button" role="option" aria-selected={i === active} data-i={i}
                  onMouseMove={() => setActive(i)} onClick={() => it.run()}
                  className={cx('flex min-h-11 w-full items-center gap-3 rounded-box px-3 text-left', i === active ? 'bg-surface-3' : '')}>
                  <span className="text-fg-3 [&>svg]:size-4">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-fg">{it.title}</span>
                    {it.hint && <span className="block truncate text-[12px] text-fg-3">{it.hint}</span>}
                  </span>
                  {it.right}
                  {i === active && it.alt && <span className="hidden items-center gap-1 text-[12px] text-fg-3 sm:flex"><Play className="size-3" />{it.alt.label} <Kbd>⌘</Kbd><Kbd>↵</Kbd></span>}
                  {i === active && <ArrowRight className="size-4 text-fg-3" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden items-center gap-4 border-t border-line px-4 py-2.5 text-[12px] text-fg-3 sm:flex">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>↵</Kbd> run pipeline</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
