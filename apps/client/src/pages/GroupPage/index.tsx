/**
 * /groups/<path>/<tab>? (design sheet f44, f45, f143, f144; phone f128).
 *
 * A group is a real page, not a settings modal: what its pipelines are doing,
 * then what it gives them (environment, files, auto deploy, git credentials).
 * Subgroups are folders below it and have the same page.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileArchive, FolderOpen, FolderPlus, MoreHorizontal, Play, Plus, Upload } from 'lucide-react';
import { useLive } from '../../contexts/LiveContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { ExportModal } from '../../components/data/ExportModal';
import { Menu } from '../../components/ui/Menu';
import { IconButton } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { usePageChrome } from '../../components/shell/chrome';
import { NotFound, Page } from '../../components/shell/states';
import { allGroups, sortRuns } from '../../components/shell/useRuns';
import { RunCard, RunRow, RunCommitLine, TriggerPill, whenLabel } from '../../components/run/RunRow';
import { RunStatusBadge, runState } from '../../components/run/status';
import { RunSegments } from '../../components/run/StepGrid';
import { stepStates } from '../../components/run/model';
import { useRunActions } from '../../components/run/useRunActions';
import { EnvPanel } from '../../components/pipeline/EnvPanel';
import { ResourcesPanel } from '../../components/pipeline/ResourcesPanel';
import { WatchesPanel } from '../../components/pipeline/WatchesPanel';
import GitCredentialManager from '../../components/Shared/GitCredentialManager';
import CreatePipelineModal from '../../components/CreatePipelineModal';
import CreateGroupModal from '../../components/CreateGroupModal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { cx } from '../../components/ui/cx';
import { useIsPhone } from '../../hooks/useMediaQuery';
import type { PipelineInfo } from '../../types/build';

type TabId = 'pipelines' | 'environment' | 'resources' | 'auto-deploy' | 'credentials';
const TABS: { id: TabId; label: string }[] = [
  { id: 'pipelines', label: 'Pipelines' }, { id: 'environment', label: 'Environment' }, { id: 'resources', label: 'Resources' },
  { id: 'auto-deploy', label: 'Auto deploy' }, { id: 'credentials', label: 'Credentials' },
];

const groupUrl = (g: string, tab?: TabId) => `/groups/${g.split('/').map(encodeURIComponent).join('/')}${tab && tab !== 'pipelines' ? `/${tab}` : ''}`;

function PipelineCard({ p }: { p: PipelineInfo }) {
  const { history } = useLive();
  const { run } = useRunActions();
  const nav = useNavigate();
  const last = useMemo(() => sortRuns(history.filter((h) => h.pipelineId === p.id))[0], [history, p.id]);
  const state = last ? runState(last) : null;
  const live = state === 'running' || state === 'starting' || state === 'approval';
  return (
    <Card pad={false} className={cx('flex flex-col gap-3 p-4', live && 'border-run-line shadow-[0_0_0_1px_var(--run-line)]')}>
      <div className="flex items-center gap-2">
        {state ? <RunStatusBadge state={state} /> : <Badge>never run</Badge>}
        <Link to={`/pipelines/${encodeURIComponent(p.id)}`} className="min-w-0 truncate text-[15px] font-semibold hover:underline">{p.appName}</Link>
        {p.environment && <Badge env tone={/prod/i.test(p.environment) ? 'warn' : 'neutral'}>{p.environment}</Badge>}
      </div>
      {p.description && <p className="line-clamp-1 text-[13px] text-fg-3">{p.description}</p>}
      {last ? <RunCommitLine r={last} /> : <p className="text-[13px] text-fg-3">No runs yet.</p>}
      {last && <RunSegments states={stepStates(last)} />}
      <div className="flex items-center gap-2 text-[12.5px] text-fg-3">
        {last && <><span className="font-mono">#{last.buildNumber}</span><span>·</span><span>{whenLabel(last.startTime)}</span><TriggerPill triggeredBy={last.triggeredBy} /></>}
        <span className="flex-1" />
        {live && last ? <Button size="sm" onClick={() => nav(`/runs/${last.id}`)}>View run</Button>
          : p.permissions?.canRun !== false && <Button size="sm" icon={<Play className="size-3.5" />} onClick={() => void run(p)}>Run</Button>}
      </div>
    </Card>
  );
}

export default function GroupPage() {
  const params = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const phone = useIsPhone();
  const { pipelines, history, loaded, refresh } = useLive();
  const [creating, setCreating] = useState(false);
  const [subgroup, setSubgroup] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { isAdmin } = useAuth();

  const parts = (params['*'] ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  const hasTab = TABS.some((t) => t.id === parts[parts.length - 1]);
  const tab: TabId = hasTab ? (parts[parts.length - 1] as TabId) : 'pipelines';
  const segs = hasTab ? parts.slice(0, -1) : parts;
  const group = segs.join('/');
  const groups = allGroups(pipelines);

  const inside = pipelines.filter((p) => (p.group ?? '') === group || (p.group ?? '').startsWith(`${group}/`));
  const direct = inside.filter((p) => (p.group ?? '') === group);
  const subs = groups.filter((g) => g.startsWith(`${group}/`) && g.split('/').length === segs.length + 1);
  const runs = sortRuns(history.filter((h) => inside.some((p) => p.id === h.pipelineId)));
  const running = runs.filter((r) => r.status === 'running').length;
  const waiting = runs.filter((r) => r.status === 'paused').length;
  const canWrite = inside.some((p) => p.permissions?.canEditYaml !== false);

  usePageChrome(
    [{ label: 'Pipelines', to: '/pipelines' }, ...segs.map((s, i) => (i === segs.length - 1 ? { label: s } : { label: s, to: groupUrl(segs.slice(0, i + 1).join('/')) }))],
    canWrite ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{phone ? 'New' : 'New pipeline'}</Button> : undefined,
    [group, canWrite, phone],
  );

  if (!loaded) return <Page><Skeleton className="h-40 w-full" rounded="rounded-card" /></Page>;
  if (!group || !groups.includes(group)) return <NotFound />;

  const makeSubgroup = async (name: string) => {
    try {
      await api('/config/create-folder', { body: { type: 'yaml', path: `${group}/${name}` } });
      setSubgroup(false);
      toast.success(`${group}/${name} created`, { description: 'Add a pipeline to it and it appears in the sidebar.' });
    } catch (e) { toast.error('Could not create it', { description: (e as Error).message }); }
  };

  return (
    <Page>
      <div className="mb-5 flex flex-wrap items-center gap-3.5">
        <span className="grid size-12 place-items-center rounded-card border border-line-2 bg-surface-2 text-fg-2"><FolderOpen className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{segs[segs.length - 1]}</h1>
            {running > 0 && <Badge tone="run" dot live>{running} running</Badge>}
            {waiting > 0 && <Badge tone="warn" dot>{waiting} waiting</Badge>}
          </div>
          <p className="mt-1 text-[13.5px] text-fg-3">
            {inside.length} pipeline{inside.length === 1 ? '' : 's'}{subs.length > 0 && ` · ${subs.length} subgroup${subs.length === 1 ? '' : 's'}`}
            {segs.length > 1 && <> · in <Link className="text-primary-hi hover:underline" to={groupUrl(segs.slice(0, -1).join('/'))}>{segs.slice(0, -1).join('/')}</Link></>}
          </p>
        </div>
        {canWrite && <Button icon={<FolderPlus className="size-4" />} onClick={() => setSubgroup(true)}>New subgroup</Button>}
        {isAdmin && (
          <Menu title={segs[segs.length - 1]} trigger={<IconButton label="More for this group"><MoreHorizontal className="size-4" /></IconButton>}
            items={[
              { label: 'Export group…', icon: <FileArchive className="size-4" />, onSelect: () => setExporting(true) },
              { label: `Import into ${segs[segs.length - 1]}…`, icon: <Upload className="size-4" />, onSelect: () => nav(`/import?into=${encodeURIComponent(group)}`) },
            ]} />
        )}
      </div>

      <Tabs className="mb-5" value={tab} onChange={(t) => nav(groupUrl(group, t))}
        items={TABS.map((t) => ({ id: t.id, label: t.label, count: t.id === 'pipelines' ? inside.length : undefined }))} />

      {tab === 'pipelines' && (
        <div className="flex flex-col gap-6">
          {inside.length === 0 ? (
            <Card pad={false}><EmptyState icon={<FolderOpen />} title="No pipelines here yet"
              action={canWrite ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New pipeline</Button> : undefined}>
              A pipeline created in {group} gets this group&rsquo;s environment, files and git credentials.
            </EmptyState></Card>
          ) : (
            <>
              {direct.length > 0 && <div className="grid gap-3 md:grid-cols-2">{direct.map((p) => <PipelineCard key={p.id} p={p} />)}</div>}
              {subs.map((sg) => {
                const ps = inside.filter((p) => (p.group ?? '') === sg || (p.group ?? '').startsWith(`${sg}/`));
                return (
                  <section key={sg}>
                    <Link to={groupUrl(sg)} className="mb-2.5 inline-flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-fg-3 hover:text-fg"><FolderOpen className="size-3.5" />{sg.split('/').pop()} · {ps.length}</Link>
                    <div className="grid gap-3 md:grid-cols-2">{ps.map((p) => <PipelineCard key={p.id} p={p} />)}</div>
                  </section>
                );
              })}
            </>
          )}
          {runs.length > 0 && (
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold">Recent runs in {segs[segs.length - 1]}</h2>
                <Link to={`/runs?group=${encodeURIComponent(segs[0])}`} className="text-[13px] text-primary-hi hover:underline">All runs →</Link>
              </div>
              {phone ? <div className="flex flex-col gap-2.5">{runs.slice(0, 6).map((r) => <RunCard key={r.id} r={r} />)}</div>
                : <Card pad={false} className="overflow-hidden">{runs.slice(0, 6).map((r) => <RunRow key={r.id} r={r} />)}</Card>}
            </section>
          )}
        </div>
      )}
      {tab === 'environment' && <EnvPanel scope={{ group }} />}
      {tab === 'resources' && <ResourcesPanel scope={{ group }} />}
      {tab === 'auto-deploy' && <WatchesPanel group={group} />}
      {tab === 'credentials' && <Card><GitCredentialManager group={group} /></Card>}

      {creating && <CreatePipelineModal onClose={() => setCreating(false)} onCreated={() => void refresh()} availableGroups={groups} defaultGroup={group} />}
      {subgroup && <CreateGroupModal parentPath={group} onClose={() => setSubgroup(false)} onConfirm={(n) => void makeSubgroup(n)} />}
      <ExportModal open={exporting} onClose={() => setExporting(false)} initial={{ type: 'group', group }} />
    </Page>
  );
}
