/**
 * Import a bundle (design sheet f63, f64, f72, f73, f74, f78, f80). Five
 * steps, and nothing is written until the last one: the file is read and
 * checked, then it goes somewhere, then each conflict is decided, then the
 * secrets are unlocked (or not), then it is imported.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, FileArchive, FolderPlus, GitMerge, Lock, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { bytes, toDate } from '../../lib/format';
import { uploadBundle } from '../../lib/download';
import { useLive } from '../../contexts/LiveContext';
import { usePageChrome } from '../../components/shell/chrome';
import { Page } from '../../components/shell/states';
import { allGroups } from '../../components/shell/useRuns';
import type { ExportRecord } from '../../components/data/ExportModal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Field, Input, Select } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Tabs';
import { Banner, Card, Skeleton } from '../../components/ui/Feedback';
import { cx } from '../../components/ui/cx';
import { format } from 'date-fns';

interface Summary { id: string; name: string; bytes: number; files: number; format: string; app: string; createdAt: string; from: { instance: string; by: string }; scope: { type: string; root: string; label: string }; counts: Record<string, number>; sealed: boolean; sealedCount: number }
type Decision = 'skip' | 'replace' | 'both';
interface Item { key: string; kind: string; label: string; detail?: string; bundle?: string; here?: string; identical?: boolean; choices: Decision[] }
interface Plan { root: string; added: number; items: Item[] }
interface Report { added: number; replaced: number; both: number; skipped: number; secrets: string; sealedSkipped: number; pausedSchedules: number; pausedWatches: number; runs: number; credentialsWithoutKey: string[]; renamed: { from: string; to: string }[]; group: string; pipelines: { id: string; appName: string }[] }
type Dest = { mode: 'new'; name: string } | { mode: 'merge'; group: string };

const STEPS = ['File', 'Destination', 'Conflicts', 'Secrets', 'Import'];
const ONE: Record<string, string> = { pipelines: 'pipeline', variables: 'variable', resources: 'resource', credentials: 'credential', schedules: 'schedule', watches: 'watch', runs: 'run' };
const LABEL: Record<Decision, string> = { skip: 'Skip', replace: 'Replace', both: 'Keep both' };
const groupUrl = (g: string) => `/groups/${g.split('/').map(encodeURIComponent).join('/')}`;

export default function ImportPage() {
  usePageChrome([{ label: 'Settings', to: '/settings' }, { label: 'Data', to: '/settings/data' }, { label: 'Import' }]);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { pipelines, refresh } = useLive();
  const groups = useMemo(() => allGroups(pipelines), [pipelines]);
  const [step, setStep] = useState(0);
  const [sum, setSum] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<ExportRecord[] | null>(null);
  const [dest, setDest] = useState<Dest>({ mode: 'new', name: '' });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [pass, setPass] = useState('');
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const into = params.get('into');

  useEffect(() => {
    let live = true;
    api<{ exports: ExportRecord[] }>('/data').then((d) => { if (live) setRecent(d.exports); }).catch(() => { if (live) setRecent([]); });
    return () => { live = false; };
  }, []);

  const got = (s: Summary) => {
    setSum(s);
    const base = s.scope.type === 'pipeline' ? (into ?? s.scope.root ?? '') : s.scope.label;
    setDest(into || s.scope.type === 'pipeline' || s.scope.type === 'instance' ? { mode: 'merge', group: into ?? (s.scope.type === 'pipeline' ? base : '') } : { mode: 'new', name: `${base} imported` });
    setStep(1);
  };
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try { got(await uploadBundle<Summary>(f)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const pickExport = async (file: string) => {
    setBusy(true); setErr(null);
    try { got(await api<Summary>('/import/inspect', { body: { export: file } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const toConflicts = async () => {
    if (!sum) return;
    setBusy(true); setErr(null);
    try {
      const p = await api<Plan>(`/import/${sum.id}/plan`, { body: { dest } });
      setPlan(p);
      setDec(Object.fromEntries(p.items.map((i) => [i.key, 'skip' as Decision])));
      setStep(p.items.length ? 2 : sum.sealed ? 3 : 4);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const tryUnlock = async () => {
    if (!sum) return;
    setBusy(true); setErr(null);
    try { const r = await api<{ ok: boolean }>(`/import/${sum.id}/unlock`, { body: { passphrase: pass } }); setUnlocked(r.ok); if (r.ok) setStep(4); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const doImport = async () => {
    if (!sum) return;
    setBusy(true); setErr(null);
    try { setReport(await api<Report>(`/import/${sum.id}/apply`, { body: { dest, decisions: dec, passphrase: unlocked ? pass : undefined } })); void refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const counts = sum?.counts ?? {};
  const where = dest.mode === 'new' ? dest.name : dest.group || 'the top level';
  const tally = Object.values(dec).reduce((a, d) => ({ ...a, [d]: (a[d] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{report ? `Imported into ${report.group || 'this instance'}` : 'Import a bundle'}</h1>
          <p className="mt-1 text-[14px] text-fg-2">{report ? `From ${sum?.name}` : 'Pipelines, groups and their settings from another EZPipeline, in one .ezp file. Nothing is written until you press Import.'}</p>
        </div>
        {!report && <Button variant="ghost" onClick={() => nav('/settings/data')}>Close</Button>}
      </div>

      {!report && (
        <ol className="mb-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          {STEPS.map((s, i) => (
            <li key={s} className={cx('inline-flex items-center gap-1.5', i === step ? 'font-medium text-fg' : i < step ? 'text-primary-hi' : 'text-fg-3')}>
              <span className={cx('grid size-5 place-items-center rounded-full border text-[11px]', i < step ? 'border-primary bg-primary text-primary-ink' : i === step ? 'border-fg-2' : 'border-line-3')}>{i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>{s}
            </li>
          ))}
        </ol>
      )}
      {err && <Banner tone="fail" className="mb-5">{err}</Banner>}

      {step === 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void pickFile(e.dataTransfer.files[0]); }}
              className={cx('flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors', drag ? 'border-primary bg-primary-soft' : 'border-line-2 hover:border-line-3')}>
              <Upload className="size-7 text-fg-3" />
              <span className="text-[15px] font-medium">Drop a .ezp file here</span>
              <span className="text-[13px] text-fg-3">or</span>
              <Button loading={busy} onClick={(e) => { e.preventDefault(); fileInput.current?.click(); }}>Choose a file…</Button>
              <span className="text-[12px] text-fg-3">Read and checked on this server. Up to 512 MB.</span>
              <input ref={fileInput} type="file" accept=".ezp,application/zip" className="sr-only" onChange={(e) => void pickFile(e.target.files?.[0])} />
            </label>
            {!!recent?.length && (
              <div className="mt-5">
                <h2 className="mb-2 text-[13px] font-semibold">Or use a recent export from this instance</h2>
                <ul className="overflow-hidden rounded-card border border-line">
                  {recent.slice(0, 5).map((r) => (
                    <li key={r.file} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                      <FileArchive className="size-5 shrink-0 text-fg-3" />
                      <div className="min-w-0 flex-1"><div className="truncate font-mono text-[13px]">{r.file}</div><div className="text-[12px] text-fg-3">{r.scope} · {bytes(r.bytes)} · {format(toDate(r.at), 'd MMM, HH:mm')}</div></div>
                      <Button size="sm" disabled={busy} onClick={() => void pickExport(r.file)}>Use this</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Card className="h-fit">
            <ol className="flex flex-col gap-4 text-[13.5px]">
              <li><b className="font-medium">1 · What is inside</b><p className="text-fg-3">Read, and checked against its checksums.</p></li>
              <li><b className="font-medium">2 · Where it goes</b><p className="text-fg-3">A new group, or merged into one you have.</p></li>
              <li><b className="font-medium">3 · Every conflict</b><p className="text-fg-3">Skip, Replace or Keep both, item by item.</p></li>
            </ol>
          </Card>
        </div>
      )}

      {step === 1 && sum && (
        <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="h-fit">
            <div className="flex items-center gap-3"><FileArchive className="size-6 text-primary-hi" /><div className="min-w-0"><div className="truncate font-mono text-[13.5px] font-medium">{sum.name}</div><div className="text-[12px] text-fg-3">{bytes(sum.bytes)} · format {sum.format}</div></div></div>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-primary-hi"><Check className="size-3.5" />{sum.files} checksums match</p>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-1.5 text-[13px]">
              <dt className="text-fg-3">From</dt><dd>{sum.from.instance} <span className="text-fg-3">v{sum.app}</span></dd>
              <dt className="text-fg-3">Exported by</dt><dd>{sum.from.by}</dd>
              <dt className="text-fg-3">Date</dt><dd>{format(new Date(sum.createdAt), 'd MMM yyyy, HH:mm')}</dd>
              <dt className="text-fg-3">Scope</dt><dd className="capitalize">{sum.scope.type} · {sum.scope.label}</dd>
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {(['pipelines', 'variables', 'resources', 'credentials', 'schedules', 'watches', 'runs'] as const).filter((k) => counts[k]).map((k) => <Badge key={k}>{counts[k]} {counts[k] === 1 ? ONE[k] : k}</Badge>)}
            </div>
            {sum.sealed && <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-2"><Lock className="size-3.5" />Secrets sealed with a passphrase</p>}
            <button type="button" className="mt-4 text-[12.5px] text-fg-2 underline-offset-2 hover:underline" onClick={() => { setSum(null); setStep(0); }}>Choose another file</button>
          </Card>
          <div>
            <h2 className="mb-3 text-[16px] font-semibold">Where should it go?</h2>
            <div className="flex flex-col gap-3" role="radiogroup">
              <DestCard on={dest.mode === 'new'} onPick={() => setDest({ mode: 'new', name: `${sum.scope.type === 'instance' ? 'Imported' : sum.scope.label} imported` })} icon={<FolderPlus />} title="Into a new group" body="Nothing that exists here changes.">
                  {dest.mode === 'new' && <Field label="Group name"><Input value={dest.name} onChange={(e) => setDest({ mode: 'new', name: e.target.value })} /></Field>}
                </DestCard>
              <DestCard on={dest.mode === 'merge'} onPick={() => setDest({ mode: 'merge', group: groups.includes(sum.scope.root) ? sum.scope.root : '' })} icon={<GitMerge />} title="Merge into an existing group" body="Items with the same name meet; you decide each one next.">
                {dest.mode === 'merge' && (
                  <Select aria-label="Group" value={dest.group} onChange={(e) => setDest({ mode: 'merge', group: e.target.value })}>
                    <option value="">The top level (no group)</option>
                    {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                  </Select>
                )}
              </DestCard>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setStep(0)}>Back</Button><Button variant="primary" loading={busy} disabled={dest.mode === 'new' && !dest.name.trim()} onClick={() => void toConflicts()}>Continue</Button></div>
          </div>
        </div>
      )}

      {step === 2 && plan && (
        <div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold">{plan.items.length} item{plan.items.length === 1 ? '' : 's'} already exist in {where}</h2>
              <p className="text-[13px] text-fg-3">{plan.added ? `The other ${plan.added} ${plan.added === 1 ? 'is' : 'are'} new and will be added. ` : 'Nothing else is new. '}Keep both adds the bundle’s copy under a new name.</p>
            </div>
            <span className="text-[12.5px] text-fg-3">Set all to</span>
            <Segmented size="sm" label="Set all to" items={(['skip', 'replace', 'both'] as Decision[]).map((d) => ({ id: d, label: LABEL[d] }))} value={'' as Decision}
              onChange={(d) => setDec(Object.fromEntries(plan.items.map((i) => [i.key, i.choices.includes(d as Decision) ? (d as Decision) : 'skip'])))} />
          </div>
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[720px] text-left text-[13.5px]">
              <thead className="bg-surface-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3"><tr><th className="px-4 py-2.5 font-normal">Item</th><th className="px-4 py-2.5 font-normal">In the bundle</th><th className="px-4 py-2.5 font-normal">Here now</th><th className="px-4 py-2.5 font-normal">What to do</th></tr></thead>
              <tbody>
                {plan.items.map((i) => (
                  <tr key={i.key} className="border-t border-line">
                    <td className="px-4 py-3"><div className="font-mono text-[11px] uppercase text-fg-3">{i.kind}</div><div className="font-medium">{i.label}</div>{i.detail && <div className="max-w-[260px] truncate text-[12px] text-fg-3" title={i.detail}>{i.detail}</div>}</td>
                    <td className="px-4 py-3 text-fg-2">{i.bundle}</td>
                    <td className="px-4 py-3 text-fg-2">{i.identical ? <span className="text-primary-hi">Identical</span> : i.here}</td>
                    <td className="px-4 py-3"><Segmented size="sm" label={`What to do with ${i.label}`} items={i.choices.map((d) => ({ id: d, label: LABEL[d] }))} value={dec[i.key]} onChange={(d) => setDec({ ...dec, [i.key]: d as Decision })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-[12.5px] text-fg-3">{(['skip', 'replace', 'both'] as Decision[]).map((d) => `${LABEL[d]} ${tally[d] ?? 0}`).join(' · ')}</span>
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button><Button variant="primary" onClick={() => setStep(sum?.sealed ? 3 : 4)}>Continue</Button>
          </div>
        </div>
      )}

      {step === 3 && sum && (
        <div className="max-w-[560px]">
          <h2 className="text-[16px] font-semibold">Unlock the secrets</h2>
          <p className="mt-1 text-[13.5px] text-fg-2">{sum.sealedCount} value{sum.sealedCount === 1 ? '' : 's'} in this bundle {sum.sealedCount === 1 ? 'is' : 'are'} sealed with the passphrase chosen when it was exported by {sum.from.by} on {sum.from.instance}. It is not in the file; ask them for it.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void tryUnlock(); }}>
            <Field label="Passphrase" error={unlocked === false ? 'That passphrase does not open them. Nothing was decrypted. Check for a typo and try again.' : undefined}><Input type="password" autoFocus value={pass} onChange={(e) => { setPass(e.target.value); setUnlocked(null); }} /></Field>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setStep(plan?.items.length ? 2 : 1)}>Back</Button><Button variant="primary" type="submit" loading={busy} disabled={!pass}>Unlock</Button></div>
          </form>
          <Card className="mt-6">
            <h3 className="text-[14px] font-semibold">No passphrase?</h3>
            <p className="mt-1 text-[13px] text-fg-2">Continue without secrets: variables arrive with empty values, and deploy keys are left out. Values already set here are never blanked.</p>
            <Button className="mt-3" onClick={() => { setUnlocked(false); setPass(''); setStep(4); }}>Continue without secrets</Button>
          </Card>
        </div>
      )}

      {step === 4 && sum && plan && !report && (
        <div className="max-w-[640px]">
          <h2 className="text-[16px] font-semibold">Import into {where}?</h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-[13.5px] text-fg-2">
            <li>{plan.added} new item{plan.added === 1 ? '' : 's'} added</li>
            {plan.items.length > 0 && <li>{(['skip', 'replace', 'both'] as Decision[]).map((d) => `${tally[d] ?? 0} ${LABEL[d].toLowerCase()}`).join(', ')}</li>}
            {sum.sealed && <li>{unlocked ? 'Secrets unlocked' : 'Secrets left sealed: variables arrive empty'}</li>}
            {(counts.schedules || counts.watches) ? <li>Schedules and watches arrive paused</li> : null}
          </ul>
          <p className="mt-3 text-[12.5px] text-fg-3">Everything is checked before anything is written.</p>
          <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setStep(sum.sealed ? 3 : plan.items.length ? 2 : 1)}>Back</Button><Button variant="primary" loading={busy} onClick={() => void doImport()}>Import</Button></div>
        </div>
      )}

      {report && (
        <div className="max-w-[760px]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Added', report.added], ['Replaced', report.replaced], ['Kept both', report.both], ['Skipped', report.skipped]].map(([l, n]) => (
              <Card key={l as string}><div className="text-[24px] font-semibold">{n}</div><div className="text-[12.5px] text-fg-3">{l}</div></Card>
            ))}
          </div>
          <h2 className="mb-2 mt-6 text-[15px] font-semibold">What to do next</h2>
          <ul className="flex flex-col gap-2">
            {report.secrets === 'left-sealed' && <Next tone="warn" title={`${report.sealedSkipped} secret${report.sealedSkipped === 1 ? '' : 's'} left sealed`}>The variables are here with empty values. Fill them in on each Environment tab.</Next>}
            {report.credentialsWithoutKey.length > 0 && <Next tone="warn" title={`${report.credentialsWithoutKey.length} deploy key${report.credentialsWithoutKey.length === 1 ? '' : 's'} left behind`}>{report.credentialsWithoutKey.join(', ')}: generate new keys on the group’s Credentials tab and add them to GitHub.</Next>}
            {report.pausedSchedules + report.pausedWatches > 0 && <Next title={`${report.pausedSchedules ? `${report.pausedSchedules} schedule${report.pausedSchedules === 1 ? '' : 's'}` : ''}${report.pausedSchedules && report.pausedWatches ? ' and ' : ''}${report.pausedWatches ? `${report.pausedWatches} watch${report.pausedWatches === 1 ? '' : 'es'}` : ''} arrived paused`}>Turn {report.pausedSchedules + report.pausedWatches === 1 ? 'it' : 'them'} on from the pipeline’s Schedule and Auto deploy tabs when you’re ready.</Next>}
            {report.renamed.map((r) => <Next key={r.from + r.to} title={`${r.from} was kept twice`}>The bundle’s copy is {r.to}.</Next>)}
            {report.runs > 0 && <Next title="Run history kept with its commits">{report.runs} run{report.runs === 1 ? '' : 's'}. Their logs stayed on the other instance.</Next>}
          </ul>
          <div className="mt-6 flex flex-wrap gap-2">
            {report.group ? <Button variant="primary" onClick={() => nav(groupUrl(report.group))}>Open {report.group}</Button> : <Button variant="primary" onClick={() => nav('/pipelines')}>Open Pipelines</Button>}
            <Button onClick={() => { setReport(null); setSum(null); setPlan(null); setStep(0); setPass(''); setUnlocked(null); }}>Import another</Button>
            <Link to="/settings/data" className="inline-flex h-9 items-center px-3 text-[13.5px] text-fg-2 hover:text-fg">Back to Data</Link>
          </div>
        </div>
      )}
      {busy && step === 0 && <Skeleton className="mt-4 h-2 w-full" />}
    </Page>
  );
}

function DestCard({ on, onPick, icon, title, body, children }: { on: boolean; onPick: () => void; icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div role="radio" aria-checked={on} tabIndex={0} onClick={() => !on && onPick()} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onPick(); } }}
      className={cx('cursor-pointer rounded-card border p-4', on ? 'border-primary bg-primary-soft/40' : 'border-line-2 hover:border-line-3')}>
      <div className="flex items-start gap-3">
        <span className={cx('grid size-9 shrink-0 place-items-center rounded-box border [&>svg]:size-[18px]', on ? 'border-primary-line text-primary-hi' : 'border-line-2 text-fg-2')}>{icon}</span>
        <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{title}</div><div className="text-[12.5px] text-fg-3">{body}</div>{children && <div className="mt-3 max-w-[420px]" onClick={(e) => e.stopPropagation()}>{children}</div>}</div>
      </div>
    </div>
  );
}

function Next({ title, children, tone }: { title: string; children: ReactNode; tone?: 'warn' }) {
  return (
    <li className={cx('rounded-card border px-4 py-3', tone === 'warn' ? 'border-warn-line bg-warn-soft' : 'border-line bg-surface')}>
      <div className={cx('text-[14px] font-medium', tone === 'warn' && 'text-warn')}>{title}</div>
      <div className="text-[13px] text-fg-2">{children}</div>
    </li>
  );
}
