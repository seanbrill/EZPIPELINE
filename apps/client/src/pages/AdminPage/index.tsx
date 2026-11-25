/**
 * Admin (design sheet f29–f35). Who can do what, and the state of the server.
 * Admins see all of it; someone who manages users sees Users & roles and
 * Permissions.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Activity, Bot, ChevronLeft, ScrollText, ShieldCheck, SquareTerminal, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useIsPhone } from '../../hooks/useMediaQuery';
import { usePageChrome } from '../../components/shell/chrome';
import { NotFound, Page } from '../../components/shell/states';
import { NavList, SplitLayout, SubNav, type NavGroup } from '../../components/settings/kit';
import { Skeleton } from '../../components/ui/Feedback';
import { api } from '../../lib/api';

const UsersSection = lazy(() => import('./Users'));
const Permissions = lazy(() => import('./Permissions'));
const Health = lazy(() => import('./Health'));
const Audit = lazy(() => import('./Audit'));
const AgentTokens = lazy(() => import('./AgentTokens'));
const Terminal = lazy(() => import('./Terminal'));

const TITLES: Record<string, string> = { users: 'Users & roles', permissions: 'Permissions', health: 'System health', audit: 'Audit log', tokens: 'Agent & API tokens', terminal: 'Terminal' };
const MANAGER = new Set(['users', 'permissions']);

export default function AdminPage() {
  const { section } = useParams();
  const phone = useIsPhone();
  const { isAdmin } = useAuth();
  const [me, setMe] = useState<{ canManageUsers: boolean } | null>(null);
  const [people, setPeople] = useState<number | undefined>();
  const [terminal, setTerminal] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ canManageUsers: boolean }>('/users/me').then((m) => { if (live) setMe(m); }).catch(() => { if (live) setMe({ canManageUsers: false }); });
    api<{ users: unknown[] }>('/users').then((r) => { if (live) setPeople(r.users.length); }).catch(() => {});
    api<{ hasAccess: boolean }>('/terminal/check-access').then((r) => { if (live) setTerminal(r.hasAccess); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const current = section ?? (phone ? '' : 'users');
  usePageChrome(current ? [{ label: 'Admin', to: '/admin' }, { label: TITLES[current] ?? 'Admin' }] : [{ label: 'Admin' }]);

  if (!me) return <Page><Skeleton className="h-64 w-full" /></Page>;
  const allowed = (id: string) => isAdmin || (MANAGER.has(id) && me.canManageUsers) || (id === 'terminal' && terminal);
  if (!isAdmin && !me.canManageUsers && !terminal) return <Navigate to="/" replace />;

  const groups: NavGroup[] = [{
    label: 'Admin', note: isAdmin ? 'Only admins see this area.' : undefined, items: [
      { id: 'users', label: 'Users & roles', icon: <Users />, count: people, hidden: !allowed('users') },
      { id: 'permissions', label: 'Permissions', icon: <ShieldCheck />, hidden: !allowed('permissions') },
      { id: 'health', label: 'System health', icon: <Activity />, hidden: !allowed('health') },
      { id: 'audit', label: 'Audit log', icon: <ScrollText />, hidden: !allowed('audit') },
      { id: 'tokens', label: 'Agent & API tokens', icon: <Bot />, hidden: !allowed('tokens') },
      { id: 'terminal', label: 'Terminal', icon: <SquareTerminal />, hidden: !allowed('terminal') },
    ],
  }];

  if (!current) return <Page><h1 className="mb-5 text-[24px] font-semibold">Admin</h1><NavList base="/admin" groups={groups} /></Page>;
  if (!TITLES[current]) return <NotFound />;
  if (!allowed(current)) return <Navigate to={`/admin/${groups[0].items.find((i) => !i.hidden)?.id ?? ''}`} replace />;

  return (
    <Page wide={current === 'permissions' || current === 'audit'}>
      {phone && <Link to="/admin" className="-mt-1 mb-3 inline-flex items-center gap-1 text-[14px] text-fg-2"><ChevronLeft className="size-4" />Admin</Link>}
      <SplitLayout nav={<SubNav base="/admin" groups={groups} current={current} />}>
        <Suspense fallback={<div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>}>
          {current === 'users' && <UsersSection onCount={setPeople} />}
          {current === 'permissions' && <Permissions />}
          {current === 'health' && <Health />}
          {current === 'audit' && <Audit />}
          {current === 'tokens' && <AgentTokens />}
          {current === 'terminal' && <Terminal />}
        </Suspense>
      </SplitLayout>
    </Page>
  );
}
