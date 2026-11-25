/**
 * /pipelines/:id/:tab? (design sheet f39, f116; phone f125).
 *
 * History is the run list for this one pipeline, each run a card that opens
 * into v1's step grid, with the commits that have not been deployed yet above
 * it. The other tabs open the pipeline editor until Phase 5 brings them onto
 * this page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, FileArchive, GitBranch, MoreHorizontal, Play, Trash2 } from 'lucide-react';
import { useLive } from '../../contexts/LiveContext';
import { api } from '../../lib/api';
import { usePageChrome } from '../../components/shell/chrome';
import { Tour } from '../../components/onboarding/Tour';
import { NotFound, Page } from '../../components/shell/states';
import { sortRuns } from '../../components/shell/useRuns';
import { RunCommitLine, TriggerPill, whenLabel } from '../../components/run/RunRow';
import { RunStatusBadge, runState } from '../../components/run/status';
import { StepGrid } from '../../components/run/StepGrid';
import { runElapsed, tilesFor, useNow } from '../../components/run/model';
import { useRunActions } from '../../components/run/useRunActions';
import { formatDurationCompact } from '../../helpers/formatDuration';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { cx } from '../../components/ui/cx';
import { IconButton } from '../../components/ui/Button';
import { Menu } from '../../components/ui/Menu';
import { EnvPanel } from '../../components/pipeline/EnvPanel';
import { ResourcesPanel } from '../../components/pipeline/ResourcesPanel';
import { SchedulePanel } from '../../components/pipeline/SchedulePanel';
import { WatchesPanel } from '../../components/pipeline/WatchesPanel';
import { PipelineEditor } from '../../components/pipeline/PipelineEditor';
import VersionsTab from '../../components/pipeline/VersionsTab';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { ExportModal } from '../../components/data/ExportModal';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import type { BuildHistoryEntry, Commit } from '../../types/build';

type TabId = 'history' | 'steps' | 'environment' | 'resources' | 'schedule' | 'auto-deploy' | 'versions';
const TABS: { id: TabId; label: string }[] = [
  { id: 'history', label: 'History' }, { id: 'steps', label: 'Steps & YAML' }, { id: 'environment', label: 'Environment' },
  { id: 'resources', label: 'Resources' }, { id: 'schedule', label: 'Schedule' }, { id: 'auto-deploy', label: 'Auto deploy' }, { id: 'versions', label: 'Versions' },
];

function RunHistoryCard({ r, open, onToggle }: { r: BuildHistoryEntry; open: boolean; onToggle: () => void }) {
  const state = runState(r);
  const live = state === 'running' || state === 'starting' || state === 'approval';
  const now = useNow(live);
  const el = runElapsed(r, now);
  const nav = useNavigate();
  return (
    <div className={cx('rounded-card border bg-surface', state === 'approval' ? 'border-warn-line' : 'border-line')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left">
        <RunStatusBadge state={state} />
        <span className="font-mono text-[13px] text-fg-2">#{r.buildNumber}</span>
        <span className="min-w-0 flex-1 basis-60"><RunCommitLine r={r} /></span>
        <TriggerPill triggeredBy={r.triggeredBy} />
        <span className="w-16 text-right font-mono text-[12.5px]">{el != null ? formatDurationCompact(el) : '—'}</span>
        <span className="w-28 text-right font-mono text-[12px] text-fg-3 max-sm:hidden">{whenLabel(r.startTime)}</span>
        <ChevronDown className={cx('size-4 text-fg-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <StepGrid tiles={tilesFor(r, now)} onSelect={() => nav(`/runs/${r.id}`)} />
          <div className="mt-3 flex justify-end"><Link to={`/runs/${r.id}`} className="text-[13px] text-primary-hi hover:underline">Open run and logs →</Link></div>
        </div>
      )}
    </div>
  );
}

function NotDeployed({ pipelineId }: { pipelineId: string }) {
  const { history } = useLive();
  const [data, setData] = useState<{ commits: Commit[]; branch: string | null; reason?: string } | null>(null);
  const lastSuccess = history.find((h) => h.pipelineId === pipelineId && h.status === 'success')?.id;
  useEffect(() => {
    api<{ commits: Commit[]; branch: string | null; reason?: string }>(`/pipelines/${encodeURIComponent(pipelineId)}/pending-commits`)
      .then(setData).catch(() => setData(null));
  }, [pipelineId, lastSuccess]);
  if (!data || data.reason === 'no-watch' || data.commits.length === 0) return null;
  return (
    <Card className="!p-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13.5px]">
        <GitBranch className="size-4 text-auto" />
        <b className="font-semibold">{data.commits.length} new commit{data.commits.length === 1 ? '' : 's'} on {data.branch}</b>
        <span className="text-fg-3">not deployed yet</span>
      </div>
      <ul>
        {data.commits.slice(0, 6).map((c) => (
          <li key={c.sha} className="flex items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0">
            <span className="font-mono text-fg-3">{c.shortSha ?? c.sha.slice(0, 7)}</span>
            <span className="min-w-0 flex-1 truncate">{c.subject}</span>
            <span className="text-fg-3 max-sm:hidden">{c.author}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function PipelinePage() {
  const { id = '', tab = 'history' } = useParams();
  const nav = useNavigate();
  const { pipelines, history, loaded, refresh } = useLive();
  const { run } = useRunActions();
  const p = pipelines.find((x) => x.id === id);
  const runs = useMemo(() => sortRuns(history.filter((h) => h.pipelineId === id)), [history, id]);
  const [openRun, setOpenRun] = useState<string | null | undefined>(undefined);
  const { confirm } = useConfirm();
  const toast = useToast();
  const [dirty, setDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { isAdmin } = useAuth();
  const guard = useUnsavedGuard(dirty);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);
  const current = (TABS.some((t) => t.id === tab) ? tab : 'history') as TabId;
  const go = (t: TabId) => void guard(() => nav(`/pipelines/${encodeURIComponent(id)}/${t === 'history' ? '' : t}`));

  const remove = async () => {
    if (!p) return;
    const fp = await api<{ runs: number; schedules: number; watches: number; live: number }>(`/pipelines/${encodeURIComponent(p.id)}/footprint`).catch(() => null);
    if (fp?.live) { toast.error('A run of this pipeline is going', { description: 'Cancel it first, then delete the pipeline.' }); return; }
    const parts = fp ? [`${fp.runs} run${fp.runs === 1 ? '' : 's'} and their logs`, fp.schedules ? `${fp.schedules} schedule${fp.schedules === 1 ? '' : 's'}` : '', fp.watches ? `${fp.watches} branch watch${fp.watches === 1 ? '' : 'es'}` : '', 'its files, environment and resources'].filter(Boolean) : ['its files and history'];
    const ok = await confirm({ title: `Delete ${p.appName}?`, message: <>This removes {parts.join(', ')}. It cannot be undone.</>, confirmText: 'Delete pipeline', isDangerous: true, requireText: p.appName });
    if (!ok) return;
    try {
      await api(`/pipelines/${encodeURIComponent(p.id)}`, { method: 'DELETE', body: { confirm: p.appName } });
      toast.success(`${p.appName} deleted`);
      await refresh();
      nav('/pipelines');
    } catch (e) { toast.error('Could not delete it', { description: (e as Error).message }); }
  };

  usePageChrome(
    p ? [{ label: 'Pipelines', to: '/pipelines' }, ...(p.group ? [{ label: p.group, to: `/groups/${p.group.split('/').map(encodeURIComponent).join('/')}` }] : []), { label: p.appName }] : [{ label: 'Pipelines', to: '/pipelines' }],
    p ? (
      <div className="flex items-center gap-2">
        {p.permissions?.canEditYaml !== false && (
          <Menu title={p.appName} trigger={<IconButton label="More"><MoreHorizontal className="size-4" /></IconButton>}
            items={[...(isAdmin ? [{ label: 'Export pipeline…', icon: <FileArchive className="size-4" />, onSelect: () => setExporting(true) }] : []), { label: 'Delete pipeline…', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => void remove() }]} />
        )}
        {p.permissions?.canRun !== false && <Button data-tour="run" variant="primary" icon={<Play className="size-4" />} onClick={() => void run(p, { open: true })}>Run</Button>}
      </div>
    ) : undefined,
    [p?.id, isAdmin],
  );

  if (!loaded) return <Page><Skeleton className="h-32 w-full" rounded="rounded-card" /></Page>;
  if (!p) return <NotFound />;
  const expanded = openRun === undefined ? runs[0]?.id ?? null : openRun;

  return (
    <Page wide={current === 'steps'}>
      <Tour steps={p.steps?.length ?? 0} />
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{p.appName}</h1>
          {p.environment && <Badge env tone={/prod/i.test(p.environment) ? 'warn' : 'neutral'}>{p.environment}</Badge>}
        </div>
        {p.description && <p className="mt-1 max-w-[70ch] text-[14px] text-fg-2">{p.description}</p>}
        <p className="mt-1 font-mono text-[12px] text-fg-3">{p.id}{p.group ? ` · ${p.group}` : ''}</p>
      </div>
      <Tabs className="mb-5" value={current} onChange={go}
        items={TABS.map((t) => ({ id: t.id, label: t.label, count: t.id === 'history' ? runs.length : undefined }))} />

      {current === 'steps' && (p.filePath
        ? <PipelineEditor filePath={p.filePath} canEdit={p.permissions?.canEditYaml !== false} onSaved={() => void refresh()} onDirty={onDirty} />
        : <Card>This pipeline&rsquo;s file could not be found.</Card>)}
      {current === 'environment' && <EnvPanel scope={{ pipeline: p.id }} />}
      {current === 'resources' && <ResourcesPanel scope={{ pipeline: p.id }} />}
      {current === 'schedule' && <SchedulePanel pipelineId={p.id} canEdit={p.permissions?.canRun !== false} />}
      {current === 'auto-deploy' && <WatchesPanel pipelineId={p.id} />}
      {current === 'versions' && <Card><VersionsTab pipelineTarget={p.id} /></Card>}

      {current === 'history' && <div className="flex flex-col gap-3">
        <NotDeployed pipelineId={id} />
        {runs.length === 0 ? (
          <Card pad={false}><EmptyState icon={<Play />} title="This pipeline has not run yet"
            action={p.permissions?.canRun !== false ? <Button variant="primary" icon={<Play className="size-4" />} onClick={() => void run(p, { open: true })}>Run it now</Button> : undefined}>
            Each run appears here with its commit, its steps and its log.
          </EmptyState></Card>
        ) : runs.slice(0, 60).map((r) => (
          <RunHistoryCard key={r.id} r={r} open={expanded === r.id} onToggle={() => setOpenRun(expanded === r.id ? null : r.id)} />
        ))}
        {runs.length > 60 && <Link to={`/runs?pipeline=${encodeURIComponent(id)}`} className="text-[13px] text-fg-2 hover:text-fg">All {runs.length} runs →</Link>}
      </div>}
      {p && <ExportModal open={exporting} onClose={() => setExporting(false)} initial={{ type: 'pipeline', pipeline: p.id }} />}
    </Page>
  );
}
