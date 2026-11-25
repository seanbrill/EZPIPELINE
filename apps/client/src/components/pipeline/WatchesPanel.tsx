/**
 * Auto deploy: the git watches of a group's pipelines, or of one pipeline
 * (design sheet f144). Each row is branch → pipeline, whether its gates are
 * passed automatically (amber: it skips a person), the last commit it saw and
 * what it did with it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowRight, Check, GitBranch, MoreHorizontal, Plus, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useLive } from '../../contexts/LiveContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { Button, IconButton } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Switch } from '../ui/Toggle';
import { Menu } from '../ui/Menu';
import { Badge } from '../ui/Badge';
import { Card, EmptyState, ErrorState, Skeleton } from '../ui/Feedback';
import { cx } from '../ui/cx';

interface Watch {
  id: number; pipeline_target: string; group_path: string | null; repo_url: string; branch: string; poll_seconds: number;
  enabled: number; auto_approve: number; last_sha: string | null; last_checked_at: string | null; last_triggered_at: string | null; last_error: string | null;
}

const ago = (s: string | null) => (s ? formatDistanceToNowStrict(new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`), { addSuffix: true }) : null);
const shortRepo = (u: string) => u.replace(/^git@([^:]+):/, '$1/').replace(/^https?:\/\//, '').replace(/\.git$/, '');

export function WatchesPanel({ group, pipelineId }: { group?: string; pipelineId?: string }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const { pipelines, history } = useLive();
  const [list, setList] = useState<Watch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ repoUrl: '', branch: 'main', pipeline: pipelineId ?? '', autoApprove: false });
  const [probe, setProbe] = useState<{ ok: boolean; sha?: string; error?: string } | 'checking' | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = useMemo(() => pipelines.filter((p) => (pipelineId ? p.id === pipelineId : group && ((p.group ?? '') === group || (p.group ?? '').startsWith(`${group}/`)))), [pipelines, group, pipelineId]);
  const load = useCallback(() => {
    api<{ watches: Watch[] }>('/git-watches').then((r) => { setList(r.watches); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const rows = (list ?? []).filter((w) => mine.some((p) => p.id === w.pipeline_target || p.appName === w.pipeline_target));
  const nameOf = (t: string) => mine.find((p) => p.id === t || p.appName === t)?.appName ?? t;
  const editable = (t: string) => mine.find((p) => p.id === t || p.appName === t)?.permissions?.canEditYaml !== false;

  const patch = async (w: Watch, body: Record<string, unknown>) => {
    try { await api(`/git-watches/${w.id}`, { method: 'PATCH', body }); load(); }
    catch (e) { toast.error('Could not change it', { description: (e as Error).message }); }
  };
  const setAuto = async (w: Watch, on: boolean) => {
    if (on && !(await confirm({ title: `Approve ${nameOf(w.pipeline_target)}’s gates automatically?`, message: `Runs this watch starts on ${w.branch} will pass every approval gate without anyone looking. A run someone starts by hand still waits.`, confirmText: 'Approve automatically', isDangerous: true }))) return;
    void patch(w, { autoApprove: on });
  };
  const remove = async (w: Watch) => {
    if (!(await confirm({ title: `Stop watching ${w.branch}?`, message: `${nameOf(w.pipeline_target)} will no longer run when ${w.branch} moves.`, confirmText: 'Stop watching', isDangerous: true }))) return;
    try { await api(`/git-watches/${w.id}`, { method: 'DELETE' }); load(); } catch (e) { toast.error('Could not remove it', { description: (e as Error).message }); }
  };

  const check = async () => {
    if (!form.repoUrl.trim() || !form.branch.trim()) return;
    setProbe('checking');
    try { setProbe(await api('/git-watches/probe', { body: { repoUrl: form.repoUrl.trim(), branch: form.branch.trim(), groupPath: group ?? mine[0]?.group ?? null } })); }
    catch (e) { setProbe({ ok: false, error: (e as Error).message }); }
  };
  const add = async () => {
    const p = mine.find((x) => x.id === form.pipeline);
    if (!p) return;
    setBusy(true);
    try {
      await api('/git-watches', { body: { pipelineTarget: p.id, groupPath: p.group ?? null, repoUrl: form.repoUrl.trim(), branch: form.branch.trim(), autoApprove: form.autoApprove } });
      toast.success(`Watching ${form.branch.trim()}`, { description: `${p.appName} runs when it moves.` });
      setAdding(false); setProbe(null);
      load();
    } catch (e) { toast.error('Could not start watching', { description: (e as Error).message }); }
    setBusy(false);
  };

  if (err) return <ErrorState title="Could not load the watches" detail={err} action={<Button onClick={load}>Try again</Button>} />;
  if (!list) return <Skeleton className="h-40 w-full" rounded="rounded-card" />;
  const canAdd = mine.some((p) => p.permissions?.canEditYaml !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-3">A watch checks a branch every minute and runs a pipeline when it moves. The run knows its commit before it starts.</p>
      <Card pad={false} className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <b className="text-[13px] font-semibold">{rows.length} watch{rows.length === 1 ? '' : 'es'}</b>
          <span className="flex-1" />
          {canAdd && !adding && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => { setAdding(true); setForm((f) => ({ ...f, pipeline: f.pipeline || mine[0]?.id || '' })); }}>Watch a branch</Button>}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<GitBranch />} title="Nothing runs by itself yet">Watch a branch and its pipeline runs on every push, with the commit on the run from the start.</EmptyState>
        ) : rows.map((w) => {
          const lastRun = history.find((h) => (h.pipelineId === w.pipeline_target) && /watch/i.test(h.triggeredBy ?? ''));
          const live = lastRun && (lastRun.status === 'running' || lastRun.status === 'paused');
          return (
            <div key={w.id} className="grid min-h-[60px] grid-cols-[40px_minmax(150px,230px)_minmax(0,1fr)_minmax(120px,170px)_minmax(110px,150px)_minmax(90px,120px)_28px] items-center gap-3 border-b border-line px-3.5 py-2 text-[13px] last:border-0 max-lg:grid-cols-[40px_minmax(0,1fr)_28px]">
              <Switch checked={!!w.enabled} disabled={!editable(w.pipeline_target)} onChange={(c) => void patch(w, { enabled: c })} label={<span className="sr-only">Watching</span>} />
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-line-2 bg-bg-2 px-1.5 py-0.5 font-mono text-[12px]"><GitBranch className="size-3.5" />{w.branch}</span>
                <span className="max-w-full truncate font-mono text-[11.5px] text-fg-3">{shortRepo(w.repo_url)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2 text-fg-3 max-lg:col-start-2"><ArrowRight className="size-3.5 shrink-0" /><b className="truncate font-medium text-fg">{nameOf(w.pipeline_target)}</b></span>
              <span className="max-lg:col-start-2">{w.auto_approve ? <Badge tone="warn">auto-approve gates</Badge> : <span className="text-[12.5px] text-fg-3">gates wait for someone</span>}</span>
              <span className="flex flex-col max-lg:col-start-2">
                <span className="font-mono text-[12.5px]">{w.last_sha?.slice(0, 7) ?? '—'}</span>
                <small className="text-[11.5px] text-fg-3">{w.last_checked_at ? `checked ${ago(w.last_checked_at)}` : 'not checked yet'}</small>
              </span>
              <span className="max-lg:col-start-2">
                {w.last_error ? <Badge tone="fail" title={w.last_error}><TriangleAlert className="size-3.5" />cannot read</Badge>
                  : !w.enabled ? <Badge>paused</Badge>
                    : live ? <Badge tone="run">running #{lastRun!.buildNumber}</Badge>
                      : <Badge tone="ok">up to date</Badge>}
              </span>
              <span className="max-lg:col-start-3 max-lg:row-start-1">
                {editable(w.pipeline_target) && (
                  <Menu title={w.branch} trigger={<IconButton size="sm" label="Watch options"><MoreHorizontal className="size-4" /></IconButton>}
                    items={[
                      { label: w.auto_approve ? 'Let gates wait for someone' : 'Approve gates automatically…', onSelect: () => void setAuto(w, !w.auto_approve) },
                      { label: 'Stop watching', danger: true, onSelect: () => void remove(w) },
                    ]} />
                )}
              </span>
            </div>
          );
        })}
      </Card>

      {adding && (
        <Card className="flex flex-col gap-3 lg:max-w-[calc(100%-316px)]">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">Watch a branch</div>
          <div className="flex flex-wrap gap-3">
            <Field label="Repository" className="min-w-[260px] flex-1"><Input mono value={form.repoUrl} placeholder="git@github.com:you/app.git" onChange={(e) => { setForm({ ...form, repoUrl: e.target.value }); setProbe(null); }} onBlur={() => void check()} /></Field>
            <Field label="Branch" className="w-44"><Input mono value={form.branch} onChange={(e) => { setForm({ ...form, branch: e.target.value }); setProbe(null); }} onBlur={() => void check()} /></Field>
          </div>
          {!pipelineId && (
            <Field label="Runs">
              <select className="h-9 rounded-ctl border border-line-2 bg-bg-2 px-2 text-[13.5px]" value={form.pipeline} onChange={(e) => setForm({ ...form, pipeline: e.target.value })}>
                {mine.filter((p) => p.permissions?.canEditYaml !== false).map((p) => <option key={p.id} value={p.id}>{p.appName}</option>)}
              </select>
            </Field>
          )}
          <Switch checked={form.autoApprove} onChange={(c) => setForm({ ...form, autoApprove: c })} label="Approve its gates automatically" description="Only for runs this watch starts. A run started by hand still waits." />
          {probe && (
            <p className={cx('flex items-center gap-1.5 text-[12.5px]', probe === 'checking' ? 'text-fg-3' : probe.ok ? 'text-primary-hi' : 'text-fail')}>
              {probe === 'checking' ? 'Checking the repository…' : probe.ok ? <><Check className="size-3.5" />Reachable · <span className="font-mono">{form.branch}</span> is at <span className="font-mono">{probe.sha?.slice(0, 7)}</span></> : <><TriangleAlert className="size-3.5" />{probe.error}</>}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setProbe(null); }}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!form.repoUrl.trim() || !form.branch.trim() || !form.pipeline || (probe !== null && probe !== 'checking' && !probe.ok)} onClick={() => void add()}>Start watching</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
