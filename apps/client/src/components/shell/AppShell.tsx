/**
 * The v2 app shell (design sheet f3; phone f118, f130).
 *
 * Desktop: a 248px sidebar (logo, ⌘K, the four places, groups with their
 * last-run state, then Settings, Admin and the account) that collapses to a
 * 64px rail; a 56px top bar with breadcrumbs, the bell and the page's one
 * primary action. Phone: an app bar, a tab bar (Overview, Pipelines, Runs,
 * More) and sheets instead of popovers.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Book, ChevronsLeft, ChevronsRight, LayoutDashboard, LogOut, Menu as MenuIcon, MoreHorizontal, Search, Settings, Shield, Workflow, WifiOff } from 'lucide-react';
import appVersion from 'virtual:app-version';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLive } from '../../contexts/LiveContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useIsPhone, useMediaQuery } from '../../hooks/useMediaQuery';
import { api } from '../../lib/api';
import { Logo, LogoMark } from '../brand/Logo';
import { Avatar } from '../ui/Avatar';
import { Kbd } from '../ui/Badge';
import { Menu } from '../ui/Menu';
import { cx } from '../ui/cx';
import AIAssistant from '../AIAssistant';
import { DesktopStateReporter, DesktopUpdateCard } from './Desktop';
import { desktop } from '../../lib/desktop';
import { CommandPalette } from './CommandPalette';
import { NotificationBell } from './Notifications';
import { ChromeProvider, useChrome } from './chrome';
import { useRunsSummary } from './useRuns';
import type { RunState } from '../run/status';

const DOT: Record<string, string> = {
  failed: 'bg-fail', approval: 'bg-warn', running: 'bg-run', starting: 'bg-run', success: 'bg-primary', warning: 'bg-warn', aborted: 'bg-fg-3', queued: 'bg-fg-3',
};
const dotFor = (s: RunState | null) => (s ? DOT[s] : 'bg-line-3');

function SideLink({ to, icon, label, count, rail, end, live }: { to: string; icon: ReactNode; label: string; count?: ReactNode; rail: boolean; end?: boolean; live?: boolean }) {
  return (
    <NavLink to={to} end={end} title={rail ? label : undefined}
      className={({ isActive }) => cx(
        'group/nav flex h-9 items-center gap-2.5 rounded-ctl px-2.5 text-[13.5px] font-medium transition-colors [&>svg]:size-4 [&>svg]:shrink-0',
        rail && 'justify-center px-0',
        isActive ? 'bg-surface-3 text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
      )}>
      {icon}
      {!rail && <span className="flex-1 truncate">{label}</span>}
      {!rail && count !== undefined && <span className={cx('font-mono text-[11px]', live ? 'text-run' : 'text-fg-3')}>{count}</span>}
    </NavLink>
  );
}

function Sidebar({ rail, onToggle, onSearch }: { rail: boolean; onToggle: () => void; onSearch: () => void }) {
  const { user, isAdmin, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { confirm } = useConfirm();
  const { pipelines } = useLive();
  const { live, waiting, groups } = useRunsSummary();
  return (
    <aside className={cx('flex h-full shrink-0 flex-col border-r border-line bg-bg-2 transition-[width] duration-[var(--dur-base)]', rail ? 'w-16' : 'w-[248px]')}>
      <div className={cx('flex h-14 items-center gap-2 px-4', rail && 'justify-center px-0')}>
        <Link to="/" aria-label="EZPipeline, Overview">{rail ? <LogoMark size={28} /> : <Logo size={28} />}</Link>
        {!rail && <span className="ml-auto rounded-full border border-line-2 px-2 py-0.5 font-mono text-[10.5px] text-fg-3" title={`${appVersion.version} · ${appVersion.branch}@${appVersion.commit}`}>{appVersion.version}</span>}
      </div>
      <div className={cx('px-3', rail && 'px-2')}>
        <button type="button" onClick={onSearch} title="Search or jump to (⌘K)"
          className={cx('flex h-9 w-full items-center gap-2 rounded-ctl border border-line-2 bg-surface px-2.5 text-[13px] text-fg-3 hover:border-line-3 hover:text-fg-2', rail && 'justify-center px-0')}>
          <Search className="size-4 shrink-0" />
          {!rail && <><span className="flex-1 text-left">Search or jump to…</span><Kbd>⌘K</Kbd></>}
        </button>
      </div>
      <nav className={cx('mt-3 flex flex-col gap-0.5 px-3', rail && 'px-2')} aria-label="Main">
        <SideLink to="/" end rail={rail} icon={<LayoutDashboard />} label="Overview" count={waiting ? `${waiting} waiting` : undefined} />
        <SideLink to="/pipelines" rail={rail} icon={<Workflow />} label="Pipelines" count={pipelines.length || undefined} />
        <SideLink to="/runs" rail={rail} icon={<Activity />} label="Runs" count={live ? `${live} live` : undefined} live={live > 0} />
        <SideLink to="/docs" rail={rail} icon={<Book />} label="Docs" />
      </nav>
      {!rail && groups.length > 0 && (
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3">
          <div className="px-2.5 pb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3">Groups</div>
          {groups.map((g) => (
            <NavLink key={g.name} to={g.name === 'Ungrouped' ? '/pipelines' : `/groups/${encodeURIComponent(g.name)}`}
              className="flex h-8 items-center gap-2.5 rounded-ctl px-2.5 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
              <span className={cx('size-2 shrink-0 rounded-full', dotFor(g.last))} />
              <span className="flex-1 truncate">{g.name}</span>
              <span className="font-mono text-[11px] text-fg-3">{g.pipelines}</span>
            </NavLink>
          ))}
        </div>
      )}
      {(rail || groups.length === 0) && <div className="flex-1" />}
      {desktop && <DesktopUpdateCard rail={rail} running={live} />}
      <div className={cx('flex flex-col gap-0.5 border-t border-line px-3 py-3', rail && 'px-2')}>
        <SideLink to="/settings" rail={rail} icon={<Settings />} label="Settings" />
        {isAdmin && <SideLink to="/admin" rail={rail} icon={<Shield />} label="Admin" />}
        <div className={cx('mt-1 flex items-center gap-2.5 px-1.5', rail && 'flex-col px-0')}>
          <Avatar name={user ?? '?'} size={30} />
          {!rail && <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{user}</span><span className="block text-[11.5px] text-fg-3">{isAdmin ? 'Admin' : 'Member'}</span></span>}
          <Menu align="start" title={user ?? 'Account'}
            trigger={<button type="button" aria-label="Account menu" className="grid size-8 place-items-center rounded-ctl text-fg-3 hover:bg-surface-3 hover:text-fg"><MoreHorizontal className="size-4" /></button>}
            items={[
              { heading: 'Theme' },
              { label: 'Classic', checked: theme === 'classic', onSelect: () => setTheme('classic') },
              { label: 'Midnight', checked: theme === 'midnight', onSelect: () => setTheme('midnight') },
              { label: 'Light', checked: theme === 'light', onSelect: () => setTheme('light') },
              { separator: true },
              { label: 'Sign out', icon: <LogOut />, onSelect: async () => { if (await confirm({ title: 'Sign out?', message: 'Runs keep going on the server.', confirmText: 'Sign out' })) logout(); } },
            ]} />
        </div>
        <button type="button" onClick={onToggle} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cx('mt-1 flex h-8 items-center gap-2 rounded-ctl px-2.5 text-[12.5px] text-fg-3 hover:bg-surface-2 hover:text-fg-2', rail && 'justify-center px-0')}>
          {rail ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" />Collapse</>}
        </button>
      </div>
    </aside>
  );
}

function TopBar() {
  const { crumbs, action } = useChrome();
  const { connection } = useLive();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-6 backdrop-blur">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-fg-3">/</span>}
            {c.to && i < crumbs.length - 1
              ? <Link to={c.to} className="truncate text-fg-2 hover:text-fg">{c.label}</Link>
              : <b className="truncate font-semibold text-fg">{c.label}</b>}
          </span>
        ))}
      </nav>
      <div className="flex-1" />
      {connection !== 'live' && connection !== 'connecting' && (
        <span className="flex items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-2.5 py-1 text-[12px] text-warn">
          <WifiOff className="size-3.5" />{connection === 'offline' ? 'Offline · retrying' : 'Reconnecting…'}
        </span>
      )}
      <NotificationBell />
      {action}
    </header>
  );
}

const TABS = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard />, end: true },
  { to: '/pipelines', label: 'Pipelines', icon: <Workflow /> },
  { to: '/runs', label: 'Runs', icon: <Activity /> },
  { to: '/more', label: 'More', icon: <MenuIcon /> },
];

function PhoneChrome({ onSearch, children }: { onSearch: () => void; children: ReactNode }) {
  const { crumbs, action } = useChrome();
  const { pathname } = useLocation();
  const { waiting, live } = useRunsSummary();
  const title = crumbs[crumbs.length - 1]?.label ?? 'EZPipeline';
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-bg px-2 pt-[env(safe-area-inset-top)]">
        <Link to="/" aria-label="Overview" className="grid size-11 place-items-center"><LogoMark size={26} /></Link>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-semibold">{title}</h1>
        <button type="button" aria-label="Search" onClick={onSearch} className="grid size-11 place-items-center text-fg-2"><Search className="size-5" /></button>
        <NotificationBell />
        {action}
      </header>
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      <nav aria-label="Main" className="grid shrink-0 grid-cols-4 border-t border-line bg-bg-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => cx('relative flex h-16 flex-col items-center justify-center gap-1 text-[11.5px] font-medium [&>svg]:size-[22px]', isActive || (t.to === '/pipelines' && pathname.startsWith('/groups/')) ? 'text-primary-hi' : 'text-fg-3')}>
            {t.icon}{t.label}
            {t.to === '/runs' && (waiting || live) > 0 && (
              <span className={cx('absolute left-1/2 top-2 ml-2 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-4 text-bg', waiting ? 'bg-warn' : 'bg-run')}>{waiting || live}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const phone = useIsPhone();
  const narrow = useMediaQuery('(max-width: 1023px)');
  const { enableAI } = usePreferences();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    api<{ state: Record<string, unknown> }>('/me/state').then((r) => {
      if (typeof r.state['sidebar.collapsed'] === 'boolean') setCollapsed(r.state['sidebar.collapsed'] as boolean);
    }).catch(() => {});
  }, []);
  const rail = collapsed ?? narrow;
  const toggle = useCallback(() => {
    const next = !rail;
    setCollapsed(next);
    void api('/me/state/sidebar.collapsed', { method: 'PUT', body: { value: next } }).catch(() => {});
  }, [rail]);

  // ⌘K / Ctrl+K anywhere; "/" when not typing; G then O/P/R to go places.
  useEffect(() => {
    let g = false;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"], .monaco-editor');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setPaletteOpen(true); return; }
      if (g) {
        g = false;
        const to = { o: '/', p: '/pipelines', r: '/runs', d: '/docs', s: '/settings' }[e.key.toLowerCase()];
        if (to) { e.preventDefault(); nav(to); }
        return;
      }
      if (e.key.toLowerCase() === 'g') { g = true; window.setTimeout(() => { g = false; }, 900); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  // A new page starts at the top.
  useEffect(() => {
    document.getElementById('main')?.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const palette = <>{desktop && <DesktopStateReporter />}<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} /></>;
  if (phone) {
    return (
      <>
        <PhoneChrome onSearch={() => setPaletteOpen(true)}>{children}</PhoneChrome>
        {palette}
      </>
    );
  }
  return (
    <div className="flex h-dvh bg-bg text-fg">
      <Sidebar rail={rail} onToggle={toggle} onSearch={() => setPaletteOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      {palette}
      {enableAI && <AIAssistant />}
    </div>
  );
}

/** Wrap a page: the chrome context is per shell. */
export function ShellRoot({ children }: { children: ReactNode }) {
  return (
    <ChromeProvider>
      <AppShell>{children}</AppShell>
    </ChromeProvider>
  );
}
