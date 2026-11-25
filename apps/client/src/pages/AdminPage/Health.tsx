/** Admin › System health (design sheet f31) and the restart question (f32). */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Power, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { ago, bytes, uptime } from '../../lib/format';
import { VERSION } from '../../lib/instance';
import { useLive } from '../../contexts/LiveContext';
import { PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Banner, Card, Skeleton } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { cx } from '../../components/ui/cx';

interface Job { id: string; target: string; status: string; activeStep: string | null; startedAt: string }
interface H {
  version: string; node: string; startedAt: string; uptimeSeconds: number;
  host: { hostname: string; platform: string; arch: string; cpus: number; load: number[]; memory: { total: number; free: number; rss: number } };
  docker: { inContainer: boolean; cli: string | null }; canRestart: boolean;
  database: { bytes: number }; disk: { total: number; free: number } | null; volume: { name: string; bytes: number }[]; jobs: Job[];
}

const LABEL: Record<string, string> = { workspace: 'Workspaces', versions: 'Versions', plugins: 'Plugins', logs: 'Logs', 'git-cache': 'Git cache', pipelines: 'Pipelines', resources: 'Resources', backups: 'Backups' };

export default function Health() {
  const { pipelines } = useLive();
  const [h, setH] = useState<H | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setH(await api<H>('/system/health')); setAt(new Date()); setErr(null); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (err && !h) return <Banner tone="fail">{err}</Banner>;
  if (!h) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div></div>;

  const used = h.disk ? h.disk.total - h.disk.free : null;
  const pct = h.disk && used != null ? Math.round((used / h.disk.total) * 100) : null;
  const tight = pct != null && pct >= 90;
  const name = (t: string) => pipelines.find((p) => p.id === t)?.appName ?? t;
  const total = h.volume.reduce((a, v) => a + v.bytes, 0) || 1;

  const restart = async () => {
    try {
      await api('/system/restart', { method: 'POST' });
      setRestarting('Restarting. This page reconnects when the server is back.');
      setAsking(false);
      // Wait for it to go away and come back.
      const t0 = Date.now();
      const poll = async () => {
        try { await api('/instance', { token: '' }); if (Date.now() - t0 > 3000) { setRestarting(null); void load(); return; } } catch { /* still down */ }
        if (Date.now() - t0 < 120_000) window.setTimeout(() => void poll(), 1500); else setRestarting('It hasn’t come back after two minutes. Check where it runs.');
      };
      window.setTimeout(() => void poll(), 1500);
    } catch (e) { setErr((e as Error).message); setAsking(false); }
  };

  return (
    <>
      <PageHead title="System health" badge={tight ? <Badge tone="warn" dot>Disk nearly full</Badge> : <Badge tone="ok" dot>All good</Badge>}
        lede={`This server and the host it runs on. Checked ${at ? ago(at.toISOString()) : ''}.`}
        action={<div className="flex gap-2"><Button icon={<RefreshCw className={cx('size-4', busy && 'animate-spin')} />} onClick={() => void load()}>Check again</Button><Button variant="danger" icon={<Power className="size-4" />} onClick={() => setAsking(true)}>Restart</Button></div>} />

      {restarting && <Banner tone="info" className="mb-5">{restarting}</Banner>}
      {err && <Banner tone="fail" className="mb-5">{err}</Banner>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Server" value={`v${h.version !== 'unknown' ? h.version : VERSION}`} sub={`Node ${h.node} · ${h.host.platform}/${h.host.arch}`} />
        <Stat label="Uptime" value={uptime(h.uptimeSeconds)} sub={`Since ${new Date(h.startedAt).toLocaleString()}`} />
        <Stat label="Docker" value={h.docker.cli ? 'Available' : 'Not found'} tone={h.docker.cli ? undefined : 'warn'} sub={h.docker.cli ? `${h.docker.cli}${h.docker.inContainer ? ' · in a container' : ''}` : 'Steps that call docker will fail.'} />
        <Stat label="Database" value={bytes(h.database.bytes)} sub="Runs, log index, users" />
        <Stat label="Memory" value={bytes(h.host.memory.rss)} sub={`This server · host has ${bytes(h.host.memory.free)} free of ${bytes(h.host.memory.total)}`} />
        <Stat label="Load" value={h.host.load[0].toFixed(2)} sub={`${h.host.cpus} CPUs · 5m ${h.host.load[1].toFixed(2)} · 15m ${h.host.load[2].toFixed(2)}`} />
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-[14px] font-semibold">Data volume</h2>
          {h.disk && used != null && <span className="text-[13px] text-fg-3">{bytes(used)} of {bytes(h.disk.total)} · {pct}% used</span>}
        </div>
        {h.disk && <div className="mt-3 h-2 overflow-hidden rounded-full bg-line-2"><div className={cx('h-full rounded-full', tight ? 'bg-warn' : 'bg-primary')} style={{ width: `${pct}%` }} /></div>}
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-fg-2">
          {h.volume.filter((v) => v.bytes > 0).slice(0, 8).map((v) => (
            <li key={v.name} className="inline-flex items-center gap-1.5"><span className="inline-block h-2 rounded-full bg-fg-3" style={{ width: Math.max(4, (v.bytes / total) * 60) }} />{LABEL[v.name] ?? v.name} <span className="text-fg-3">{bytes(v.bytes)}</span></li>
          ))}
        </ul>
      </Card>

      <Card className="mt-3">
        <h2 className="text-[14px] font-semibold">Running now <span className="font-normal text-fg-3">· {h.jobs.length === 0 ? 'nothing' : `${h.jobs.length} job${h.jobs.length === 1 ? '' : 's'}`}</span></h2>
        {h.jobs.length > 0 && (
          <ul className="mt-2">
            {h.jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-0">
                <span className={cx('size-2 rounded-full', j.status === 'paused' ? 'bg-warn' : 'bg-run')} />
                <Link to={`/runs/${encodeURIComponent(j.id)}`} className="min-w-0 flex-1 truncate text-[13.5px] font-medium hover:underline">{name(j.target)}</Link>
                <span className="truncate text-[12.5px] text-fg-3">{j.status === 'paused' ? 'Waiting for approval' : j.activeStep ?? 'Starting'}</span>
                <span className="text-[12.5px] text-fg-3">{ago(j.startedAt, '')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={asking} onClose={() => setAsking(false)} title="Restart the server?" icon={<Power />} iconTone="warn"
        description="EZPipeline stops, starts again and reconnects everyone in about ten seconds."
        footer={<><Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button><Button variant="danger" disabled={!h.canRestart || h.jobs.length > 0} onClick={() => void restart()}>Restart now</Button></>}>
        {!h.canRestart ? (
          <Banner tone="warn">Nothing here would start it again: it isn’t in Docker with a restart policy, or in the desktop app. Restart it where it runs instead.</Banner>
        ) : h.jobs.length > 0 ? (
          <Banner tone="warn" title={`${h.jobs.length === 1 ? 'A job is' : `${h.jobs.length} jobs are`} running`}>
            A restart would cut {h.jobs.length === 1 ? 'it' : 'them'} off mid-step. Let {h.jobs.length === 1 ? 'it' : 'them'} finish, or stop {h.jobs.length === 1 ? 'it' : 'them'} from the run page, then restart.
            <ul className="mt-2">{h.jobs.map((j) => <li key={j.id}><Link className="font-medium underline-offset-2 hover:underline" to={`/runs/${encodeURIComponent(j.id)}`}>{name(j.target)}</Link></li>)}</ul>
          </Banner>
        ) : <p className="text-[13.5px] text-fg-2">Nothing is running. Runs started during the restart wait until it is back.</p>}
      </Modal>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <Card>
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{label}</div>
      <div className={cx('mt-1.5 text-[20px] font-semibold tracking-[-0.01em]', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12.5px] text-fg-3" title={sub}>{sub}</div>}
    </Card>
  );
}
