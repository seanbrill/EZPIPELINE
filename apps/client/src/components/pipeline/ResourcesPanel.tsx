/**
 * Resources, by layer (design sheet f141). Files copied into $RESOURCES for
 * every run, from every layer, each labelled with the layer it comes from. A
 * file with the same path in a more specific layer replaces the other.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, File, KeyRound, MoreHorizontal, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import API_URL from '../../config/api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { Button, IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { Card, EmptyState, ErrorState, Skeleton } from '../ui/Feedback';
import { cx } from '../ui/cx';
import type { EnvScope } from './EnvPanel';

interface FileRow { path: string; size: number; modified: string }
interface Layer { id: string; label: string; kind: string; editable: boolean; files: FileRow[] }

const qs = (s: EnvScope) => ('pipeline' in s ? `pipeline=${encodeURIComponent(s.pipeline)}` : 'group' in s ? `group=${encodeURIComponent(s.group)}` : 'global=1');
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const isKey = (p: string) => /\.(pem|key)$|(^|\/)id_[a-z0-9]+$/i.test(p);

export function ResourcesPanel({ scope }: { scope: EnvScope }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [layers, setLayers] = useState<Layer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const q = qs(scope);

  const load = useCallback(() => {
    api<{ layers: Layer[] }>(`/resources?${q}`).then((r) => { setLayers(r.layers); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [q]);
  useEffect(load, [load]);

  const own = layers?.[layers.length - 1];

  const send = async (files: FileList | File[]) => {
    if (!own?.editable) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const body = new FormData();
      body.append('layer', own.id);
      body.append('file', f);
      try {
        const res = await fetch(`${API_URL}/api/resources`, { method: 'POST', body, headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      } catch (e) { toast.error(`Could not upload ${f.name}`, { description: (e as Error).message }); }
    }
    setBusy(false);
    load();
  };

  const download = async (l: Layer, f: FileRow) => {
    const res = await fetch(`${API_URL}/api/resources/file?layer=${encodeURIComponent(l.id)}&path=${encodeURIComponent(f.path)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` } });
    if (!res.ok) { toast.error('Could not download it'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = f.path.split('/').pop() ?? 'file'; a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (l: Layer, f: FileRow) => {
    if (!(await confirm({ title: `Delete ${f.path}?`, message: `Runs from now on will not have $RESOURCES/${f.path}${layers && layers.length > 1 ? ' unless another layer has it' : ''}.`, confirmText: 'Delete', isDangerous: true }))) return;
    try { await api('/resources', { method: 'DELETE', body: { layer: l.id, path: f.path } }); load(); }
    catch (e) { toast.error('Could not delete it', { description: (e as Error).message }); }
  };

  if (err) return <ErrorState title="Could not load the files" detail={err} action={<Button onClick={load}>Try again</Button>} />;
  if (!layers) return <Skeleton className="h-64 w-full" rounded="rounded-card" />;

  // Later layers replace earlier files at the same path.
  const winner = new Map<string, string>();
  for (const l of layers) for (const f of l.files) winner.set(f.path, l.id);
  const rows = layers.flatMap((l) => l.files.map((f) => ({ l, f, shadowed: winner.get(f.path) !== l.id }))).sort((a, b) => a.f.path.localeCompare(b.f.path));
  const live = rows.filter((r) => !r.shadowed);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card pad={false} className="overflow-hidden">
        {own?.editable && (
          <button type="button" onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files); }}
            className={cx('m-3 flex w-[calc(100%-1.5rem)] items-center gap-3.5 rounded-box border-[1.5px] border-dashed bg-bg-2 p-4 text-left text-fg-2 transition-colors', over ? 'border-primary bg-primary-soft' : 'border-line-3 hover:border-fg-3')}>
            <Upload className="size-5 shrink-0" />
            <span><b className="font-medium text-fg">{busy ? 'Uploading…' : <>Drop files here, or <span className="text-primary-hi">choose files</span></>}</b>
              <span className="block text-[12.5px] text-fg-3">Up to 50 MB each. Keys (.pem, .key, id_rsa) are made readable only by the run.</span></span>
            <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) void send(e.target.files); e.target.value = ''; }} />
          </button>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={<File />} title="No files yet">Files here are copied into each run&rsquo;s <code className="font-mono">$RESOURCES</code> folder.</EmptyState>
        ) : (
          <ul className="border-t border-line">
            {rows.map(({ l, f, shadowed }) => (
              <li key={`${l.id}|${f.path}`} className={cx('grid min-h-[52px] grid-cols-[20px_minmax(0,1fr)_72px_minmax(90px,150px)_28px] items-center gap-3 border-b border-line px-3.5 py-2 last:border-0 max-sm:grid-cols-[20px_minmax(0,1fr)_28px]', shadowed && 'opacity-55')}>
                <span className="text-fg-3">{isKey(f.path) ? <KeyRound className="size-4" /> : <File className="size-4" />}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <b className={cx('truncate font-mono text-[13px] font-medium', shadowed && 'line-through')}>{f.path}</b>
                  <small className="truncate font-mono text-[11.5px] text-fg-3">{shadowed ? 'not used: a more specific layer has this path' : `$RESOURCES/${f.path}`}</small>
                </span>
                <span className="font-mono text-[12px] text-fg-3 max-sm:hidden">{size(f.size)}</span>
                <span className="max-sm:hidden"><span className={cx('rounded-[6px] border px-2 py-0.5 text-[12px]', l === own && layers.length > 1 ? 'border-primary-line bg-primary-soft text-primary-hi' : 'border-line-2 bg-bg-2 text-fg-2')}>{l.label}</span></span>
                <span>
                  {l.editable && (
                    <Menu title={f.path} trigger={<IconButton size="sm" label={`${f.path} options`}><MoreHorizontal className="size-4" /></IconButton>}
                      items={[{ label: 'Download', icon: <Download className="size-4" />, onSelect: () => void download(l, f) }, { label: 'Delete', danger: true, onSelect: () => void remove(l, f) }]} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-3.5 py-3 text-[12.5px] text-fg-3">
          {live.length} file{live.length === 1 ? '' : 's'}, {size(live.reduce((n, r) => n + r.f.size, 0))} in each run&rsquo;s <code className="font-mono">$RESOURCES</code>. Downloading one needs the right to change it.
        </p>
      </Card>
      <Card>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">In a step</div>
        <pre className="mt-2.5 whitespace-pre-wrap break-all rounded-box bg-log-bg p-3 font-mono text-[11.5px] leading-relaxed text-log-fg">{`ssh -i "$RESOURCES/deploy.pem" deploy@host\ncp "$RESOURCES/site.conf" /etc/nginx/`}</pre>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-3">The folder is rebuilt for every run, so a step can change what is in it without changing the next run.</p>
      </Card>
    </div>
  );
}
