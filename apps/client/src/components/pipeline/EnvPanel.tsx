/**
 * Environment, by layer (design sheet f140 pipeline, f143 group).
 *
 * For a pipeline: one list of what a run sees, each variable labelled with the
 * layer it comes from, and the values a more specific layer replaces shown
 * struck through. For a group: what the group sets, who uses each value and
 * who overrides it. Secrets are masked until someone who may change them
 * reveals one (the reveal is a POST, so it is audited).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, MoreHorizontal, Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { Button, IconButton } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Switch } from '../ui/Toggle';
import { Segmented } from '../ui/Tabs';
import { Menu } from '../ui/Menu';
import { Card, EmptyState, ErrorState, Skeleton } from '../ui/Feedback';
import { cx } from '../ui/cx';

export type EnvScope = { pipeline: string } | { group: string } | { global: true };

interface Var { key: string; secret: boolean; value: string | null }
interface Layer { id: string; label: string; kind: 'global' | 'group' | 'pipeline'; editable: boolean; vars: Var[] }
interface Resp { layers: Layer[]; pipelines?: { id: string; appName: string; overrides: Record<string, string> }[]; subgroups?: { name: string; keys: string[] }[] }

const query = (s: EnvScope) => ('pipeline' in s ? `pipeline=${encodeURIComponent(s.pipeline)}` : 'group' in s ? `group=${encodeURIComponent(s.group)}` : 'global=1');

interface Draft { key: string; value: string; secret: boolean; layer: string; editing: boolean }

export function EnvPanel({ scope }: { scope: EnvScope }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [view, setView] = useState<'sees' | 'here'>('sees');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const isPipeline = 'pipeline' in scope;
  const qs = query(scope);

  const load = useCallback(() => {
    api<Resp>(`/env?${qs}`).then((r) => { setData(r); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [qs]);
  useEffect(load, [load]);

  const own = data?.layers[data.layers.length - 1];
  const writable = useMemo(() => (data?.layers ?? []).filter((l) => l.editable).reverse(), [data]);

  // What a run sees: walk the layers in order, later wins.
  const rows = useMemo(() => {
    if (!data) return [];
    const win = new Map<string, { v: Var; layer: Layer; replaced: Layer[] }>();
    const shadowed: { v: Var; layer: Layer; by: Layer }[] = [];
    for (const l of data.layers) {
      for (const v of l.vars) {
        const prev = win.get(v.key);
        if (prev) shadowed.push({ v: prev.v, layer: prev.layer, by: l });
        win.set(v.key, { v, layer: l, replaced: prev ? [...prev.replaced, prev.layer] : [] });
      }
    }
    const f = q.trim().toLowerCase();
    const keep = (k: string) => !f || k.toLowerCase().includes(f);
    const live = [...win.values()].filter((r) => keep(r.v.key) && (view === 'sees' || !isPipeline || r.layer === own)).sort((a, b) => a.v.key.localeCompare(b.v.key));
    return [...live.map((r) => ({ ...r, by: null as Layer | null })), ...(view === 'sees' ? shadowed.filter((s) => keep(s.v.key)).map((s) => ({ v: s.v, layer: s.layer, replaced: [], by: s.by })) : [])];
  }, [data, q, view, isPipeline, own]);

  const reveal = async (layer: Layer, key: string) => {
    try {
      const r = await api<{ value: string }>('/env/reveal', { body: { layer: layer.id, key } });
      setRevealed((m) => ({ ...m, [`${layer.id}|${key}`]: r.value }));
      return r.value;
    } catch (e) { toast.error('Could not reveal it', { description: (e as Error).message }); return null; }
  };

  const edit = async (layer: Layer, v: Var) => {
    const value = v.secret ? revealed[`${layer.id}|${v.key}`] ?? (await reveal(layer, v.key)) : v.value;
    if (value == null) return;
    setDraft({ key: v.key, value, secret: v.secret, layer: layer.id, editing: true });
  };

  const remove = async (layer: Layer, v: Var) => {
    if (!(await confirm({ title: `Delete ${v.key}?`, message: `It is removed from ${layer.label === 'This pipeline' ? 'this pipeline' : layer.label}. The next run will not have it${isPipeline ? ' unless another layer sets it' : ''}.`, confirmText: 'Delete', isDangerous: true }))) return;
    try { await api('/env', { method: 'DELETE', body: { layer: layer.id, key: v.key } }); toast.success(`${v.key} deleted`); load(); }
    catch (e) { toast.error('Could not delete it', { description: (e as Error).message }); }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api('/env', { method: 'PUT', body: { layer: draft.layer, key: draft.key.trim(), value: draft.value, secret: draft.secret } });
      toast.success(`${draft.key.trim()} saved`, { description: 'The next run has it.' });
      setRevealed((m) => { const n = { ...m }; delete n[`${draft.layer}|${draft.key.trim()}`]; return n; });
      setDraft(null);
      load();
    } catch (e) { toast.error('Could not save it', { description: (e as Error).message }); }
    setBusy(false);
  };

  if (err) return <ErrorState title="Could not load the environment" detail={err} action={<Button onClick={load}>Try again</Button>} />;
  if (!data) return <Skeleton className="h-64 w-full" rounded="rounded-card" />;

  const usedBy = (key: string) => {
    const ps = data.pipelines ?? [];
    const over = ps.filter((p) => p.overrides[key]);
    return { n: ps.length - over.length, of: ps.length, over };
  };
  const total = data.layers.reduce((n, l) => n + l.vars.length, 0);
  const keyOk = !draft || /^[A-Za-z_][A-Za-z0-9_]*$/.test(draft.key.trim());

  return (
    <div className="flex flex-col gap-4">
      {isPipeline ? (
        <div className="flex flex-wrap items-center gap-2 text-fg-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em]">Layers</span>
          {data.layers.map((l, i) => (
            <span key={l.id} className="flex items-center gap-2">
              {i > 0 && <ArrowRight className="size-3.5" />}
              <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]', i === data.layers.length - 1 ? 'border-primary-line bg-primary-soft text-fg' : 'border-line-2 bg-surface text-fg-2')}>
                {l.label}<span className="font-mono text-[11px] text-fg-3">{l.vars.length}</span>
              </span>
            </span>
          ))}
          <span className="ml-2 text-[12.5px]">The most specific layer wins. A step&rsquo;s own <code className="font-mono">env:</code> wins over all of them.</span>
        </div>
      ) : (
        <p className="text-[13px] text-fg-3">
          {'group' in scope ? <>Set here for every pipeline in <b className="text-fg-2">{scope.group}</b> and its subgroups. A pipeline or subgroup that sets the same name wins.</> : <>Set for every pipeline on this instance. Groups and pipelines that set the same name win.</>}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card pad={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="min-w-[180px] flex-1"><Input leading={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a variable" className="h-8" /></div>
            {isPipeline && <Segmented size="sm" value={view} onChange={setView} items={[{ id: 'sees', label: <>What a run sees <span className="font-mono text-[11px] text-fg-3">{new Set(data.layers.flatMap((l) => l.vars.map((v) => v.key))).size}</span></> }, { id: 'here', label: <>Set here <span className="font-mono text-[11px] text-fg-3">{own?.vars.length ?? 0}</span></> }]} />}
            {writable.length > 0 && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setDraft({ key: '', value: '', secret: false, layer: writable[0].id, editing: false })}>Add variable</Button>}
          </div>
          {total === 0 || rows.length === 0 ? (
            <EmptyState title={total === 0 ? 'No variables yet' : 'Nothing matches'}>{total === 0 ? 'Add one and every run from here on has it.' : 'Try another name.'}</EmptyState>
          ) : (
            <ul>
              <li className="grid h-[34px] grid-cols-[minmax(140px,220px)_minmax(0,1fr)_minmax(120px,230px)_28px] items-center gap-3 border-b border-line px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3 max-md:hidden">
                <span>Name</span><span>Value</span><span>{isPipeline ? 'Set in' : 'Used by'}</span><span />
              </li>
              {rows.map(({ v, layer, replaced, by }) => {
                const value = revealed[`${layer.id}|${v.key}`];
                const u = !isPipeline && 'group' in scope ? usedBy(v.key) : null;
                return (
                  <li key={`${layer.id}|${v.key}|${by ? 'x' : ''}`} className={cx('grid min-h-12 grid-cols-[minmax(140px,220px)_minmax(0,1fr)_minmax(120px,230px)_28px] items-center gap-3 border-b border-line px-3.5 py-2 text-[13px] last:border-0 max-md:grid-cols-[minmax(0,1fr)_28px]', by && 'opacity-55')}>
                    <span className={cx('truncate font-mono text-[12.5px]', by && 'line-through')}>{v.key}</span>
                    <span className="flex min-w-0 items-center gap-2 max-md:order-3 max-md:col-span-2">
                      {v.secret && value === undefined ? (
                        <><span className="tracking-[.12em] text-fg-3">••••••••••••</span>
                          {layer.editable && !by && <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => void reveal(layer, v.key)}>Reveal</Button>}</>
                      ) : (
                        <><span className={cx('truncate font-mono text-[12.5px] text-fg-2', by && 'line-through')}>{value ?? v.value}</span>
                          {v.secret && <IconButton size="sm" label="Hide" onClick={() => setRevealed((m) => { const n = { ...m }; delete n[`${layer.id}|${v.key}`]; return n; })}><EyeOff className="size-3.5" /></IconButton>}</>
                      )}
                    </span>
                    <span className="flex flex-col items-start gap-0.5 max-md:order-4 max-md:col-span-2">
                      {isPipeline ? (
                        <>
                          <span className={cx('rounded-[6px] border px-2 py-0.5 text-[12px]', layer === own ? 'border-primary-line bg-primary-soft text-primary-hi' : 'border-line-2 bg-bg-2 text-fg-2')}>{layer.label}</span>
                          {by ? <span className="text-[11.5px] text-fg-3">not used: {by === own ? 'set here' : `${by.label} sets it`}</span>
                            : replaced.length > 0 && <span className="text-[11.5px] text-warn">overrides {replaced[replaced.length - 1].label}</span>}
                        </>
                      ) : u ? (
                        <>
                          <span className="text-[12.5px] text-fg-3">{u.of === 0 ? 'no pipelines yet' : u.n === u.of ? `all ${u.of} pipeline${u.of === 1 ? '' : 's'}` : `${u.n} of ${u.of} pipelines`}</span>
                          {u.over.length > 0 && <span className="text-[11.5px] text-warn">{u.over.length === 1 ? `${u.over[0].appName} sets its own` : `${u.over.length} set their own`}</span>}
                        </>
                      ) : <span className="text-[12.5px] text-fg-3">every pipeline</span>}
                    </span>
                    <span className="max-md:order-2">
                      {layer.editable && !by && (
                        <Menu title={v.key} trigger={<IconButton size="sm" label={`${v.key} options`}><MoreHorizontal className="size-4" /></IconButton>}
                          items={[{ label: 'Edit', onSelect: () => void edit(layer, v) }, { label: 'Delete', danger: true, onSelect: () => void remove(layer, v) }]} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-line px-3.5 py-3 text-[12.5px] text-fg-3">
            Secret values are not sent to the browser until someone who may change them reveals one, and each reveal is in the audit log.
            {!isPipeline && ' Runs already going keep what they started with.'}
          </p>
        </Card>

        <aside className="flex flex-col gap-3">
          {draft && (
            <Card className="flex flex-col gap-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">{draft.editing ? `Editing ${draft.key}` : 'Adding a variable'}</div>
              <Field label="Name" error={keyOk ? undefined : 'Letters, digits and _, not starting with a digit.'}>
                <Input mono autoFocus={!draft.editing} disabled={draft.editing} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })} placeholder="SENTRY_DSN" />
              </Field>
              <Field label="Value"><Input mono type={draft.secret ? 'password' : 'text'} autoFocus={draft.editing} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></Field>
              <Switch checked={draft.secret} onChange={(c) => setDraft({ ...draft, secret: c })} label="Secret" description="Hidden after saving. Names like …TOKEN or …PASSWORD always are." />
              {writable.length > 1 && !draft.editing && (
                <Field label="Set in" hint="A group sets it for every pipeline in it.">
                  <select className="h-9 rounded-ctl border border-line-2 bg-bg-2 px-2 text-[13.5px]" value={draft.layer} onChange={(e) => setDraft({ ...draft, layer: e.target.value })}>
                    {writable.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </Field>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={!draft.key.trim() || !keyOk} onClick={() => void save()}>{draft.editing ? 'Save' : 'Add'}</Button>
              </div>
            </Card>
          )}
          {isPipeline && (
            <Card>
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">Also in every run</div>
              <ul className="mt-2.5 flex flex-col gap-2 text-[12.5px] text-fg-3">
                {[['PIPELINE_ID', (scope as { pipeline: string }).pipeline], ['BUILD_ID', 'this run’s id'], ['WORKSPACE', 'the run’s folder'], ['RESOURCES', 'its files, see Resources'], ['EZP_COMMIT_SHA', 'when a watch knows it']].map(([k, d]) => (
                  <li key={k}><span className="mr-1.5 font-mono text-fg">{k}</span>{d}</li>
                ))}
              </ul>
            </Card>
          )}
          {(data.subgroups?.length ?? 0) > 0 && (
            <Card>
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">Subgroups add their own</div>
              {data.subgroups!.map((s) => (
                <Link key={s.name} to={`/groups/${s.name.split('/').map(encodeURIComponent).join('/')}/environment`} className="mt-2.5 flex flex-col gap-0.5 border-t border-line pt-2.5 text-[13px] first-of-type:border-0 hover:text-primary-hi">
                  <b className="font-medium">{s.name}</b>
                  <span className="text-[12px] text-fg-3">{s.keys.length === 0 ? 'nothing yet' : `${s.keys.length} variable${s.keys.length === 1 ? '' : 's'} · ${s.keys.slice(0, 3).join(', ')}${s.keys.length > 3 ? '…' : ''}`}</span>
                </Link>
              ))}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
