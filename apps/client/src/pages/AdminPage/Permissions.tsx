/**
 * Admin › Permissions (design sheet f30). Pick a group or pipeline; each
 * member's flags there are either set there, or inherited from the nearest
 * group above it (then the instance-wide default). The resolution mirrors the
 * server's resolveGrant, so what this shows is what the server enforces.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Folder, Globe, Minus, RotateCcw, Search, Workflow } from 'lucide-react';
import { api } from '../../lib/api';
import { useLive } from '../../contexts/LiveContext';
import { useToast } from '../../contexts/ToastContext';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { allGroups } from '../../components/shell/useRuns';
import { PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { Input } from '../../components/ui/Field';
import { Banner, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { cx } from '../../components/ui/cx';
import type { Person } from './Users';

interface Grant { target: string; canView: boolean; canRun: boolean; canEditYaml: boolean; canEditEnv: boolean; canViewResources: boolean; canUseClaude: boolean; canUseTerminal: boolean }
type Flag = Exclude<keyof Grant, 'target'>;
type Sel = { kind: 'all' } | { kind: 'group'; path: string } | { kind: 'pipeline'; id: string; name: string; group: string | null };

const FLAGS: { id: Flag; label: string; risky?: string }[] = [
  { id: 'canView', label: 'View' },
  { id: 'canRun', label: 'Run' },
  { id: 'canEditYaml', label: 'YAML', risky: 'Edit YAML is a shell on this host: a step runs any command as the EZPipeline user.' },
  { id: 'canEditEnv', label: 'Env' },
  { id: 'canViewResources', label: 'Files' },
  { id: 'canUseClaude', label: 'Assistant' },
  { id: 'canUseTerminal', label: 'Terminal', risky: 'Terminal opens a shell on this host.' },
];
const NONE: Omit<Grant, 'target'> = { canView: false, canRun: false, canEditYaml: false, canEditEnv: false, canViewResources: false, canUseClaude: false, canUseTerminal: false };

const ancestors = (g: string) => { const p = g.split('/').filter(Boolean); return p.map((_, i) => p.slice(0, p.length - i).join('/')); };
const keysFor = (s: Sel): string[] => s.kind === 'all' ? ['*'] : s.kind === 'group' ? [`group:${s.path}`, s.path].map((k) => k.toLowerCase()) : [`pipeline:${s.id}`, s.id].map((k) => k.toLowerCase());
const keyOf = (s: Sel) => (s.kind === 'all' ? '*' : s.kind === 'group' ? `group:${s.path}` : `pipeline:${s.id}`);
const here = (perms: Grant[], s: Sel) => { const ks = keysFor(s); return perms.find((p) => ks.includes(p.target.toLowerCase())) ?? null; };

/** The grant that decides at `s` if nothing is set there, and where it comes from. */
function inherited(perms: Grant[], s: Sel): { grant: Grant | null; from: string } {
  if (s.kind === 'all') return { grant: null, from: '' };
  const chain = s.kind === 'pipeline' ? (s.group ? ancestors(s.group) : []) : ancestors(s.path).slice(1);
  for (const a of chain) {
    const g = here(perms, { kind: 'group', path: a });
    if (g) return { grant: g, from: `the ${a.split('/').pop()} group` };
  }
  const star = perms.find((p) => p.target === '*') ?? null;
  return { grant: star, from: star ? 'everywhere' : '' };
}

