/**
 * Settings (design sheet f21–f28, f145–f148). Personal things anyone has;
 * the instance's things for admins. One URL per section, so a link or the
 * back button lands where you were. On a phone, /settings is the list (f27)
 * and each section is its own page.
 */
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ChevronLeft, Database, FileText, KeyRound, Palette, Plug, Server, Settings2, UserCircle, Variable } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useIsPhone } from '../../hooks/useMediaQuery';
import { usePageChrome } from '../../components/shell/chrome';
import { Page, NotFound } from '../../components/shell/states';
import { NavList, PageHead, SplitLayout, SubNav, type NavGroup } from '../../components/settings/kit';
import { EnvPanel } from '../../components/pipeline/EnvPanel';
import { ResourcesPanel } from '../../components/pipeline/ResourcesPanel';
import { Skeleton } from '../../components/ui/Feedback';
import { api } from '../../lib/api';
import { installsSnapshot, subscribeInstalls } from '../../lib/pluginInstall';

const Account = lazy(() => import('./Account'));
const Appearance = lazy(() => import('./Appearance'));
const Tokens = lazy(() => import('./Tokens'));
const General = lazy(() => import('./General'));
const Plugins = lazy(() => import('./Plugins'));
const Data = lazy(() => import('./Data'));
const SelfHosting = lazy(() => import('./SelfHosting'));

const LEGACY: Record<string, string> = { account: 'account', general: 'general', env: 'environment', resources: 'resources', plugins: 'plugins', users: '/admin/users', system: '/admin/health' };
const TITLES: Record<string, string> = { account: 'Account', appearance: 'Appearance', tokens: 'API tokens', general: 'General', environment: 'Environment', resources: 'Resources', plugins: 'Plugins', data: 'Data', 'self-hosting': 'Self-hosting' };
const ADMIN_ONLY = new Set(['general', 'environment', 'resources', 'data', 'self-hosting']);

export default function SettingsPage() {
  const { section } = useParams();
  const { search } = useLocation();
  const phone = useIsPhone();
  const { isAdmin } = useAuth();
  const { theme } = useTheme();
  const installs = useSyncExternalStore(subscribeInstalls, installsSnapshot);
  const installing = installs.filter((i) => i.state === 'installing' || i.state === 'queued').length;
  const [tokens, setTokens] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api<{ tokens: unknown[] }>('/me/tokens').then((r) => { if (live) setTokens(r.tokens.length); }).catch(() => {});
    return () => { live = false; };
  }, [section]);

  const current = section ?? (phone ? '' : 'account');
  usePageChrome(current ? [{ label: 'Settings', to: '/settings' }, { label: TITLES[current] ?? 'Settings' }] : [{ label: 'Settings' }]);

  // Old links: /settings?tab=users and friends.
  const legacy = new URLSearchParams(search).get('tab');
  if (legacy && LEGACY[legacy]) {
    const to = LEGACY[legacy];
    return <Navigate to={to.startsWith('/') ? to : `/settings/${to}`} replace />;
  }

  const groups: NavGroup[] = [
    { label: 'Personal', items: [
      { id: 'account', label: 'Account', icon: <UserCircle /> },
      { id: 'appearance', label: 'Appearance', icon: <Palette />, value: theme[0].toUpperCase() + theme.slice(1) },
      { id: 'tokens', label: 'API tokens', icon: <KeyRound />, count: tokens || undefined, value: tokens ? String(tokens) : undefined },
    ] },
  ];
  if (isAdmin) groups.push({ label: phone ? 'Instance · admins' : 'Instance', items: [
    { id: 'general', label: 'General', icon: <Settings2 /> },
    { id: 'environment', label: 'Environment', icon: <Variable /> },
    { id: 'resources', label: 'Resources', icon: <FileText /> },
    { id: 'plugins', label: 'Plugins', icon: <Plug />, dot: installing > 0, value: installing ? `${installing} installing` : undefined },
    { id: 'data', label: 'Data', icon: <Database /> },
    { id: 'self-hosting', label: 'Self-hosting', icon: <Server /> },
  ] });
  else groups[0].items.push({ id: 'plugins', label: 'Plugins', icon: <Plug /> });

  if (!current) return <Page><h1 className="mb-5 text-[24px] font-semibold">Settings</h1><NavList base="/settings" groups={groups} /></Page>;
  if (!TITLES[current]) return <NotFound />;
  if (ADMIN_ONLY.has(current) && !isAdmin) return <Navigate to="/settings/account" replace />;

  return (
    <Page>
      {phone && <Link to="/settings" className="-mt-1 mb-3 inline-flex items-center gap-1 text-[14px] text-fg-2"><ChevronLeft className="size-4" />Settings</Link>}
      <SplitLayout nav={<SubNav base="/settings" groups={groups} current={current} />}>
        <Suspense fallback={<div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>}>
          <Section id={current} />
        </Suspense>
      </SplitLayout>
    </Page>
  );
}

function Section({ id }: { id: string }) {
  switch (id) {
    case 'account': return <Account />;
    case 'appearance': return <Appearance />;
    case 'tokens': return <Tokens />;
    case 'general': return <General />;
    case 'plugins': return <Plugins />;
    case 'environment':
      return (
        <>
          <PageHead title="Environment" lede="Variables every pipeline on this instance gets. A group or pipeline value with the same key wins." />
          <EnvPanel scope={{ global: true }} />
        </>
      );
    case 'resources':
      return (
        <>
          <PageHead title="Resources" lede={<>Files every run gets in <code className="font-mono text-[13px]">$RESOURCES</code>. A group or pipeline file with the same name wins.</>} />
          <ResourcesPanel scope={{ global: true }} />
        </>
      );
    case 'data': return <Data />;
    case 'self-hosting': return <SelfHosting />;
    default: return null;
  }
}
