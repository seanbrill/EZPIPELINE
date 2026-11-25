/** Admin › Audit log (design sheet f33). Every write, refused ones included. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { toDate } from '../../lib/format';
import { useLive } from '../../contexts/LiveContext';
import { PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Input, Select } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Tabs';
import { Banner, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { format, isToday, isYesterday } from 'date-fns';

interface Ev { id: number; at: string; userId: number | null; username: string | null; action: string; target: string | null; ip: string | null; status: number | null; detail: Record<string, unknown> | null }
type Range = '24h' | '7d' | '30d' | 'all';

const RANGE_MS: Record<Range, number> = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, all: 0 };

/** "POST /run-pipeline" → "ran". Unknown actions show as they are. */
const VERBS: [RegExp, string][] = [
  [/^POST \/run-pipeline/, 'ran'],
  [/^POST \/builds\/[^/]+\/approve/, 'approved'],
  [/^POST \/builds\/[^/]+\/abort/, 'stopped'],
  [/^POST \/builds\/[^/]+\/rollback/, 'rolled back'],
  [/^POST \/login/, 'signed in'],
  [/^POST \/setup$/, 'set up this instance'],
  [/^POST \/change-password/, 'changed their password'],
  [/^POST \/me\/tokens/, 'made an API token'],
  [/^DELETE \/me\/tokens/, 'revoked an API token'],
  [/^POST \/agent-tokens/, 'made an agent token'],
  [/^DELETE \/agent-tokens/, 'revoked an agent token'],
  [/^POST \/users\/[^/]+\/permissions/, 'changed permissions for'],
  [/^POST \/users$/, 'added a person'],
  [/^PATCH \/users/, 'changed an account'],
  [/^DELETE \/users/, 'removed a person'],
  [/^POST \/env\/reveal/, 'revealed a secret on'],
  [/^(PUT|POST) \/(env|global-env|group-env)/, 'changed environment on'],
  [/^DELETE \/(env|global-env|group-env)/, 'deleted a variable on'],
  [/^POST \/config\/(save|content)/, 'saved YAML'],
  [/^POST \/create-pipeline/, 'made a pipeline'],
  [/^DELETE \/pipelines/, 'deleted a pipeline'],
  [/^POST \/plugins\/[^/]+\/install/, 'installed'],
  [/^DELETE \/plugins/, 'removed'],
  [/^POST \/system\/restart/, 'restarted the server'],
  [/^POST \/git-credentials/, 'changed a deploy key on'],
  [/^(POST|PUT|DELETE) \/schedules/, 'changed a schedule on'],
  [/^(POST|PUT|DELETE) \/(watches|git-watch)/, 'changed auto deploy on'],
  [/^(PUT|POST) \/settings/, 'changed settings'],
  [/^POST \/terminal\/create/, 'opened a terminal'],
  [/^POST \/terminal\/kill/, 'closed a terminal'],
  [/^(PUT|POST) \/resources/, 'changed resources on'],
];
const verb = (a: string) => VERBS.find(([re]) => re.test(a))?.[1] ?? null;

function day(d: Date) { return isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEE d MMM yyyy'); }

export default function Audit() {
  const { pipelines } = useLive();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [range, setRange] = useState<Range>('7d');
  const [people, setPeople] = useState<string[]>([]);
  const [more, setMore] = useState(false);

  const query = useCallback((before?: number) => {
    const p = new URLSearchParams({ limit: '100' });
    if (q.trim()) p.set('target', q.trim());
    if (who) p.set('user', who);
    if (RANGE_MS[range]) p.set('since', new Date(Date.now() - RANGE_MS[range]).toISOString());
    if (before) p.set('before', String(before));
    return api<{ events: Ev[]; next: number | null }>(`/admin/audit?${p}`);
  }, [q, who, range]);

  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      query().then((r) => { if (!live) return; setEvents(r.events); setNext(r.events.length >= 100 ? r.next : null); setErr(null); }).catch((e) => { if (live) setErr((e as Error).message); });
    }, q ? 250 : 0);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, q]);

  useEffect(() => { api<{ users: { username: string }[] }>('/users').then((r) => setPeople(r.users.map((u) => u.username))).catch(() => {}); }, []);

  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    try { const r = await query(next); setEvents((e) => [...(e ?? []), ...r.events]); setNext(r.events.length >= 100 ? r.next : null); }
    catch (e) { setErr((e as Error).message); } finally { setMore(false); }
  };

  const days = useMemo(() => {
    const out: { label: string; items: Ev[] }[] = [];
    for (const e of events ?? []) {
      const l = day(toDate(e.at));
      if (out[out.length - 1]?.label !== l) out.push({ label: l, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [events]);

  const name = (t: string | null) => (t ? pipelines.find((p) => p.id === t)?.appName ?? t : null);

  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['at', 'user', 'action', 'target', 'status', 'ip'], ...(events ?? []).map((e) => [e.at, e.username, e.action, e.target, e.status, e.ip])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `audit-${format(new Date(), 'yyyy-MM-dd')}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHead title="Audit log" lede="Who changed what, and when. Every write is here, including the ones that were refused."
        action={<Button icon={<Download className="size-4" />} disabled={!events?.length} onClick={csv}>Export CSV</Button>} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1 sm:max-w-[320px]"><Input leading={<Search className="size-4" />} placeholder="Pipeline, key or run id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who" className="w-auto">
          <option value="">Anyone</option>{people.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Segmented label="When" items={[{ id: '24h', label: '24h' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }, { id: 'all', label: 'All' }]} value={range} onChange={(v) => setRange(v as Range)} />
      </div>

      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      {!events ? <Skeleton className="h-80 w-full" /> : events.length === 0 ? <EmptyState icon={<Search />} title="Nothing in this range">Try a longer range, or someone else.</EmptyState> : (
        <div className="flex flex-col gap-6">
          {days.map((d) => (
            <section key={d.label}>
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{d.label}</h2>
              <ul className="overflow-hidden rounded-card border border-line">
                {d.items.map((e) => {
                  const v = verb(e.action);
                  const refused = (e.status ?? 0) >= 400;
                  const tgt = name(e.target);
                  return (
                    <li key={e.id} className="flex items-start gap-3 border-b border-line bg-surface px-4 py-3 last:border-0">
                      <span className="w-11 shrink-0 pt-0.5 font-mono text-[12px] text-fg-3">{format(toDate(e.at), 'HH:mm')}</span>
                      <Avatar name={e.username ?? '?'} size={24} />
                      <div className="min-w-0 flex-1 text-[13.5px]">
                        <div className="break-words">
                          <b className="font-medium">{e.username ?? 'Someone not signed in'}</b>{' '}
                          {v ? <span className="text-fg-2">{v}</span> : <code className="font-mono text-[12.5px] text-fg-2">{e.action}</code>}
                          {tgt && !/^\//.test(tgt) && !/^\d+$/.test(tgt) && <> <span className="font-medium">{tgt.length > 60 ? `${tgt.slice(0, 60)}…` : tgt}</span></>}
                          {refused && <Badge tone="fail" className="ml-2">Refused {e.status}</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-fg-3">
                          {e.detail?.token ? 'API token' : 'web'}{e.ip ? ` · ${e.ip}` : ''}{v ? <> · <span className="font-mono">{e.action}</span></> : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {next && <div className="text-center"><Button loading={more} onClick={() => void loadMore()}>Show older</Button></div>}
        </div>
      )}
    </>
  );
}
