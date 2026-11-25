/**
 * /pipelines (design sheet f116; phone f124): every pipeline you can see,
 * by group, each with its last run and the commit it ran.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Play, Plus, Search, Workflow } from 'lucide-react';
import { useLive } from '../../contexts/LiveContext';
import { usePageChrome } from '../../components/shell/chrome';
import { Page, PageHeader } from '../../components/shell/states';
import { useRunsSummary } from '../../components/shell/useRuns';
import { RunCommitLine, whenLabel } from '../../components/run/RunRow';
import { RunStatusBadge, runState } from '../../components/run/status';
import { useRunActions } from '../../components/run/useRunActions';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Field';
import { EmptyState, Skeleton } from '../../components/ui/Feedback';
import CreatePipelineModal from '../../components/CreatePipelineModal';
import type { PipelineInfo } from '../../types/build';
import { allGroups } from '../../components/shell/useRuns';


export default function PipelinesPage() {
  const nav = useNavigate();
  const { pipelines, loaded, refresh } = useLive();
  const { lastByPipeline } = useRunsSummary();
  const { run } = useRunActions();
  const [params, setParams] = useSearchParams();
  const group = params.get('group') ?? '';
  const [q, setQ] = useState('');
  const creating = params.get('new') === '1';
  const setCreating = (on: boolean) => {
    const n = new URLSearchParams(params);
    if (on) n.set('new', '1'); else n.delete('new');
    setParams(n, { replace: true });
  };
  usePageChrome(
    group ? [{ label: 'Pipelines', to: '/pipelines' }, { label: group }] : [{ label: 'Pipelines' }],
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New pipeline</Button>,
    [group, params.toString()],
  );

  const byGroup = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = pipelines.filter((p) => {
      const g = p.group ?? '';
      if (group && g !== group && !g.startsWith(`${group}/`)) return false;
      return !term || `${p.appName} ${p.id} ${p.description ?? ''} ${g}`.toLowerCase().includes(term);
    });
    const m = new Map<string, PipelineInfo[]>();
    for (const p of list) {
      const g = p.group || 'Ungrouped';
      m.set(g, [...(m.get(g) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pipelines, group, q]);

  return (
    <Page>
      <PageHeader title={group || 'Pipelines'} description={group ? <Link to="/pipelines" className="hover:text-fg">← All pipelines</Link> : `${pipelines.length} pipelines you can see.`} />
      <Input className="mb-5" leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a pipeline" aria-label="Find a pipeline" />
      {!loaded ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" rounded="rounded-card" />)}</div>
      ) : byGroup.length === 0 ? (
        <EmptyState icon={<Workflow />} title={pipelines.length ? 'No pipeline matches' : 'No pipelines yet'}
          action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New pipeline</Button>{!pipelines.length && <Button onClick={() => nav('/import')}>Import a bundle</Button>}</div>}>
          {pipelines.length ? 'A pipeline is a list of shell steps in YAML. Start from a template or paste your own.' : 'Write one in YAML, or bring pipelines, groups and their settings from another EZPipeline in one .ezp file.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {byGroup.map(([g, ps]) => (
            <section key={g}>
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">{g}</h2>
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                {ps.map((p) => {
                  const last = lastByPipeline.get(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2 max-sm:flex-wrap">
                      <Link to={`/pipelines/${encodeURIComponent(p.id)}`} className="min-w-0 flex-1 basis-56">
                        <span className="flex items-center gap-2">
                          <b className="truncate text-[14.5px] font-semibold">{p.appName}</b>
                          {p.environment && <Badge env tone={/prod/i.test(p.environment) ? 'warn' : 'neutral'}>{p.environment}</Badge>}
                        </span>
                        {p.description && <span className="mt-0.5 block truncate text-[12.5px] text-fg-3">{p.description}</span>}
                      </Link>
                      <div className="min-w-0 flex-[1.2] basis-64 max-sm:order-3 max-sm:basis-full">
                        {last ? (
                          <Link to={`/runs/${last.id}`} className="flex items-center gap-3">
                            <RunStatusBadge state={runState(last)} />
                            <span className="min-w-0 flex-1"><RunCommitLine r={last} /></span>
                            <span className="hidden font-mono text-[12px] text-fg-3 md:inline">#{last.buildNumber} · {whenLabel(last.startTime)}</span>
                          </Link>
                        ) : <span className="text-[13px] text-fg-3">Never run</span>}
                      </div>
                      {p.permissions?.canRun !== false && (
                        <IconButton label={`Run ${p.appName}`} variant="secondary" onClick={() => void run(p, { open: true })}><Play className="size-4" /></IconButton>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {creating && (
        <CreatePipelineModal onClose={() => setCreating(false)} onCreated={() => void refresh()} availableGroups={allGroups(pipelines)} defaultGroup={group || undefined} />
      )}
    </Page>
  );
}
