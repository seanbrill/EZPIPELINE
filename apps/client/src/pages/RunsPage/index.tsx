/**
 * /runs (design sheet f138, phone f139): every run the person can see,
 * newest first, grouped by day, filterable by status, group, trigger and text.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Search } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { useLive } from '../../contexts/LiveContext';
import { usePageChrome } from '../../components/shell/chrome';
import { Page, PageHeader } from '../../components/shell/states';
import { sortRuns } from '../../components/shell/useRuns';
import { RunCard, RunRow } from '../../components/run/RunRow';
import { runState, triggerOf } from '../../components/run/status';
import { RunPipelineButton } from '../../components/run/RunPipelineButton';
import { Input, Select } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Tabs';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { useIsPhone } from '../../hooks/useMediaQuery';
import type { BuildHistoryEntry } from '../../types/build';

type StatusFilter = 'all' | 'running' | 'approval' | 'failed' | 'success';
const PAGE = 50;

function dayOf(iso: string) {
  const d = new Date(iso);
  return isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE d MMMM');
}

export default function RunsPage() {
  usePageChrome([{ label: 'Runs' }], <RunPipelineButton />);
  const phone = useIsPhone();
  const { history, pipelines, loaded, error, refresh } = useLive();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = (params.get('status') as StatusFilter) || 'all';
  const group = params.get('group') ?? '';
  const trigger = params.get('trigger') ?? '';
  const pipeline = params.get('pipeline') ?? '';
  const [limit, setLimit] = useState(PAGE);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
    setLimit(PAGE);
  };

  const all = useMemo(() => sortRuns(history), [history]);
  const counts = useMemo(() => ({
    running: all.filter((r) => r.status === 'running').length,
    approval: all.filter((r) => r.status === 'paused').length,
  }), [all]);
  const groups = useMemo(() => [...new Set(pipelines.map((p) => (p.group ?? '').split('/')[0]).filter(Boolean))].sort(), [pipelines]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^#/, '');
    return all.filter((r) => {
      const s = runState(r);
      if (status === 'running' && !(s === 'running' || s === 'starting')) return false;
      if (status === 'approval' && s !== 'approval') return false;
      if (status === 'failed' && !(s === 'failed' || s === 'warning')) return false;
      if (status === 'success' && s !== 'success') return false;
      if (group && (r.group ?? '').split('/')[0] !== group) return false;
      if (pipeline && r.pipelineId !== pipeline) return false;
      if (trigger && triggerOf(r.triggeredBy).kind !== trigger) return false;
      if (term) {
        const hay = [r.pipelineName, String(r.buildNumber), r.commitSha ?? '', ...(r.commits ?? []).flatMap((c) => [c.sha, c.subject, c.author])].join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [all, q, status, group, trigger, pipeline]);

  const shown = filtered.slice(0, limit);
  const byDay: [string, BuildHistoryEntry[]][] = [];
  for (const r of shown) {
    const d = dayOf(r.startTime);
    if (byDay.length && byDay[byDay.length - 1][0] === d) byDay[byDay.length - 1][1].push(r);
    else byDay.push([d, [r]]);
  }

  const statusSeg = (
    <Segmented label="Status" value={status} onChange={(v) => setParam('status', v)} className={phone ? 'w-max' : undefined}
      items={[
        { id: 'all', label: 'All' },
        { id: 'running', label: <>Running{counts.running ? <span className="ml-1 font-mono text-[11px] text-run">{counts.running}</span> : null}</> },
        { id: 'approval', label: <>Needs you{counts.approval ? <span className="ml-1 font-mono text-[11px] text-warn">{counts.approval}</span> : null}</> },
        { id: 'failed', label: 'Failed' },
        { id: 'success', label: 'Succeeded' },
      ]} />
  );

  return (
    <Page>
      {!phone && (
        <PageHeader title="Runs" description={`Every run you can see, newest first.${counts.running ? ` ${counts.running} running.` : ''}${counts.approval ? ` ${counts.approval} waiting for you.` : ''}`} />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Input className="min-w-[240px] flex-1" leading={<Search />} value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Pipeline, run number, commit sha or message" aria-label="Search runs" />
        <div className={phone ? '-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none]' : ''}>{statusSeg}</div>
        <Select aria-label="Group" value={group} onChange={(e) => setParam('group', e.target.value)} className="w-auto">
          <option value="">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
        <Select aria-label="Trigger" value={trigger} onChange={(e) => setParam('trigger', e.target.value)} className="w-auto">
          <option value="">Any trigger</option><option value="auto">Git watch</option><option value="schedule">Schedule</option><option value="person">A person</option>
        </Select>
      </div>

      {!loaded ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" rounded="rounded-box" />)}</div>
      ) : error && !history.length ? (
        <ErrorState title="Runs could not be loaded" detail={error} action={<Button onClick={() => void refresh()}>Try again</Button>} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Activity />} title={all.length ? 'No runs match these filters' : 'No runs yet'}>
          {all.length ? 'Clear a filter or search for something else.' : 'Run a pipeline and it shows up here, live.'}
        </EmptyState>
      ) : phone ? (
        <div className="flex flex-col gap-2.5">
          {byDay.map(([day, runs]) => (
            <div key={day} className="flex flex-col gap-2.5">
              <div className="mt-2 px-1 text-[13px] font-semibold text-fg-3">{day}</div>
              {runs.map((r) => <RunCard key={r.id} r={r} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="grid h-9 grid-cols-[118px_220px_minmax(0,1fr)_112px_92px_118px] items-center gap-4 border-b border-line px-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
            <span>Status</span><span>Run</span><span>Commit · trigger</span><span>Steps</span><span>Duration</span><span className="text-right">Started</span>
          </div>
          {byDay.map(([day, runs]) => (
            <div key={day}>
              <div className="border-b border-line bg-bg-2 px-[18px] pb-1.5 pt-2.5 text-[12px] font-semibold text-fg-2">{day} <span className="font-normal text-fg-3">· {runs.length} run{runs.length === 1 ? '' : 's'}</span></div>
              {runs.map((r) => <RunRow key={r.id} r={r} />)}
            </div>
          ))}
        </div>
      )}
      {filtered.length > limit && (
        <div className="mt-4 flex items-center gap-3 text-[12.5px] text-fg-3">
          <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>Load older runs</Button>
          Showing {shown.length} of {filtered.length}
        </div>
      )}
    </Page>
  );
}
