/**
 * What the page draws only inside the desktop app (apps/desktop; design sheet f151, f153).
 *
 *   DesktopTitleBar       on a Mac the app hides its title bar; this is it: the instance
 *                         name, and a pill saying where the app is connected
 *   DesktopUpdateCard     at the foot of the sidebar: an update is out, downloading,
 *                         ready to restart, or failed
 *   DesktopStateReporter  connected to a server elsewhere, the page tells the tray what
 *                         is running (on this computer the app asks the server itself)
 */
import { useEffect, useState } from 'react';
import { Download, RotateCw, ShieldCheck, X } from 'lucide-react';
import { desktop, desktopMac, type DesktopInfo, type TrayRun, type UpdateState } from '../../lib/desktop';
import { useInstance } from '../../lib/instance';
import { useLive } from '../../contexts/LiveContext';
import type { BuildHistoryEntry } from '../../types/build';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';

function useDesktopInfo() {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    let live = true;
    desktop?.info().then((i) => { if (live) setInfo(i); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return info;
}

export function DesktopTitleBar() {
  const inst = useInstance();
  const info = useDesktopInfo();
  if (!desktopMac) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[45] flex h-[38px] select-none items-center border-b border-line bg-bg-2 text-[12.5px] [-webkit-app-region:drag]">
      <span className="pointer-events-none absolute inset-x-0 truncate px-40 text-center font-medium text-fg-2">EZPipeline{inst?.name && inst.name !== 'EZPipeline' ? ` — ${inst.name}` : ''}</span>
      {info?.where && (
        <span className="relative ml-auto mr-3 inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border border-line-2 px-2 font-mono text-[11.5px] text-fg-2" title={info.server ?? undefined}>
          <span className="size-1.5 rounded-full bg-primary" />{info.where}
        </span>
      )}
    </div>
  );
}

const mb = (n = 0) => `${Math.round(n / 1024 / 1024)} MB`;

export function DesktopUpdateCard({ rail, running }: { rail: boolean; running: number }) {
  const [s, setS] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    desktop.update.state().then((v) => { if (live) setS(v); }).catch(() => {});
    const off = desktop.update.onChange(setS);
    return () => { live = false; off(); };
  }, []);
  if (!desktop || !s || !['available', 'downloading', 'ready', 'failed', 'manual'].includes(s.phase)) return null;
  const u = desktop.update;

  if (rail) {
    return (
      <IconButton label={s.phase === 'ready' ? `Restart to update to ${s.version}` : `EZPipeline ${s.version ?? ''} is out`} className="relative mx-auto mb-1"
        onClick={() => void (s.phase === 'ready' ? u.restart(running > 0) : s.phase === 'available' ? u.download() : null)}>
        <Download className="size-4" /><span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
      </IconButton>
    );
  }

  const tile = (tone: 'ok' | 'fail', icon: React.ReactNode) => (
    <span className={cx('grid size-8 shrink-0 place-items-center rounded-ctl [&>svg]:size-4', tone === 'ok' ? 'bg-primary-soft text-primary-hi' : 'bg-fail-soft text-fail')}>{icon}</span>
  );
  return (
    <div className="mx-3 mb-2 rounded-card border border-line-2 bg-surface p-3 text-[13px]" role="status" aria-live="polite">
      {s.phase === 'available' && (
        <>
          <div className="flex gap-2.5">{tile('ok', <Download />)}<div className="min-w-0"><b className="font-medium">EZPipeline {s.version} is out</b><div className="text-[12px] text-fg-3">You have {s.current}.</div></div></div>
          <div className="mt-2.5 flex gap-1.5"><Button size="sm" variant="primary" onClick={() => void u.download()}>Download</Button><Button size="sm" variant="ghost" className="ml-auto" onClick={() => void u.dismiss()}>Later</Button></div>
        </>
      )}
      {s.phase === 'downloading' && (
        <>
          <div className="flex justify-between gap-2"><b className="font-medium">Downloading {s.version}</b>{s.total ? <span className="font-mono text-[11.5px] text-fg-3">{mb(s.got)} / {mb(s.total)}</span> : null}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><i className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${s.total ? Math.round(((s.got ?? 0) * 100) / s.total) : 8}%` }} /></div>
          <div className="mt-2 text-[12px] text-fg-3">It is checked against the release&rsquo;s SHA256SUMS before it is used.</div>
          <Button size="sm" variant="ghost" className="mt-1.5 -ml-2" onClick={() => void u.cancel()}>Cancel</Button>
        </>
      )}
      {s.phase === 'ready' && (
        <>
          <div className="flex gap-2.5">{tile('ok', <ShieldCheck />)}<div className="min-w-0"><b className="font-medium">{s.version} is ready</b><div className="text-[12px] text-fg-3">Checksum matches. Restarting takes a few seconds; your data stays.</div></div></div>
          {s.waiting ? <div className="mt-2 text-[12px] text-fg-2">Restarts when the run finishes.</div>
            : running > 0 ? (
              <>
                <div className="mt-2 text-[12px] text-warn">{running === 1 ? '1 run is going.' : `${running} runs are going.`} Restart now stops {running === 1 ? 'it' : 'them'}.</div>
                <div className="mt-2 flex flex-wrap gap-1.5"><Button size="sm" variant="primary" onClick={() => void u.restart(true)}>Restart when it finishes</Button><Button size="sm" onClick={() => void u.restart(false)}>Restart now</Button></div>
              </>
            ) : <Button size="sm" variant="primary" className="mt-2.5" icon={<RotateCw className="size-3.5" />} onClick={() => void u.restart(false)}>Restart to update</Button>}
        </>
      )}
      {(s.phase === 'failed' || s.phase === 'manual') && (
        <>
          <div className="flex gap-2.5">
            {s.phase === 'failed' ? tile('fail', <X />) : tile('ok', <Download />)}
            <div className="min-w-0 flex-1"><b className="font-medium">{s.phase === 'manual' ? `EZPipeline ${s.version} is out` : s.mismatch ? 'The download did not match' : 'The update did not finish'}</b><div className="text-[12px] text-fg-3">{s.message}</div></div>
            <IconButton size="sm" label="Dismiss" className="-mr-1 -mt-1" onClick={() => void u.dismiss()}><X className="size-3.5" /></IconButton>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {s.phase === 'failed' && s.version && <Button size="sm" onClick={() => void u.download()}>Try again</Button>}
            {s.page && <Button size="sm" variant="ghost" onClick={() => void desktop!.openExternal(s.page!)}>Downloads page</Button>}
          </div>
        </>
      )}
    </div>
  );
}

const DAY = 24 * 60 * 60 * 1000;
function tray(r: BuildHistoryEntry): TrayRun {
  const steps = r.steps ?? [];
  const done = steps.filter((s) => s.status === 'success').length;
  const at = steps.find((s) => s.status === 'running' || s.status === 'failed' || s.status === 'error') ?? steps.find((s) => s.status === 'pending');
  return { id: r.id, pipeline: r.pipelineName, number: r.buildNumber, step: at?.name ?? null, percent: steps.length ? Math.round((done * 100) / steps.length) : 0, endedAt: r.endTime ?? null };
}

/** Connected elsewhere: tell the tray what runs, waits and failed, whenever it changes. */
export function DesktopStateReporter() {
  const info = useDesktopInfo();
  const inst = useInstance();
  const { history } = useLive();
  useEffect(() => {
    if (info?.mode !== 'remote') return;
    const now = Date.now();
    desktop?.reportState({
      instance: inst?.name,
      running: history.filter((r) => r.status === 'running').map(tray),
      waiting: history.filter((r) => r.status === 'paused').map(tray),
      failed: history.filter((r) => (r.status === 'failed' || r.status === 'error') && r.endTime && now - Date.parse(r.endTime) < DAY).slice(0, 5).map(tray),
    });
  }, [info?.mode, history, inst?.name]);
  return null;
}
