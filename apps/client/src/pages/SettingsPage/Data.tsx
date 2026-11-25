/** Settings › Data (design sheet f40). */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, FileArchive, Lock, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { bytes, toDate } from '../../lib/format';
import { downloadExport } from '../../lib/download';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { PageHead } from '../../components/settings/kit';
import { ExportModal, type ExportRecord } from '../../components/data/ExportModal';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, Skeleton } from '../../components/ui/Feedback';
import { format } from 'date-fns';

interface DataResp { dataDir: string; volume: { name: string; bytes: number }[]; database: { bytes: number }; exports: ExportRecord[] }
const LABEL: Record<string, string> = { workspace: 'Workspaces', versions: 'Archived versions', plugins: 'Plugins', logs: 'Logs', 'git-cache': 'Git cache', pipelines: 'Pipelines and env files', global: 'Global resources', exports: 'Exports', imports: 'Imports waiting' };

export default function Data() {
  const toast = useToast();
  const nav = useNavigate();
  const { confirm } = useConfirm();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState<DataResp | null>(null);
  const [exporting, setExporting] = useState(params.get('export') === '1');

  const load = useCallback(async () => { setD(await api<DataResp>('/data')); }, []);
  useEffect(() => {
    let live = true;
    api<DataResp>('/data').then((r) => { if (live) setD(r); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const remove = async (r: ExportRecord) => {
    if (!(await confirm({ title: `Delete ${r.file}?`, message: 'The file goes from this server. Copies you downloaded are not touched.', confirmText: 'Delete', isDangerous: true }))) return;
    try { await api(`/exports/${encodeURIComponent(r.file)}`, { method: 'DELETE' }); await load(); } catch (e) { toast.error((e as Error).message); }
  };
  const dl = (f: string) => { downloadExport(f).catch((e) => toast.error((e as Error).message)); };
  const total = d ? d.volume.reduce((a, v) => a + v.bytes, 0) + d.database.bytes : 0;

  return (
    <>
      <PageHead title="Data" lede="Everything this instance knows is one SQLite database and its data folder. Export it, or bring a bundle in." />

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2 text-[15px] font-semibold"><FileArchive className="size-4 text-fg-2" />Export</div>
          <p className="mt-1 text-[13px] text-fg-3">A .ezp bundle of the whole instance, one group or one pipeline. Secrets go in only when you seal them with a passphrase.</p>
          <Button className="mt-4" variant="primary" onClick={() => setExporting(true)}>Export…</Button>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-[15px] font-semibold"><Upload className="size-4 text-fg-2" />Import</div>
          <p className="mt-1 text-[13px] text-fg-3">Bring in a bundle from another EZPipeline. You see what is inside and every conflict before anything is written.</p>
          <Button className="mt-4" onClick={() => nav('/import')}>Import a bundle…</Button>
        </Card>
      </div>

      <h2 className="mb-2 mt-8 text-[15px] font-semibold">Recent exports <span className="font-normal text-fg-3">· kept 7 days</span></h2>
      {!d ? <Skeleton className="h-24 w-full" /> : d.exports.length === 0 ? <p className="rounded-card border border-line px-4 py-6 text-center text-[13.5px] text-fg-3">None yet.</p> : (
        <ul className="overflow-hidden rounded-card border border-line">
          {d.exports.map((r) => (
            <li key={r.file} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 last:border-0">
              <FileArchive className="size-5 shrink-0 text-fg-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px]">{r.file}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-fg-3"><span className="capitalize">{r.scopeType}</span> · {r.scope} · {bytes(r.bytes)} · {format(toDate(r.at), 'd MMM, HH:mm')} · {r.by}{r.sealed && <Badge className="ml-1" icon={<Lock className="size-3" />}>Sealed</Badge>}</div>
              </div>
              <Button size="sm" icon={<Download className="size-3.5" />} aria-label={`Download ${r.file}`} onClick={() => dl(r.file)}><span className="hidden sm:inline">Download</span></Button>
              <IconButton size="sm" label={`Delete ${r.file}`} onClick={() => void remove(r)}><Trash2 className="size-4" /></IconButton>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-8 text-[15px] font-semibold">Data folder</h2>
      {d && (
        <Card pad={false}>
          <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-4 py-3"><code className="min-w-0 truncate font-mono text-[13px]">{d.dataDir}</code><span className="ml-auto text-[13px] text-fg-2">{bytes(total)}</span></div>
          <ul className="px-4 py-2 text-[13px]">
            <li className="flex justify-between py-1"><span>Database <span className="font-mono text-fg-3">app.db</span></span><span className="text-fg-2">{bytes(d.database.bytes)}</span></li>
            {d.volume.filter((v) => v.bytes > 0).map((v) => <li key={v.name} className="flex justify-between py-1"><span>{LABEL[v.name] ?? v.name}</span><span className="text-fg-2">{bytes(v.bytes)}</span></li>)}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-[12.5px] text-fg-3">Moving the whole instance to a cloud? <Link to="/settings/self-hosting" className="text-fg-2 underline-offset-2 hover:underline">Self-hosting</Link> will carry this data across.</p>

      <ExportModal open={exporting} onClose={() => { setExporting(false); if (params.get('export')) { params.delete('export'); setParams(params, { replace: true }); } }} onMade={() => void load()} />
    </>
  );
}