export default function Permissions() {
  const toast = useToast();
  const { pipelines } = useLive();
  const [params, setParams] = useSearchParams();
  const only = params.get('user');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [orig, setOrig] = useState<Record<number, Grant[]>>({});
  const [draft, setDraft] = useState<Record<number, Grant[]>>({});
  const [sel, setSel] = useState<Sel>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { users } = await api<{ users: Person[] }>('/users');
    const members = users.filter((u) => !u.isAdmin);
    const perms = await Promise.all(members.map((u) => api<{ permissions: Grant[] }>(`/users/${u.id}/permissions`).then((r) => [u.id, r.permissions] as const)));
    setPeople(users);
    setOrig(Object.fromEntries(perms));
    setDraft(Object.fromEntries(perms));
  }, []);
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, [load]);

  const changed = useMemo(() => Object.keys(draft).filter((id) => JSON.stringify(draft[+id]) !== JSON.stringify(orig[+id])).map(Number), [draft, orig]);
  useUnsavedGuard(changed.length > 0);

  const groups = useMemo(() => allGroups(pipelines), [pipelines]);
  const tree = useMemo(() => {
    const needle = q.toLowerCase();
    return groups.map((g) => ({ g, ps: pipelines.filter((p) => (p.group ?? '') === g && (!needle || p.appName.toLowerCase().includes(needle) || g.toLowerCase().includes(needle))) }))
      .filter((x) => !needle || x.ps.length || x.g.toLowerCase().includes(needle));
  }, [groups, pipelines, q]);
  const loose = pipelines.filter((p) => !p.group && (!q || p.appName.toLowerCase().includes(q.toLowerCase())));

  if (err) return <Banner tone="fail">{err}</Banner>;
  if (!people) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-80 w-full" /></div>;

  const members = people.filter((u) => !u.isAdmin && (!only || String(u.id) === only));
  const admins = people.filter((u) => u.isAdmin);

  const toggle = (uid: number, flag: Flag) => setDraft((d) => {
    const perms = d[uid] ?? [];
    const at = here(perms, sel);
    const base = at ?? { ...(inherited(perms, sel).grant ?? NONE), target: keyOf(sel) };
    const next: Grant = { ...base, [flag]: !base[flag] };
    // Turning anything on implies seeing the pipeline; turning View off clears the rest.
    if (flag !== 'canView' && next[flag]) next.canView = true;
    if (flag === 'canView' && !next.canView) Object.assign(next, NONE);
    return { ...d, [uid]: [...perms.filter((p) => p !== at), next] };
  });
  const reset = (uid: number) => setDraft((d) => { const at = here(d[uid] ?? [], sel); return { ...d, [uid]: (d[uid] ?? []).filter((p) => p !== at) }; });

  const save = async () => {
    setSaving(true);
    try {
      for (const id of changed) await api(`/users/${id}/permissions`, { method: 'POST', body: { permissions: draft[id] } });
      setOrig(draft);
      toast.success('Permissions saved');
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const title = sel.kind === 'all' ? 'Everywhere' : sel.kind === 'group' ? sel.path.split('/').pop()! : sel.name;
  const path = sel.kind === 'group' ? sel.path.split('/').slice(0, -1).join(' / ') : sel.kind === 'pipeline' ? (sel.group ?? '').split('/').join(' / ') : '';
  const lede = sel.kind === 'all' ? 'The default for every pipeline, unless a group or pipeline sets its own.'
    : `Set a flag here to override what it inherits, for this ${sel.kind} only.`;
  const risky = FLAGS.filter((f) => f.risky && members.some((m) => { const g = here(draft[m.id] ?? [], sel) ?? inherited(draft[m.id] ?? [], sel).grant; return g?.[f.id] && !m.mfaEnabled; }));

  const item = (s: Sel, label: string, icon: ReactNode, depth = 0) => {
    const on = keyOf(s) === keyOf(sel);
    const set = members.some((m) => here(draft[m.id] ?? [], s));
    return (
      <button key={keyOf(s)} type="button" onClick={() => setSel(s)} aria-current={on ? 'true' : undefined} style={{ paddingLeft: 10 + depth * 14 }}
        className={cx('flex h-8 w-full items-center gap-2 rounded-ctl pr-2.5 text-left text-[13.5px] [&>svg]:size-3.5 [&>svg]:shrink-0', on ? 'bg-surface-3 font-medium text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
        {icon}<span className="min-w-0 flex-1 truncate">{label}</span>{set && <span title="Set here for someone" className="size-1.5 rounded-full bg-primary" />}
      </button>
    );
  };

  return (
    <>
      <PageHead title="Permissions" lede="What each member may do, per group and pipeline. A pipeline inherits from its group, and a group from the one above it."
        badge={changed.length > 0 ? <span className="rounded-full border border-warn-line bg-warn-soft px-2 py-0.5 text-[12px] text-warn">{changed.length} unsaved</span> : undefined}
        action={<div className="flex gap-2"><Button variant="ghost" disabled={!changed.length || saving} onClick={() => setDraft(orig)}>Discard</Button><Button variant="primary" disabled={!changed.length} loading={saving} onClick={() => void save()}>Save changes</Button></div>} />

      {only && <Banner tone="info" className="mb-4" action={<button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => { params.delete('user'); setParams(params, { replace: true }); }}>Show everyone</button>}>Showing {people.find((p) => String(p.id) === only)?.displayName ?? 'one person'} only.</Banner>}

      <div className="flex flex-col gap-5 lg:flex-row">
        <aside className="shrink-0 lg:w-[220px]">
          <Input leading={<Search className="size-4" />} placeholder="Find a pipeline" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-3 flex max-h-[240px] flex-col gap-0.5 overflow-y-auto lg:max-h-[calc(100vh-260px)]">
            {item({ kind: 'all' }, 'Everywhere', <Globe />)}
            {tree.map(({ g, ps }) => {
              const depth = g.split('/').length - 1;
              return [
                item({ kind: 'group', path: g }, g.split('/').pop()!, <Folder />, depth),
                ...ps.map((p) => item({ kind: 'pipeline', id: p.id, name: p.appName, group: p.group ?? null }, p.appName, <Workflow />, depth + 1)),
              ];
            })}
            {loose.map((p) => item({ kind: 'pipeline', id: p.id, name: p.appName, group: null }, p.appName, <Workflow />))}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-3">
            {path && <div className="font-mono text-[12px] text-fg-3">{path} /</div>}
            <h2 className="text-[18px] font-semibold">{title}</h2>
            <p className="mt-0.5 text-[13px] text-fg-3">{lede}</p>
          </div>
          <div className="mb-3 flex flex-wrap gap-4 text-[12px] text-fg-3">
            <span className="inline-flex items-center gap-1.5"><Cell state="set" on />Set here</span>
            <span className="inline-flex items-center gap-1.5"><Cell state="inherited" on />Inherited</span>
            <span className="inline-flex items-center gap-1.5"><Cell state="inherited" on={false} />Not allowed</span>
          </div>

          {members.length === 0 ? <EmptyState title="No members yet">Everyone here is an admin, and admins can do everything. Add a member in Users & roles.</EmptyState> : (
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full min-w-[600px] text-[13.5px]">
                <thead className="bg-surface-2 font-mono text-[11px] uppercase text-fg-3">
                  <tr><th className="px-4 py-2.5 text-left font-normal">Who</th>{FLAGS.map((f) => <th key={f.id} title={f.risky} className="whitespace-nowrap px-1.5 py-2.5 font-normal">{f.label}</th>)}<th className="w-10" /></tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const perms = draft[m.id] ?? [];
                    const at = here(perms, sel);
                    const inh = inherited(perms, sel);
                    const eff = at ?? inh.grant;
                    return (
                      <tr key={m.id} className="border-t border-line">
                        <td className="px-4 py-2.5">
                          <div className="flex max-w-[200px] items-center gap-2.5"><Avatar name={m.displayName} size={26} /><div className="min-w-0"><div className="truncate font-medium">{m.displayName}</div>
                            <div className="truncate text-[12px] text-fg-3">{at ? 'Set here' : inh.from ? `From ${inh.from}` : 'Nothing granted'}</div></div></div>
                        </td>
                        {FLAGS.map((f) => (
                          <td key={f.id} className="px-1.5 py-2.5 text-center">
                            <button type="button" onClick={() => toggle(m.id, f.id)} aria-pressed={!!eff?.[f.id]} aria-label={`${f.label} for ${m.displayName}`} className="rounded p-1 hover:bg-surface-3">
                              <Cell state={at ? 'set' : 'inherited'} on={!!eff?.[f.id]} />
                            </button>
                          </td>
                        ))}
                        <td className="px-2 text-right">{at && sel.kind !== 'all' && <button type="button" title="Inherit again" aria-label={`Inherit again for ${m.displayName}`} onClick={() => reset(m.id)} className="rounded p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg"><RotateCcw className="size-3.5" /></button>}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-line bg-surface-2/50">
                    <td className="px-4 py-2.5" colSpan={FLAGS.length + 2}>
                      <span className="font-medium">Admins</span> <span className="text-fg-3">· {admins.map((a) => a.displayName).join(', ')} · can do everything, on every pipeline.</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {risky.map((f) => <Banner key={f.id} tone="warn" className="mt-4" title={f.risky}>Someone with it here signs in with a password alone. Require sign-in codes in Settings › General.</Banner>)}
        </div>
      </div>
    </>
  );
}

function Cell({ state, on }: { state: 'set' | 'inherited'; on: boolean }) {
  if (!on) return <span className="grid size-[18px] place-items-center rounded-[4px] border border-line-2 text-fg-3"><Minus className="size-3" /></span>;
  return state === 'set'
    ? <span className="grid size-[18px] place-items-center rounded-[4px] bg-primary text-primary-ink"><Check className="size-3" strokeWidth={3} /></span>
    : <span className="grid size-[18px] place-items-center rounded-[4px] border border-primary-line bg-primary-soft text-primary-hi"><Check className="size-3" strokeWidth={3} /></span>;
}
