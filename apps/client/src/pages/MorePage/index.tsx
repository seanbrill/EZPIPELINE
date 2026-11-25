/**
 * "More" on a phone (design sheet f130): everything the tab bar has no room
 * for. On a wider screen the sidebar holds all of it, so this redirects.
 */
import { Link, Navigate } from 'react-router-dom';
import { Book, ChevronRight, LogOut, Settings, Shield } from 'lucide-react';
import type { ReactNode } from 'react';
import appVersion from 'virtual:app-version';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useIsPhone } from '../../hooks/useMediaQuery';
import { usePageChrome } from '../../components/shell/chrome';
import { useRunsSummary } from '../../components/shell/useRuns';
import { Segmented } from '../../components/ui/Tabs';
import { Avatar } from '../../components/ui/Avatar';
import { cx } from '../../components/ui/cx';

function Row({ to, icon, label, right }: { to: string; icon: ReactNode; label: string; right?: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-12 items-center gap-3 px-4 text-[16px] active:bg-surface-3 [&>svg]:size-5 [&>svg]:text-fg-3">
      {icon}<span className="flex-1">{label}</span>{right}<ChevronRight className="!size-4" />
    </Link>
  );
}

export default function MorePage() {
  usePageChrome([{ label: 'More' }]);
  const phone = useIsPhone();
  const { user, isAdmin, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { confirm } = useConfirm();
  const { groups } = useRunsSummary();
  if (!phone) return <Navigate to="/" replace />;
  return (
    <div className="flex flex-col gap-5 px-4 py-5">
      <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
        <Avatar name={user ?? '?'} size={40} />
        <div><div className="text-[16px] font-semibold">{user}</div><div className="text-[13px] text-fg-3">{isAdmin ? 'Admin' : 'Member'}</div></div>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <Row to="/docs" icon={<Book />} label="Docs" />
        <Row to="/settings" icon={<Settings />} label="Settings" />
        {isAdmin && <Row to="/admin" icon={<Shield />} label="Admin" />}
      </div>
      {groups.length > 0 && (
        <div>
          <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">Groups</div>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {groups.map((g) => (
              <Row key={g.name} to={g.name === 'Ungrouped' ? '/pipelines' : `/groups/${encodeURIComponent(g.name)}`} label={g.name}
                icon={<span className={cx('!size-2.5 rounded-full', g.last === 'failed' ? 'bg-fail' : g.last === 'approval' ? 'bg-warn' : g.last === 'running' ? 'bg-run' : g.last ? 'bg-primary' : 'bg-line-3')} />}
                right={<span className="font-mono text-[13px] text-fg-3">{g.pipelines}</span>} />
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">Theme</div>
        <Segmented className="w-full [&>button]:flex-1" value={theme} onChange={(t) => setTheme(t as typeof theme)}
          items={[{ id: 'classic', label: 'Classic' }, { id: 'midnight', label: 'Midnight' }, { id: 'light', label: 'Light' }]} />
      </div>
      <button type="button" onClick={async () => { if (await confirm({ title: 'Sign out?', message: 'Runs keep going on the server.', confirmText: 'Sign out' })) logout(); }}
        className="flex min-h-12 items-center justify-center gap-2 rounded-card border border-line bg-surface text-[16px] text-fail">
        <LogOut className="size-5" />Sign out
      </button>
      <p className="text-center font-mono text-[12px] text-fg-3">EZPipeline {appVersion.version}</p>
    </div>
  );
}
