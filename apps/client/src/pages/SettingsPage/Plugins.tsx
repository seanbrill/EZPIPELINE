/**
 * Settings › Plugins (design sheet f24, f25, f28). The official catalogue:
 * command-line tools installed once on this host for every pipeline. Installs
 * run one at a time and keep going if you leave the page; a failure keeps its
 * log. Remove says which pipelines call the tool first.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Check, RefreshCw, ScrollText } from 'lucide-react';
import { api } from '../../lib/api';
import { installsSnapshot, queueInstalls, subscribeInstalls, type Install } from '../../lib/pluginInstall';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { PageHead } from '../../components/settings/kit';
import { Button, Spinner } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Banner, Skeleton } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { cx } from '../../components/ui/cx';

interface Plugin { id: string; name: string; description: string; isInstalled: boolean; version?: string; builtin?: boolean; category?: string; command?: string; managed?: boolean; calledBy?: string[] }

const CATS: [string, string][] = [['cloud', 'Cloud'], ['containers', 'Containers'], ['infrastructure', 'Infrastructure'], ['data', 'Data'], ['image', 'Images']];
const TILE: Record<string, string> = { filefreak: 'FF', 'aws-cli': 'AWS', 'azure-cli': 'Az', gcloud: 'GCP', bicep: 'Bcp', azcopy: 'Az→', kubectl: 'k8s', helm: 'Helm', terraform: 'TF', jq: 'jq', yq: 'yq' };
const semver = (v?: string) => v?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null;
const cmd = (p: Plugin) => p.command?.split('|')[0];

export default function Plugins() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const installs = useSyncExternalStore(subscribeInstalls, installsSnapshot);
  const [list, setList] = useState<Plugin[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [log, setLog] = useState<Install | null>(null);

  const load = useCallback(async () => {
    setChecking(true);
    try { setList((await api<{ plugins: Plugin[] }>('/plugins')).plugins); setErr(null); }
    catch (e) { setErr((e as Error).message); } finally { setChecking(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // When an install ends, read what is really there now.
  const finished = installs.filter((i) => i.state === 'installed' || i.state === 'failed').length;
  useEffect(() => { if (finished) void load(); }, [finished, load]);

  const remove = async (p: Plugin) => {
    const users = p.calledBy ?? [];
    const ok = await confirm({
      title: `Remove ${p.name}?`,
      message: users.length ? <>These pipelines call <code className="font-mono">{cmd(p)}</code> and will fail until it is back: <b>{users.join(', ')}</b>.</> : 'No pipeline calls it now. You can install it again any time.',
      confirmText: 'Remove', isDangerous: true,
    });
    if (!ok) return;
    try { await api(`/plugins/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast.success(`${p.name} removed`); void load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (err && !list) return <Banner tone="fail">{err}</Banner>;
  if (!list) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const job = (id: string) => installs.find((i) => i.id === id);
  const featured = list.find((p) => p.id === 'filefreak');
  const tools = list.filter((p) => !p.builtin && p.id !== 'filefreak');
  const builtins = list.filter((p) => p.builtin);

  const row = (p: Plugin, big = false) => (
    <PluginRow key={p.id} p={p} big={big} job={job(p.id)} admin={isAdmin}
      onInstall={() => queueInstalls([p.id])} onRemove={() => void remove(p)} onLog={(j) => setLog(j)} />
  );

  return (
    <>
      <PageHead title="Plugins" lede="Official command-line tools, installed once on this host for every pipeline. Steps call them by name."
        action={<Button icon={<RefreshCw className={cx('size-4', checking && 'animate-spin')} />} onClick={() => void load()}>Check again</Button>} />

      {featured && <div className="mb-6">{row(featured, true)}</div>}

      {CATS.map(([id, label]) => {
        const ps = tools.filter((p) => (p.category ?? 'data') === id);
        if (!ps.length) return null;
        return (
          <section key={id} className="mb-6">
            <h2 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{label}</h2>
            <div className="grid gap-3 xl:grid-cols-2">{ps.map((p) => row(p))}</div>
          </section>
        );
      })}

      <section className="mt-8 rounded-card border border-line bg-surface-2 p-4">
        <h2 className="text-[14px] font-semibold">Built in</h2>
        <p className="mb-3 mt-0.5 text-[13px] text-fg-3">Part of this server’s image. Nothing to install; this says whether a step can call it.</p>
        <div className="flex flex-wrap gap-2">
          {builtins.map((p) => (
            <span key={p.id} title={p.description} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[12px]', p.isInstalled ? 'border-line-2 text-fg-2' : 'border-warn-line text-warn')}>
              {p.isInstalled ? <Check className="size-3 text-primary" /> : '!'}{p.id}{semver(p.version) && <span className="text-fg-3">{semver(p.version)}</span>}
            </span>
          ))}
        </div>
      </section>

      <Modal open={!!log} onClose={() => setLog(null)} title={log ? `${list.find((p) => p.id === log.id)?.name ?? log.id}: install log` : ''} size="lg"
        footer={<><Button variant="ghost" onClick={() => setLog(null)}>Close</Button>{log?.state === 'failed' && isAdmin && <Button variant="primary" onClick={() => { queueInstalls([log.id]); setLog(null); }}>Try again</Button>}</>}>
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-box bg-log-bg p-4 font-mono text-[12px] leading-[1.6] text-log-fg">{log?.log.trim() || 'Nothing was printed.'}</pre>
      </Modal>
    </>
  );
}

function PluginRow({ p, big, job, admin, onInstall, onRemove, onLog }: { p: Plugin; big?: boolean; job?: Install; admin: boolean; onInstall: () => void; onRemove: () => void; onLog: (j: Install) => void }) {
  const busy = job && (job.state === 'queued' || job.state === 'installing');
  const failed = job?.state === 'failed' && !p.isInstalled;
  const users = p.calledBy ?? [];
  const lastLine = failed ? job!.log.trim().split('\n').filter(Boolean).pop()?.replace(/^ERROR:\s*/, '') : null;
  return (
    <div className={cx('flex min-w-0 items-start gap-3.5 rounded-card border bg-surface', big ? 'border-primary-line p-5' : 'p-4', failed ? 'border-fail-line' : !big && 'border-line')}>
      <span className={cx('grid shrink-0 place-items-center rounded-box border font-mono font-semibold', big ? 'size-12 border-primary-line bg-primary-soft text-[15px] text-primary-hi' : 'size-10 border-line-2 bg-surface-2 text-[12px] text-fg-2')}>{TILE[p.id] ?? p.id.slice(0, 3)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className={cx('font-semibold', big ? 'text-[16px]' : 'text-[14px]')}>{p.name}</b>
          {big && <Badge tone="ok">Featured</Badge>}
          {p.id === 'gcloud' && !p.isInstalled && <Badge tone="run">New</Badge>}
        </div>
        <p className={cx('mt-0.5 text-fg-3', big ? 'text-[13.5px]' : 'text-[12.5px]')}>{big ? p.description : <><code className="font-mono">{cmd(p)}</code>{' · '}{p.description.split('.')[0]}</>}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          {busy ? <span className="inline-flex items-center gap-1.5 text-run"><Spinner size={12} />{job!.state === 'queued' ? 'Waiting its turn' : 'Installing'}</span>
            : failed ? <span className="min-w-0 text-fail">Failed{lastLine ? `: ${lastLine}` : ''}</span>
            : p.isInstalled ? <span className="text-primary-hi">Installed{semver(p.version) ? ` v${semver(p.version)}` : ''}</span>
            : <span className="text-fg-3">Not installed</span>}
          {p.isInstalled && users.length > 0 && <span className="text-fg-3">Called by {users.length} pipeline{users.length === 1 ? '' : 's'}</span>}
          {big && <span className="text-fg-3">Signs in with <code className="font-mono text-fg-2">FILEFREAK_KEY</code>, set in Environment</span>}
          {job && (busy || failed) && <button type="button" onClick={() => onLog(job)} className="inline-flex items-center gap-1 text-fg-2 underline-offset-2 hover:text-fg hover:underline"><ScrollText className="size-3.5" />Log</button>}
        </div>
      </div>
      {admin && !busy && (p.isInstalled
        ? (p.managed ? <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button> : <span className="pt-1 text-[12px] text-fg-3" title="Installed on the host, not by this server">On the host</span>)
        : <Button size="sm" variant={big ? 'primary' : 'secondary'} onClick={onInstall}>{failed ? 'Try again' : 'Install'}</Button>)}
    </div>
  );
}
