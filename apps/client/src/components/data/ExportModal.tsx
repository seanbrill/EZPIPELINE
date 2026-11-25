/**
 * Export (design sheet f47, f51, f52, f55–f57, f79): scope, contents, review,
 * then the bundle. Every door (Settings › Data, a group's menu, a pipeline's
 * menu, ⌘K) opens this with the scope already set.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Download, FileArchive, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { bytes } from '../../lib/format';
import { downloadExport } from '../../lib/download';
import { useLive } from '../../contexts/LiveContext';
import { allGroups } from '../shell/useRuns';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { Segmented } from '../ui/Tabs';
import { Switch } from '../ui/Toggle';
import { Banner, Skeleton } from '../ui/Feedback';
import { cx } from '../ui/cx';

export type ExportScope = { type: 'instance' } | { type: 'group'; group: string } | { type: 'pipeline'; pipeline: string };
type History = 'none' | 'last50' | 'all';
interface Counts { pipelines: number; groups: number; variables: number; resources: number; resourceBytes: number; credentials: number; schedules: number; watches: number; runs: number }
interface Preview { label: string; root: string; counts: Counts }
export interface ExportRecord { file: string; scope: string; scopeType: string; bytes: number; sealed: boolean; by: string; at: string; sha256: string; files: number }

const STEPS = ['Scope', 'Contents', 'Review', 'Export'];
const qs = (s: ExportScope) => new URLSearchParams(s.type === 'group' ? { type: 'group', group: s.group } : s.type === 'pipeline' ? { type: 'pipeline', pipeline: s.pipeline } : { type: 'instance' }).toString();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ExportModal({ open, onClose, initial, onMade }: { open: boolean; onClose: () => void; initial?: ExportScope; onMade?: (r: ExportRecord) => void }) {
  const { pipelines } = useLive();
  const groups = useMemo(() => allGroups(pipelines), [pipelines]);
  const [step, setStep] = useState(0);
  const [scope, setScope] = useState<ExportScope>(initial ?? { type: 'instance' });
  const [pv, setPv] = useState<Preview | null>(null);
  const [inc, setInc] = useState({ schedules: true, watches: true, resources: true, credentials: true, history: 'last50' as History });
  const [secrets, setSecrets] = useState(false);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<ExportRecord | null>(null);

  // Opening again starts over, at the scope it was opened with.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setStep(initial ? 1 : 0); setScope(initial ?? { type: 'instance' }); setMade(null); setErr(null); setPass(''); setAgain(''); setSecrets(false); }
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    api<Preview>(`/export/preview?${qs(scope)}`).then((p) => { if (live) setPv(p); }).catch((e) => { if (live) { setPv(null); setErr((e as Error).message); } });
    return () => { live = false; };
  }, [open, scope]);

  const c = pv?.counts;
  const passOk = !secrets || (pass.length >= 12 && pass === again);
  const make = async () => {
    setBusy(true); setErr(null); setStep(3);
    try {
      const r = await api<ExportRecord>('/export', { body: { scope, include: inc, passphrase: secrets ? pass : undefined } });
      setMade(r); onMade?.(r);
    } catch (e) { setErr((e as Error).message); setStep(2); } finally { setBusy(false); }
  };

  const title = made ? 'Bundle ready' : step === 3 ? 'Building the bundle' : scope.type === 'instance' ? 'Export everything' : `Export ${pv?.label ?? ''}`;
  const footer = made ? (
    <><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={<Download className="size-4" />} onClick={() => void downloadExport(made.file)}>Download</Button></>
  ) : step === 3 ? null : (
    <>
      {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
      {step === 0 && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
      {step < 2 ? <Button variant="primary" disabled={!pv || (step === 1 && !passOk)} onClick={() => setStep(step + 1)}>Continue</Button>
        : <Button variant="primary" loading={busy} onClick={() => void make()}>Create bundle</Button>}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} size="lg" busy={busy} title={title} icon={<FileArchive />} iconTone={made ? 'ok' : 'neutral'}
      description={made ? 'Kept on this server for 7 days, in Settings › Data.' : 'A .ezp bundle you can import into any EZPipeline 2. Nothing here changes.'}
      footer={footer}>
      <ol className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        {STEPS.map((s, i) => (
          <li key={s} className={cx('inline-flex items-center gap-1.5', i === step ? 'font-medium text-fg' : i < step || made ? 'text-primary-hi' : 'text-fg-3')}>
            <span className={cx('grid size-[18px] place-items-center rounded-full border text-[11px]', i < step || made ? 'border-primary bg-primary text-primary-ink' : i === step ? 'border-fg-2' : 'border-line-3')}>{i < step || made ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}

      {step === 0 && (
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="What goes in the bundle">
          <ScopeCard on={scope.type === 'instance'} onPick={() => setScope({ type: 'instance' })} title="Entire instance" body="Every group and pipeline, the global environment and resources." />
          <ScopeCard on={scope.type === 'group'} onPick={() => setScope({ type: 'group', group: scope.type === 'group' ? scope.group : groups[0] ?? '' })} title="One group" body="With everything inside it, nested groups included." disabled={!groups.length}>
            {scope.type === 'group' && <Select aria-label="Group" value={scope.group} onChange={(e) => setScope({ type: 'group', group: e.target.value })}>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</Select>}
          </ScopeCard>
          <ScopeCard on={scope.type === 'pipeline'} onPick={() => setScope({ type: 'pipeline', pipeline: scope.type === 'pipeline' ? scope.pipeline : pipelines[0]?.id ?? '' })} title="One pipeline" body="Its YAML, environment, resources, schedule and run history. Its group’s variables stay behind." disabled={!pipelines.length}>
            {scope.type === 'pipeline' && <Select aria-label="Pipeline" value={scope.pipeline} onChange={(e) => setScope({ type: 'pipeline', pipeline: e.target.value })}>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.group ? `${p.group} / ` : ''}{p.appName}</option>)}</Select>}
          </ScopeCard>
          <p className="text-[12.5px] text-fg-3">{c ? `${plural(c.pipelines, 'pipeline')} · ${plural(c.variables, 'variable')} · ${plural(c.resources, 'file')} (${bytes(c.resourceBytes)}) · ${plural(c.runs, 'run')}` : <Skeleton className="h-4 w-64" />}</p>
        </div>
      )}

      {step === 1 && c && (
        <div className="flex flex-col divide-y divide-line rounded-card border border-line">
          <Row title="Pipeline YAML and settings" desc={`${plural(c.pipelines, 'pipeline')}: steps, approval gates.`} right={<span className="text-[12.5px] text-fg-3">Always</span>} />
          <Row title="Environment variables" desc={secrets ? 'Names in plain text, values sealed.' : 'Their names. Values travel only with Secrets.'} right={<span className="text-[12.5px] text-fg-3">{c.variables}</span>} />
          <Row title={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" />Secrets</span>} desc={secrets ? 'Every variable value and private key, sealed with this passphrase.' : 'Off: values and private keys stay on this instance.'}
            right={<Switch checked={secrets} onChange={setSecrets} label={<span className="sr-only">Include secrets</span>} />}>
            {secrets && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Passphrase" hint="At least 12 characters."><Input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
                <Field label="Type it again" error={again && again !== pass ? 'They are different.' : undefined}><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
                <p className="text-[12.5px] text-warn sm:col-span-2">It is not in the bundle and nobody can recover it. Send it separately from the file, never in the same message.</p>
              </div>
            )}
          </Row>
          <Row title="Schedules" desc="They arrive paused." right={<Switch checked={inc.schedules} onChange={(v) => setInc({ ...inc, schedules: v })} label={<span className="sr-only">Schedules</span>} />} count={c.schedules} />
          <Row title="Auto-deploy watches" desc="They arrive paused." right={<Switch checked={inc.watches} onChange={(v) => setInc({ ...inc, watches: v })} label={<span className="sr-only">Watches</span>} />} count={c.watches} />
          <Row title="Resource files" desc={`Files copied into each run · ${bytes(c.resourceBytes)}`} right={<Switch checked={inc.resources} onChange={(v) => setInc({ ...inc, resources: v })} label={<span className="sr-only">Resources</span>} />} count={c.resources} />
          {scope.type !== 'pipeline' && <Row title="Git credentials" desc={secrets ? 'Public keys plain, private keys sealed.' : 'Names and public keys. Without Secrets they can’t be imported.'} right={<Switch checked={inc.credentials} onChange={(v) => setInc({ ...inc, credentials: v })} label={<span className="sr-only">Credentials</span>} />} count={c.credentials} />}
          <Row title="Run history" desc="Each run keeps its commit. Logs stay here." count={c.runs}
            right={<Segmented size="sm" label="Run history" items={[{ id: 'last50', label: 'Last 50' }, { id: 'all', label: 'All' }, { id: 'none', label: 'None' }]} value={inc.history} onChange={(v) => setInc({ ...inc, history: v as History })} />} />
        </div>
      )}

      {step === 2 && c && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-line p-4">
            <h3 className="mb-2 text-[13px] font-semibold">In the bundle</h3>
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              <li>{plural(c.pipelines, 'pipeline')}</li>
              <li>{plural(c.variables, 'variable name')}{secrets ? ', values sealed' : ''}</li>
              {inc.resources && <li>{plural(c.resources, 'resource file')} · {bytes(c.resourceBytes)}</li>}
              {(inc.schedules || inc.watches) && <li>{inc.schedules ? plural(c.schedules, 'schedule') : ''}{inc.schedules && inc.watches ? ', ' : ''}{inc.watches ? plural(c.watches, 'watch', 'watches') : ''}, paused when they arrive</li>}
              {inc.credentials && scope.type !== 'pipeline' && c.credentials > 0 && <li>{plural(c.credentials, 'credential')}{secrets ? ', private keys sealed' : ', public halves only'}</li>}
              {inc.history !== 'none' && <li>Run history ({inc.history === 'last50' ? 'last 50 per pipeline' : 'all'})</li>}
            </ul>
          </div>
          <div className="rounded-card border border-line p-4">
            <h3 className="mb-2 text-[13px] font-semibold">Not included</h3>
            <ul className="flex flex-col gap-1.5 text-[13.5px] text-fg-2">
              {!secrets && <li>Variable values and private keys</li>}
              <li>Run logs and archived versions</li>
              <li>Users, permissions and tokens</li>
              {scope.type !== 'instance' && <li>Global variables and resources</li>}
              <li>Plugins: install them on the other instance</li>
            </ul>
          </div>
          <p className="text-[12.5px] text-fg-3 sm:col-span-2">Format ezp/1, a plain zip. Imports into EZPipeline 2.0 or later.</p>
        </div>
      )}

      {step === 3 && !made && <div className="flex flex-col gap-3 py-6"><Skeleton className="h-3 w-full" /><p className="text-center text-[13.5px] text-fg-2">Reading files, sealing and compressing…</p></div>}

      {made && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-card border border-primary-line bg-primary-soft p-4">
            <FileArchive className="size-6 shrink-0 text-primary-hi" />
            <div className="min-w-0">
              <div className="truncate font-mono text-[13.5px] font-medium">{made.file}</div>
              <div className="text-[12.5px] text-fg-2">{bytes(made.bytes)} · {plural(made.files, 'file')} · sha256 {made.sha256.slice(0, 6)}…{made.sha256.slice(-4)}</div>
            </div>
          </div>
          {made.sealed
            ? <Banner tone="ok" title="Secrets sealed">They open only with the passphrase. Send it separately from the file.</Banner>
            : <Banner tone="info" title="No secrets inside">Variables arrive without values, and deploy keys without their private halves. Whoever imports it fills the values in.</Banner>}
        </div>
      )}
    </Modal>
  );
}

function ScopeCard({ on, onPick, title, body, children, disabled }: { on: boolean; onPick: () => void; title: string; body: string; children?: ReactNode; disabled?: boolean }) {
  return (
    <div role="radio" aria-checked={on} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={() => !disabled && !on && onPick()} onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !disabled) { e.preventDefault(); onPick(); } }}
      className={cx('cursor-pointer rounded-card border p-4 transition-colors', on ? 'border-primary bg-primary-soft/40' : 'border-line-2 hover:border-line-3', disabled && 'cursor-not-allowed opacity-50')}>
      <div className="flex items-start gap-3">
        <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', on ? 'border-primary' : 'border-line-3')}>{on && <span className="size-2 rounded-full bg-primary" />}</span>
        <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{title}</div><div className="text-[12.5px] text-fg-3">{body}</div>{children && <div className="mt-3" onClick={(e) => e.stopPropagation()}>{children}</div>}</div>
      </div>
    </div>
  );
}

function Row({ title, desc, right, count, children }: { title: ReactNode; desc: string; right: ReactNode; count?: number; children?: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{title}{count != null && <span className="ml-2 font-mono text-[12px] font-normal text-fg-3">{count}</span>}</div><div className="text-[12.5px] text-fg-3">{desc}</div></div>
        <div className="shrink-0">{right}</div>
      </div>
      {children}
    </div>
  );
}
