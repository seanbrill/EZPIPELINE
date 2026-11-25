/**
 * Deploy EZPipeline to your cloud (design sheet f96–f108; phone f109, f114, f115).
 *
 * Seven steps, saved as a draft after each one: nothing is made in the cloud until
 * Deploy. The deploy is a pipeline run on this server ("Deploy <name> to AWS", in the
 * Self-hosting group), so closing the page does not stop it, and its log is the
 * run's log.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Box, Check, CircleAlert, Copy, Database, Download, ExternalLink, FileArchive, Globe, Info, Lock,
  RefreshCw, Server, TriangleAlert, Upload, X,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import API_URL from '../../config/api';
import { bytes } from '../../lib/format';
import { LiveProvider } from '../../contexts/LiveContext';
import { useToast } from '../../contexts/ToastContext';
import { LogoMark } from '../../components/brand/Logo';
import { BootSplash } from '../../components/shell/states';
import { LogView, useRunLog } from '../../components/run/LogView';
import { Button, Spinner } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Toggle';
import { Segmented } from '../../components/ui/Tabs';
import { Banner, Card } from '../../components/ui/Feedback';
import { cx } from '../../components/ui/cx';

/* ---------------------------------------------------------------- types */

type Size = '0.5' | '1' | '2' | '4';
interface Group { id: string; label: string; actions: string[]; denied: string[]; needed: boolean }
interface Draft {
  id: string; cloud: 'aws'; step: number; by: { id: number; username: string };
  connect: { mode: 'profile' | 'keys'; profile: string; accessKeyId: string; hasSecret: boolean; identity: { arn: string; account: string; name: string } | null; checked: { at: string; groups: Group[]; note: string | null; error: string | null } | null };
  config: { name: string; region: string; adminEmail: string; size: Size; storageGb: number; address: 'lb' | 'domain'; domain: string; staticIp: boolean };
  data: { mode: 'fresh' | 'move' | 'bundle'; bundleFile: string; hasPass: boolean; history: 'none' | 'last50' | 'all'; pauseHere: boolean };
  deploy: null | {
    pipelineId: string; removePipelineId: string; buildId: string | null; startedAt: string; lbDns: string | null;
    moved: { users: number; pipelines: number; groups: number; variables: number; credentials: number; runs: number; secrets: string } | null;
    pausedHere: { schedules: number[]; watches: number[] } | null; finished: { at: string; choice: string } | null;
  };
}
interface RunStep { name: string; status: string; durationMs: number | null; startedAt: string | null; failure: { exitCode: number | null; meaning: string | null; lastLines: string[] } | null }
interface Run { id: string; number: number; status: string; startedAt: string; endedAt: string | null; error: string | null; steps: RunStep[] }
interface Full {
  draft: Draft; estimate: { lines: { label: string; monthly: number }[]; total: number; note: string }; missing: string[];
  run: Run | null; removeRun: { id: string; status: string; started_at: string; ended_at: string | null; error: string | null } | null; steps: string[];
}
interface Meta { regions: { id: string; label: string }[]; sizes: { id: Size; vcpu: number; gb: number; fits: string; monthly: number }[] }
interface Review extends Full { resources: { label: string; value: string }[]; terraform: string; lines: number; blockers: string[]; image: { ref: string; ok: boolean; reason: string | null } }

const STEPS = [['Choose a cloud', 'Where it runs'], ['Connect', 'Sign in and check permissions'], ['Configure', 'Size, storage and address'], ['Your data', 'Start empty or bring data'], ['Review', 'What gets made, and the cost'], ['Deploy', 'Runs on this server'], ['Done', 'Where it lives']] as const;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server.');
const money = (n: number) => `$${n.toFixed(2)}`;
const dur = (ms: number | null) => (ms == null ? '' : ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`);
const running = (r: Run | null) => !!r && ['running', 'pending', 'queued', 'paused'].includes(r.status);
const STEP_NOTE: Record<string, (d: Draft) => string> = {
  'Check the tools': () => 'AWS CLI, Terraform, Docker and the sign-in',
  'Create container registry': (d) => `ECR · ${d.config.name}`,
  'Push image': () => 'The published image, copied into the registry',
  'Create volume': () => 'EFS · encrypted · 2 mount targets',
  'Create service': () => 'Load balancer, task and service',
  'Wait for health check': () => 'The container must answer 3 times in a row',
  'Move data': (d) => (d.data.mode === 'move' ? 'Everything here, sealed for the new instance' : d.data.mode === 'bundle' ? `${d.data.bundleFile}, and you as admin` : 'You, as its admin'),
  'Point DNS': (d) => (d.config.address === 'domain' ? `${d.config.domain} → load balancer, then the certificate` : "The load balancer's own address"),
};

/* ---------------------------------------------------------------- page */

export default function SelfHostPage() {
  return <LiveProvider><Wizard /></LiveProvider>;
}

function Wizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const [full, setFull] = useState<Full | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [step, setStep] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  // No id: open the draft not deployed yet, or start one.
  useEffect(() => {
    let live = true;
    api<Meta & { deploys: Draft[] }>('/selfhost').then(async (m) => {
      if (!live) return;
      setMeta(m);
      if (id) return;
      const open = m.deploys.find((d) => !d.deploy);
      const target = open?.id ?? (await api<Full>('/selfhost', { method: 'POST' })).draft.id;
      if (live) nav(`/selfhost/${target}`, { replace: true });
    }).catch((e) => live && setErr(errText(e)));
    return () => { live = false; };
  }, [id, nav]);

  const load = useCallback(async (first = false) => {
    if (!id) return;
    try {
      const f = await api<Full>(`/selfhost/${id}`);
      setFull(f);
      if (first) setStep(f.draft.deploy?.finished ? 7 : f.draft.deploy ? (f.run?.status === 'success' && f.draft.deploy.moved ? 7 : 6) : Math.min(5, f.draft.step));
    } catch (e) { setErr(errText(e)); }
  }, [id]);
  useEffect(() => { void load(true); }, [load]);

  // While the deploy runs, its steps are read every few seconds.
  const live = running(full?.run ?? null);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [live, load]);

  const save = async (patch: Record<string, unknown>) => {
    const f = await api<Full>(`/selfhost/${id}`, { method: 'PUT', body: patch });
    setFull(f);
    return f;
  };
  const go = (n: number) => { setStep(n); setErr(null); document.getElementById('main')?.scrollTo(0, 0); };

  if (err && !full) return <div className="grid h-dvh place-items-center bg-bg p-6"><Banner tone="fail" title="The wizard could not open">{err} <Link className="underline" to="/settings/self-hosting">Back to Settings</Link></Banner></div>;
  if (!full || !meta) return <BootSplash label="Opening the wizard…" />;

  const d = full.draft;
  const size = meta.sizes.find((s) => s.id === d.config.size);
  const summaries = [
    d.step > 1 ? 'AWS · Fargate + EFS' : null,
    d.connect.identity ? `${d.connect.identity.name} · ${d.connect.identity.account}` : null,
    d.step > 3 && size ? `${size.vcpu} vCPU · ${size.gb} GB · ${d.config.region}` : null,
    d.step > 4 ? (d.data.mode === 'move' ? 'Move this instance' : d.data.mode === 'bundle' ? 'From a bundle' : 'Start fresh') : null,
    d.step > 5 ? `≈ $${Math.round(full.estimate.total)}/month estimate` : null,
    full.run ? (live ? `${full.run.steps.find((s) => s.status === 'running')?.name ?? 'Starting'}` : full.run.status === 'success' ? 'Deployed' : full.run.status === 'aborted' ? 'Cancelled' : 'Stopped') : null,
    null,
  ];
  const at = d.deploy ? 7 : Math.max(d.step, step);

  let body: ReactNode;
  if (step === 1) body = <Choose onNext={() => void save({ step: 2 }).then(() => go(2))} onCancel={() => nav('/settings/self-hosting')} />;
  else if (step === 2) body = <Connect full={full} setFull={setFull} save={save} onBack={() => go(1)} onNext={() => void save({ step: 3 }).then(() => go(3))} />;
  else if (step === 3) body = <Configure full={full} meta={meta} save={save} onBack={() => go(2)} onNext={() => go(4)} />;
  else if (step === 4) body = <YourData full={full} setFull={setFull} save={save} onBack={() => go(3)} onNext={() => go(5)} />;
  else if (step === 5) body = <ReviewStep id={d.id} onEdit={go} onBack={() => go(4)} onDeployed={(f) => { setFull(f); go(6); }} />;
  else if (step === 6) body = <Deploying full={full} reload={load} onEdit={go} onDone={() => go(7)} />;
  else body = <Done full={full} setFull={setFull} />;

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
        <LogoMark size={26} />
        <span className="hidden text-[15px] font-semibold sm:inline">EZPipeline</span>
        <span className="hidden h-5 w-px bg-line-2 sm:block" />
        <span className="min-w-0 truncate text-[14px] font-medium">Deploy EZPipeline to your cloud</span>
        <span className="flex-1" />
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-info-line bg-info-soft px-2.5 py-0.5 text-[12px] text-info"><span className="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />Deploying</span>
        ) : !d.deploy && <span className="hidden text-[12.5px] text-fg-3 md:inline">Draft · nothing is created until you press Deploy</span>}
        <Link to="/settings/self-hosting" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-fg-2 hover:text-fg"><X className="size-4" />{live ? <span className="hidden sm:inline">Close, it keeps going</span> : 'Exit'}</Link>
      </header>
      <div className="flex min-h-0 flex-1">
        <Rail step={step} at={at} summaries={summaries} onPick={go} deployed={!!d.deploy} live={live} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-line px-4 py-3 lg:hidden">
            <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-3">Step {step} of 7 · {STEPS[step - 1][0]}</div>
            <div className="mt-2 flex gap-1">{STEPS.map((_, i) => <span key={i} className={cx('h-1 flex-1 rounded-full', i < step ? 'bg-primary' : 'bg-line-2')} />)}</div>
          </div>
          {err && <div className="px-4 pt-4 sm:px-8"><Banner tone="fail">{err}</Banner></div>}
          {body}
        </div>
      </div>
    </div>
  );
}

function Rail({ step, at, summaries, onPick, deployed, live }: { step: number; at: number; summaries: (string | null)[]; onPick: (n: number) => void; deployed: boolean; live: boolean }) {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-r border-line px-6 py-7 lg:flex">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">7 steps · about 15 minutes</div>
      <ol className="mt-5 flex flex-col">
        {STEPS.map(([name, sub], i) => {
          const n = i + 1;
          const done = n < step || (n < at && n !== 6) || (deployed && n < 6);
          const here = n === step;
          const reachable = deployed ? n >= 6 && n <= at : n <= at && n <= 5;
          return (
            <li key={name} className="relative flex gap-3 pb-[22px] last:pb-0">
              {n < 7 && <span aria-hidden className={cx('absolute left-[12px] top-[28px] h-[calc(100%-28px)] w-px', done ? 'bg-primary/60' : 'bg-line-2')} />}
              <span className={cx('grid size-[25px] shrink-0 place-items-center rounded-full border text-[12px] font-medium',
                done && !here ? 'border-primary bg-primary text-primary-ink' : here ? (n === 6 && live ? 'border-info text-info' : 'border-fg-2 text-fg') : 'border-line-3 text-fg-3')}>
                {done && !here ? <Check className="size-3.5" strokeWidth={3} /> : n}
              </span>
              <button type="button" disabled={!reachable || here} onClick={() => onPick(n)} className="min-w-0 text-left disabled:cursor-default">
                <div className={cx('text-[14px] font-medium', here || done ? 'text-fg' : 'text-fg-2')}>{name}</div>
                <div className={cx('truncate text-[12.5px]', here && n === 6 && live ? 'text-info' : 'text-fg-3')}>{summaries[i] ?? sub}</div>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto rounded-card border border-line bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
        {live ? <><b className="block text-[13px] text-fg">Safe to close</b>The deploy runs on this instance's server, not in your browser.</>
          : step === 1 ? <><b className="block text-[13px] text-fg">Kept as a draft</b>Leave at any step and come back; your answers stay until you deploy or discard them.</>
            : <><b className="block text-[13px] text-fg">Single node</b>One container and one persistent volume. Your cloud bills you directly.</>}
      </div>
    </aside>
  );
}

function StepPage({ step, kicker, title, lede, children, footer, wide }: { step: number; kicker?: string; title: ReactNode; lede?: ReactNode; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  return (
    <>
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx('mx-auto w-full px-4 py-7 sm:px-8 lg:py-10', wide ? 'max-w-[1080px]' : 'max-w-[860px]')}>
          <div className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3 lg:block">Step {step} of 7{kicker ? ` · ${kicker}` : ''}</div>
          <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">{title}</h1>
          {lede && <div className="mt-2 max-w-[720px] text-[14px] leading-relaxed text-fg-2">{lede}</div>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
      <footer className="border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
        <div className={cx('mx-auto flex w-full flex-wrap items-center gap-3 px-4 py-3.5 sm:px-8', wide ? 'max-w-[1080px]' : 'max-w-[860px]')}>{footer}</div>
      </footer>
    </>
  );
}
const Back = ({ onClick }: { onClick: () => void }) => <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onClick}>Back</Button>;
const Hint = ({ children }: { children: ReactNode }) => <span className="ml-auto hidden text-[12.5px] text-fg-3 sm:inline">{children}</span>;
const NextBtn = ({ children, ...p }: { children: ReactNode; onClick: () => void; loading?: boolean; disabled?: boolean }) => <Button variant="primary" iconRight={<ArrowRight className="size-4" />} {...p}>{children}</Button>;

function Pick({ on, onPick, disabled, children, className }: { on: boolean; onPick: () => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <div role="radio" aria-checked={on} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && !on && onPick()} onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onPick(); } }}
      className={cx('relative rounded-card border p-4 transition-colors', disabled ? 'cursor-default border-line opacity-70' : 'cursor-pointer', on ? 'border-primary bg-primary-soft/30' : !disabled && 'border-line-2 hover:border-line-3', className)}>
      <span aria-hidden className={cx('absolute right-4 top-4 grid size-[18px] place-items-center rounded-full border', on ? 'border-primary bg-primary' : 'border-line-3')}>{on && <span className="size-1.5 rounded-full bg-primary-ink" />}</span>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- 1 · choose */

interface Plugin { id: string; isInstalled: boolean; version?: string }
function Choose({ onNext, onCancel }: { onNext: () => void; onCancel: () => void }) {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  useEffect(() => { api<{ plugins: Plugin[] }>('/plugins').then((r) => setPlugins(r.plugins)).catch(() => setPlugins([])); }, []);
  const p = (id: string) => plugins?.find((x) => x.id === id);
  const tool = (id: string, name: string) => {
    const x = p(id);
    if (!plugins) return null;
    return x?.isInstalled
      ? <span className="inline-flex items-center gap-1 rounded-full border border-primary-line px-2 py-0.5 text-[11.5px] text-primary-hi"><Check className="size-3" />{name}{x.version ? ` ${x.version}` : ''}</span>
      : <Link to="/settings/plugins" className="inline-flex items-center gap-1 rounded-full border border-warn-line bg-warn-soft px-2 py-0.5 text-[11.5px] text-warn">{name} not installed · install</Link>;
  };
  const cloud = (tag: string, name: string, stack: string, points: string[], foot: ReactNode, on: boolean, soon?: boolean) => (
    <Pick on={on} onPick={() => {}} disabled={soon}>
      <span className={cx('inline-grid h-9 min-w-9 place-items-center rounded-box border border-line-2 px-2 font-mono text-[12px] font-semibold', tag === 'AWS' ? 'text-warn' : tag === 'Azure' ? 'text-info' : 'text-primary-hi')}>{tag}</span>
      <div className="mt-4 text-[16px] font-semibold">{name}</div>
      <div className="font-mono text-[12px] text-fg-3">{stack}</div>
      <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-[13px] text-fg-2">{points.map((x) => <li key={x}>· {x}</li>)}</ul>
      <div className="mt-4 flex flex-wrap gap-1.5">{foot}</div>
    </Pick>
  );
  return (
    <StepPage step={1} title="Where should EZPipeline run?" wide
      lede="Pick a cloud you already have an account with. Everything is created in that account, under your name, where you can see and remove it."
      footer={<><Button variant="ghost" onClick={onCancel}>Cancel</Button><Hint>Next: sign in to AWS</Hint><NextBtn onClick={onNext}>Continue with AWS</NextBtn></>}>
      <div className="grid gap-4 md:grid-cols-3" role="radiogroup" aria-label="Cloud">
        {cloud('AWS', 'Amazon Web Services', 'ECS Fargate + EFS', ['1 Fargate task, always on', 'EFS volume, encrypted at rest', 'HTTPS with an ACM certificate', 'Built with Terraform'],
          <>{tool('aws-cli', 'AWS CLI plugin')}{tool('terraform', 'Terraform')}{tool('docker', 'Docker')}</>, true)}
        {cloud('Azure', 'Microsoft Azure', 'Container Apps + Azure Files', ['1 replica, minimum and maximum', 'Azure Files share over NFS', 'Managed HTTPS certificate', 'Built with Bicep'],
          <span className="text-[12px] text-fg-3">Comes after AWS, in the same wizard.</span>, false, true)}
        {cloud('GCP', 'Google Cloud', 'Cloud Run + mounted volume', ['1 instance, max instances 1', 'Filestore volume over NFS', 'Managed HTTPS certificate', 'Built with Terraform'],
          <span className="text-[12px] text-fg-3">Comes after Azure, in the same wizard.</span>, false, true)}
      </div>
      <Card className="mt-5">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="inline-flex items-center gap-1.5 rounded-box border border-line-2 px-3 py-1.5"><Globe className="size-4 text-fg-3" />Your domain <span className="font-mono text-[11px] text-fg-3">HTTPS</span></span>
          <span className="h-px w-5 bg-line-3" />
          <span className="rounded-box border border-line-2 px-3 py-1.5">Load balancer</span>
          <span className="h-px w-5 bg-line-3" />
          <span className="inline-flex items-center gap-1.5 rounded-box border border-primary-line px-3 py-1.5"><Box className="size-4 text-primary-hi" />1 container</span>
          <span className="h-px w-5 bg-line-3" />
          <span className="inline-flex items-center gap-1.5 rounded-box border border-primary-line px-3 py-1.5"><Database className="size-4 text-primary-hi" />1 persistent volume <span className="font-mono text-[11px] text-fg-3">SQLite + data directory</span></span>
        </div>
        <p className="mt-3 text-[13px] text-fg-2"><b className="text-fg">EZPipeline is single-node: one container and one persistent volume. Your cloud bills you directly.</b> Pipeline steps run inside that container, so it never scales out: two copies on one SQLite database would corrupt it.</p>
      </Card>
    </StepPage>
  );
}

/* ---------------------------------------------------------------- 2 · connect */

function Connect({ full, setFull, save, onBack, onNext }: { full: Full; setFull: (f: Full) => void; save: (p: Record<string, unknown>) => Promise<Full>; onBack: () => void; onNext: () => void }) {
  const d = full.draft;
  const toast = useToast();
  const [profiles, setProfiles] = useState<{ profiles: string[]; cli: boolean } | null>(null);
  const [profile, setProfile] = useState(d.connect.profile);
  const [keyId, setKeyId] = useState(d.connect.accessKeyId);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  useEffect(() => { api<{ profiles: string[]; cli: boolean }>(`/selfhost/${d.id}/profiles`).then(setProfiles).catch(() => setProfiles({ profiles: [], cli: true })); }, [d.id]);

  const check = async (patch?: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      if (patch) await save(patch);
      const r = await api<Full & { expires: string | null }>(`/selfhost/${d.id}/check`, { method: 'POST' });
      setFull(r); setExpires(r.expires); setSecret('');
    } catch (e) { setErr(errText(e)); const f = await api<Full>(`/selfhost/${d.id}`).catch(() => null); if (f) setFull(f); }
    finally { setBusy(false); }
  };
  const c = d.connect.checked;
  const needed = c?.groups.filter((g) => g.needed) ?? [];
  const denied = needed.filter((g) => g.denied.length);
  const ok = !!d.connect.identity && !denied.length;
  // The same statement the server would write: exactly the denied actions.
  const statement = denied.length ? JSON.stringify({ Effect: 'Allow', Action: [...new Set(denied.flatMap((g) => g.denied))].sort(), Resource: '*' }, null, 2) : null;
  const hours = expires ? Math.round((Date.parse(expires) - Date.now()) / 3_600_000) : null;

  return (
    <StepPage step={2} kicker="AWS" title="Connect your AWS account" wide lede="EZPipeline uses this only to create, update and remove what you approve on Review."
      footer={<><Back onClick={onBack} /><Hint>{!d.connect.identity ? 'Sign in, then check' : denied.length ? `Add ${denied.length} permission${denied.length === 1 ? '' : 's'}, then Check again` : 'Next: size, storage and address'}</Hint><NextBtn disabled={!ok} onClick={onNext}>Continue</NextBtn></>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-4" role="radiogroup" aria-label="How to sign in">
          <Pick on={d.connect.mode === 'profile'} onPick={() => void save({ connect: { mode: 'profile' } })}>
            <div className="pr-8 text-[14.5px] font-medium">Use the AWS CLI sign-in {d.connect.mode === 'profile' && d.connect.identity && <span className="ml-1 rounded-full border border-primary-line px-2 py-0.5 text-[11.5px] text-primary-hi">Signed in</span>}</div>
            <p className="mt-1 text-[13px] text-fg-2">Recommended. From the AWS CLI on this instance, so no key is copied or stored.</p>
            {d.connect.mode === 'profile' && (
              <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                {profiles && !profiles.cli ? <Banner tone="warn">The AWS CLI is not installed here. Install the AWS CLI plugin in <Link className="underline" to="/settings/plugins">Settings, Plugins</Link>, or paste an access key.</Banner> : (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Profile" className="min-w-[180px] flex-1">
                      {profiles?.profiles.length ? (
                        <Select value={profile} onChange={(e) => setProfile(e.target.value)}>{[...new Set([profile, ...profiles.profiles])].map((p) => <option key={p}>{p}</option>)}</Select>
                      ) : <Input mono value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="default" />}
                    </Field>
                    <Button loading={busy} onClick={() => void check({ connect: { mode: 'profile', profile } })}>{d.connect.identity ? 'Check again' : 'Sign in and check'}</Button>
                  </div>
                )}
                {d.connect.identity && d.connect.mode === 'profile' && <Who d={d} hours={hours} />}
              </div>
            )}
          </Pick>
          <Pick on={d.connect.mode === 'keys'} onPick={() => void save({ connect: { mode: 'keys' } })}>
            <div className="pr-8 text-[14.5px] font-medium">Paste an access key</div>
            <p className="mt-1 text-[13px] text-fg-2">Stored encrypted here, and given to the deploy as secret variables. Delete it after the deploy, or keep it so updates work.</p>
            {d.connect.mode === 'keys' && (
              <form className="mt-4 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void check({ connect: { mode: 'keys', accessKeyId: keyId, ...(secret ? { secretAccessKey: secret } : {}) } }); }}>
                <Input mono aria-label="Access key ID" placeholder="AKIA…" value={keyId} onChange={(e) => setKeyId(e.target.value.trim())} autoComplete="off" />
                <Input mono type="password" aria-label="Secret access key" placeholder={d.connect.hasSecret ? 'Saved · paste to replace' : 'Secret access key'} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
                <div><Button type="submit" loading={busy} disabled={!keyId || (!secret && !d.connect.hasSecret)}>{d.connect.identity ? 'Check again' : 'Sign in and check'}</Button></div>
                {d.connect.identity && <Who d={d} hours={null} />}
              </form>
            )}
          </Pick>
          {err && <Banner tone="fail">{err}</Banner>}
        </div>

        <Card pad={false} className="h-fit min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1"><div className="text-[14.5px] font-semibold">Permission check</div><div className="truncate text-[12.5px] text-fg-3">{d.connect.identity ? `What ${d.connect.identity.name} may do in ${d.connect.identity.account}` : 'Sign in first'}</div></div>
            {c && !c.error && <span className={cx('rounded-full border px-2 py-0.5 text-[12px]', denied.length ? 'border-warn-line bg-warn-soft text-warn' : 'border-primary-line text-primary-hi')}>{needed.length - denied.length} of {needed.length} allowed</span>}
            {d.connect.identity && <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={() => void check()}>Check again</Button>}
          </div>
          {c?.note && <div className="border-b border-line px-4 py-3 text-[13px] text-fg-2"><Info className="mr-1.5 inline size-4 text-info" />{c.note}</div>}
          {c?.error && <div className="border-b border-line px-4 py-3"><Banner tone="warn">{c.error}</Banner></div>}
          <ul>
            {(c?.groups ?? []).filter((g) => g.needed).map((g) => (
              <li key={g.id} className={cx('border-b border-line last:border-0', g.denied.length && 'bg-fail-soft/40')}>
                <div className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
                  {!c || c.error ? <span className="size-4 rounded-full border border-line-3" /> : g.denied.length ? <X className="size-4 text-fail" /> : <Check className="size-4 text-primary-hi" />}
                  <span className={cx('flex-1', g.denied.length && 'text-fail')}>{g.label}</span>
                  <span className="hidden font-mono text-[11.5px] text-fg-3 sm:inline">{g.denied[0] ?? g.actions[0]}{g.denied.length > 1 ? ` +${g.denied.length - 1}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
          {!c && <p className="px-4 py-6 text-[13px] text-fg-3">Once signed in, IAM's policy simulator is asked about every call the deploy makes. Nothing is created.</p>}
          {statement && denied.length > 0 && d.connect.identity && (
            <div className="border-t border-line px-4 py-4">
              <p className="text-[13px] text-fg-2">Add this statement to the policy on <span className="font-mono text-fg">{d.connect.identity.name}</span>, then Check again.</p>
              <pre className="mt-3 max-h-[260px] overflow-auto rounded-box border border-line bg-bg-2 p-3 font-mono text-[12px] leading-relaxed">{statement}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(statement); toast.success('Statement copied'); }}>Copy statement</Button>
                <a className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-fg-2 hover:text-fg" href="https://console.aws.amazon.com/iam/home#/policies" target="_blank" rel="noreferrer">Open IAM in AWS<ExternalLink className="size-3.5" /></a>
              </div>
            </div>
          )}
        </Card>
      </div>
    </StepPage>
  );
}

function Who({ d, hours }: { d: Draft; hours: number | null }) {
  const id = d.connect.identity!;
  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 rounded-box border border-line bg-bg-2 px-3 py-2.5">
        <span className="grid size-8 place-items-center rounded-md border border-line-2 font-mono text-[11px] font-semibold text-warn">AWS</span>
        <div className="min-w-0"><div className="text-[14px] font-medium">{id.name}</div><div className="truncate font-mono text-[11.5px] text-fg-3">{id.arn}</div></div>
      </div>
      <dl className="mt-3 grid grid-cols-[90px_1fr] gap-y-1 text-[13px]">
        <dt className="text-fg-3">Account</dt><dd className="font-mono">{id.account}</dd>
        {d.connect.mode === 'profile' && <><dt className="text-fg-3">Profile</dt><dd className="font-mono">{d.connect.profile}</dd></>}
        {hours !== null && <><dt className="text-fg-3">Session</dt><dd>{hours > 0 ? `Expires in ${hours} h` : 'Expires within the hour'}</dd></>}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------------- 3 · configure */

function Configure({ full, meta, save, onBack, onNext }: { full: Full; meta: Meta; save: (p: Record<string, unknown>) => Promise<Full>; onBack: () => void; onNext: () => void }) {
  const d = full.draft;
  const [c, setC] = useState(d.config);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fixed = !!d.deploy;
  const next = async () => {
    setBusy(true); setErr(null);
    try { await save({ config: c, step: 4 }); onNext(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <StepPage step={3} kicker="AWS" title="Configure the new instance" lede={fixed ? 'Size, storage and address change on the next deploy. Name and region are fixed now it is deployed.' : 'Size and storage can change later in Self-hosting. Name and region are fixed once it is deployed.'}
      footer={<><Back onClick={onBack} /><Hint>Next: what the new instance starts with</Hint><NextBtn loading={busy} onClick={() => void next()}>Continue</NextBtn></>}>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint={`Prefix for every resource: ${c.name}-svc, ${c.name}-data`}><Input mono disabled={fixed} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value.toLowerCase() })} /></Field>
        <Field label="Region" hint="Everything goes in this one region">
          <Select disabled={fixed} value={c.region} onChange={(e) => setC({ ...c, region: e.target.value })}>{meta.regions.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.label}</option>)}</Select>
        </Field>
        <Field label="Admin email" hint="Where certificate notices go, and the admin's email when it starts fresh" className="sm:col-span-2"><Input type="email" value={c.adminEmail} onChange={(e) => setC({ ...c, adminEmail: e.target.value })} /></Field>
      </div>

      <h2 className="mt-7 text-[15px] font-semibold">Size</h2>
      <p className="text-[13px] text-fg-3">Pipeline steps run inside this container, so size it for your biggest build. Prices are Fargate only.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Size">
        {meta.sizes.map((s) => (
          <Pick key={s.id} on={c.size === s.id} onPick={() => setC({ ...c, size: s.id })}>
            <div className="pr-6 text-[14px] font-medium">{s.vcpu} vCPU · {s.gb} GB</div>
            <div className="text-[12.5px] text-fg-3">{s.fits}</div>
            <div className="mt-2 font-mono text-[13px]">{money(s.monthly)}<span className="text-fg-3">/mo</span></div>
          </Pick>
        ))}
      </div>

      <h2 className="mt-7 text-[15px] font-semibold">Storage</h2>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2"><span className="w-[96px]"><Input aria-label="Storage in GB" type="number" min={1} max={2000} value={String(c.storageGb)} onChange={(e) => setC({ ...c, storageGb: Number(e.target.value) || 0 })} /></span><span className="text-[13px] text-fg-2">GB</span></span>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-2"><Lock className="size-3.5" />Encrypted at rest</span>
      </div>
      <p className="mt-2 text-[12.5px] text-fg-3">EFS grows by itself and bills only what is stored. The estimate assumes {c.storageGb} GB.</p>

      <h2 className="mt-7 text-[15px] font-semibold">Public address</h2>
      <div className="mt-3 flex flex-col gap-3" role="radiogroup" aria-label="Public address">
        <Pick on={c.address === 'lb'} onPick={() => setC({ ...c, address: 'lb' })}>
          <div className="pr-8 text-[14px] font-medium">The load balancer's own address</div>
          <div className="font-mono text-[12px] text-fg-3">{c.name}-….elb.{c.region}.amazonaws.com</div>
          {c.address === 'lb' && <p className="mt-2 flex gap-1.5 text-[12.5px] text-warn"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />No certificate can be issued for it, so it answers over plain HTTP: passwords cross the internet unencrypted. Fine to try it out; add a domain before your team signs in.</p>}
        </Pick>
        <Pick on={c.address === 'domain'} onPick={() => setC({ ...c, address: 'domain' })}>
          <div className="pr-8 text-[14px] font-medium">Custom domain <span className="ml-1 rounded-full border border-primary-line px-2 py-0.5 text-[11.5px] text-primary-hi">HTTPS</span></div>
          <div className="text-[12.5px] text-fg-3">Certificate from AWS Certificate Manager, checked with one DNS record</div>
          {c.address === 'domain' && <div className="mt-3 max-w-[380px]" onClick={(e) => e.stopPropagation()}><Input mono aria-label="Domain" placeholder="ci.example.com" value={c.domain} onChange={(e) => setC({ ...c, domain: e.target.value })} /></div>}
        </Pick>
      </div>
      <div className="mt-4 rounded-card border border-line p-4">
        <Switch checked={c.staticIp} onChange={(v) => setC({ ...c, staticIp: v })} label="Static IP addresses"
          description="2 Elastic IPs, one per zone, for firewalls that allow by IP, or a zone apex A record. AWS allows 5 per region unless you ask for more. Costs the same: AWS bills every public IPv4 address." />
      </div>
    </StepPage>
  );
}

/* ---------------------------------------------------------------- 4 · your data */

function YourData({ full, setFull, save, onBack, onNext }: { full: Full; setFull: (f: Full) => void; save: (p: Record<string, unknown>) => Promise<Full>; onBack: () => void; onNext: () => void }) {
  const d = full.draft;
  const [a, setA] = useState({ mode: d.data.mode, history: d.data.history, pauseHere: d.data.pauseHere });
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bundle, setBundle] = useState<{ name: string; bytes: number; counts: Record<string, number>; sealed: boolean } | null>(null);
  const [here, setHere] = useState<{ pipelines: number; groups: number; variables: number; credentials: number; runs: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { api<{ counts: Record<string, number> }>('/export/preview?type=instance').then((r) => setHere(r.counts as never)).catch(() => {}); }, []);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API_URL}/api/selfhost/${d.id}/bundle`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': f.name, authorization: `Bearer ${localStorage.getItem('token') ?? ''}` }, body: f });
      const j = await res.json();
      if (!res.ok) throw new ApiError(res.status, j.message ?? j.error);
      setFull(j); setBundle(j.bundle); setA({ ...a, mode: 'bundle' });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const next = async () => {
    setBusy(true); setErr(null);
    try { await save({ data: { ...a, ...(pass ? { bundlePass: pass } : {}) }, step: 5 }); onNext(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const email = d.config.adminEmail || 'your email';
  return (
    <StepPage step={4} title="What should the new instance start with?" lede="Data goes across as one sealed .ezp bundle, the same format as Export, once the new instance passes its health check."
      footer={<><Back onClick={onBack} /><Hint>Moves after the health check on step 6</Hint><NextBtn loading={busy} disabled={a.mode === 'bundle' && !d.data.bundleFile} onClick={() => void next()}>Continue</NextBtn></>}>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Start with">
        <Pick on={a.mode === 'fresh'} onPick={() => setA({ ...a, mode: 'fresh' })}>
          <div className="pr-8 text-[14px] font-medium">Start fresh</div>
          <div className="text-[12.5px] text-fg-3">An empty instance with one admin: you, {d.by.username} ({email}), signing in with the password you use here.</div>
        </Pick>
        <Pick on={a.mode === 'move'} onPick={() => setA({ ...a, mode: 'move' })}>
          <div className="pr-8 text-[14px] font-medium">Move this instance <span className="ml-1 rounded-full border border-primary-line px-2 py-0.5 text-[11.5px] text-primary-hi">Recommended</span></div>
          <div className="text-[12.5px] text-fg-3">Everything here goes across. Pick this when the cloud one replaces this one.</div>
        </Pick>
        <Pick on={a.mode === 'bundle'} onPick={() => setA({ ...a, mode: 'bundle' })}>
          <div className="pr-8 text-[14px] font-medium">Import a bundle</div>
          <div className="text-[12.5px] text-fg-3">Start from a .ezp file you exported before, with you as its admin.</div>
          {a.mode === 'bundle' && (
            <div className="mt-3 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" icon={<Upload className="size-3.5" />} loading={busy} onClick={() => file.current?.click()}>{d.data.bundleFile ? 'Choose another file…' : 'Choose a file…'}</Button>
                {d.data.bundleFile && <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]"><FileArchive className="size-4 text-primary-hi" />{d.data.bundleFile}{bundle ? ` · ${bytes(bundle.bytes)}` : ''}</span>}
                <input ref={file} type="file" accept=".ezp,application/zip" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
              </div>
              {(bundle?.sealed || d.data.hasPass) && <Field label="The bundle's passphrase" hint="Without it, variables arrive empty and deploy keys stay behind."><Input type="password" value={pass} placeholder={d.data.hasPass ? 'Saved · type to replace' : ''} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></Field>}
            </div>
          )}
        </Pick>
      </div>

      {a.mode === 'move' && (
        <Card className="mt-5">
          <h2 className="text-[14.5px] font-semibold">Moving from this instance</h2>
          {here && <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">{([['groups', here.groups], ['pipelines', here.pipelines], ['variables', here.variables], ['credentials', here.credentials], ['runs with commits', here.runs]] as const).map(([l, n]) => <div key={l}><div className="text-[20px] font-semibold">{n ?? 0}</div><div className="text-[12px] text-fg-3">{l}</div></div>)}</div>}
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">Run history</div><div className="text-[12.5px] text-fg-3">Each run keeps its commit: sha, subject and author. Logs stay here.</div></div>
            <Segmented size="sm" label="Run history" value={a.history} onChange={(v) => setA({ ...a, history: v })} items={[{ id: 'last50', label: 'Last 50' }, { id: 'all', label: 'All' }, { id: 'none', label: 'None' }]} />
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <Switch checked={a.pauseHere} onChange={(v) => setA({ ...a, pauseHere: v })} label="Pause schedules and auto deploy here once the new one has the data" description="So nothing deploys twice. You choose what happens to this instance on the last step." />
          </div>
          <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-[12.5px] text-fg-2">
            <li className="flex gap-2"><Lock className="mt-0.5 size-3.5 shrink-0 text-fg-3" />Secrets and credentials are sealed with a one-time passphrase, inside a hand-over only the new instance can open.</li>
            <li className="flex gap-2"><Server className="mt-0.5 size-3.5 shrink-0 text-fg-3" />Users and their permissions move too, so everyone signs in as they do here.</li>
            <li className="flex gap-2"><Box className="mt-0.5 size-3.5 shrink-0 text-fg-3" />Plugins are installed there, not copied: install them from Settings, Plugins on the new instance.</li>
          </ul>
        </Card>
      )}
    </StepPage>
  );
}

/* ---------------------------------------------------------------- 5 · review */

function ReviewStep({ id, onEdit, onBack, onDeployed }: { id: string; onEdit: (n: number) => void; onBack: () => void; onDeployed: (f: Full) => void }) {
  const toast = useToast();
  const [r, setR] = useState<Review | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTf, setShowTf] = useState(false);
  useEffect(() => { api<Review>(`/selfhost/${id}/review`).then(setR).catch((e) => setErr(errText(e))); }, [id]);
  const deploy = async () => {
    setBusy(true); setErr(null);
    try { onDeployed(await api<Full>(`/selfhost/${id}/deploy`, { method: 'POST', body: {} })); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  if (!r) return <StepPage step={5} title="Review, then deploy" footer={<Back onClick={onBack} />}>{err ? <Banner tone="fail">{err}</Banner> : <div className="flex items-center gap-2 text-[13px] text-fg-3"><Spinner size={14} />Checking the region…</div>}</StepPage>;
  const d = r.draft;
  const blocked = r.missing.length > 0 || r.blockers.length > 0;
  const address = d.config.address === 'domain' ? `https://${d.config.domain}` : `http://${d.config.name}-….elb.${d.config.region}.amazonaws.com`;
  return (
    <StepPage step={5} title="Review, then deploy" wide
      lede="Nothing exists yet. Deploy runs this Terraform with the AWS CLI on this instance and keeps its state file in the data directory."
      footer={<><Back onClick={onBack} /><Hint>Takes about 10 minutes and runs on the server, so you can close this page</Hint><Button variant="primary" loading={busy} disabled={blocked} onClick={() => void deploy()}>Deploy to AWS</Button></>}>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      {(r.missing.length > 0 || r.blockers.length > 0) && (
        <Banner tone="warn" title="Before it can deploy" className="mb-4">
          <ul className="mt-1 flex flex-col gap-1">{[...r.missing, ...r.blockers].map((m) => <li key={m}>{m}</li>)}</ul>
        </Banner>
      )}
      {!r.image.ok && (
        <Banner tone="warn" title="The image cannot be pulled without a key" className="mb-4">
          {r.image.reason} The Push image step pulls <span className="font-mono">{r.image.ref}</span> from FileFreak's registry: it works once the image is public there, or if this host is signed in to it (<span className="font-mono">filefreak docker setup</span>).
        </Banner>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card pad={false}>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3"><h2 className="flex-1 text-[14.5px] font-semibold">{r.resources.length} things in {d.config.region}</h2><span className="font-mono text-[12px] text-fg-3">account {d.connect.identity?.account}</span></div>
            <div className="grid sm:grid-cols-2">{r.resources.map((x) => <div key={x.label} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] sm:odd:border-r"><span>{x.label}</span><span className="truncate font-mono text-[12px] text-fg-3">{x.value}</span></div>)}</div>
          </Card>
          <Card pad={false}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <button type="button" className="flex-1 text-left text-[14px] font-medium" onClick={() => setShowTf(!showTf)} aria-expanded={showTf}>{showTf ? 'Hide' : 'View'} the Terraform <span className="font-mono text-[12px] text-fg-3">main.tf · {r.lines} lines</span></button>
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(r.terraform); toast.success('Terraform copied'); }}>Copy</Button>
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => { const u = URL.createObjectURL(new Blob([r.terraform], { type: 'text/plain' })); const a = document.createElement('a'); a.href = u; a.download = 'main.tf'; a.click(); URL.revokeObjectURL(u); }}>Download</Button>
            </div>
            {showTf && <pre className="max-h-[420px] overflow-auto border-t border-line bg-bg-2 p-4 font-mono text-[12px] leading-relaxed">{r.terraform}</pre>}
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="text-[13px] text-fg-3">Monthly cost</div>
            <div className="mt-1 text-[28px] font-semibold">≈ ${Math.round(r.estimate.total)} <span className="text-[14px] font-normal text-fg-3">/ month</span></div>
            <p className="mt-1 text-[12px] text-fg-3">{r.estimate.note}</p>
            <ul className="mt-3 flex flex-col text-[13px]">
              {r.estimate.lines.map((l) => <li key={l.label} className="flex justify-between gap-3 border-t border-line py-1.5"><span className="text-fg-2">{l.label}</span><b className="font-mono font-medium">{money(l.monthly)}</b></li>)}
              <li className="flex justify-between gap-3 border-t border-line-2 pt-2 font-semibold"><span>Estimated total</span><span className="font-mono">{money(r.estimate.total)}</span></li>
            </ul>
          </Card>
          <Card>
            <dl className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 text-[13px]">
              <dt className="text-fg-3">Address</dt><dd className="truncate font-mono">{address}</dd><button type="button" className="text-[12px] text-fg-2 hover:text-fg" onClick={() => onEdit(3)}>Edit</button>
              <dt className="text-fg-3">Admin</dt><dd className="truncate">{d.config.adminEmail || d.by.username}</dd><button type="button" className="text-[12px] text-fg-2 hover:text-fg" onClick={() => onEdit(3)}>Edit</button>
              <dt className="text-fg-3">Storage</dt><dd>{d.config.storageGb} GB · encrypted</dd><button type="button" className="text-[12px] text-fg-2 hover:text-fg" onClick={() => onEdit(3)}>Edit</button>
              <dt className="text-fg-3">Data</dt><dd>{d.data.mode === 'move' ? 'Move this instance' : d.data.mode === 'bundle' ? d.data.bundleFile : 'Start fresh'}</dd><button type="button" className="text-[12px] text-fg-2 hover:text-fg" onClick={() => onEdit(4)}>Edit</button>
            </dl>
          </Card>
        </div>
      </div>
    </StepPage>
  );
}

/* ---------------------------------------------------------------- 6 · deploying */

function Deploying({ full, reload, onEdit, onDone }: { full: Full; reload: () => Promise<void>; onEdit: (n: number) => void; onDone: () => void }) {
  const d = full.draft;
  const run = full.run;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const live = running(run);
  useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  const { lines, error } = useRunLog(run?.id ?? '', !live);
  const failedAt = run?.steps.findIndex((s) => s.status === 'failed') ?? -1;
  const failed = !live && run && run.status !== 'success';
  const doneN = run?.steps.filter((s) => s.status === 'success' || s.status === 'skipped').length ?? 0;
  const elapsed = run ? (run.endedAt ? Date.parse(run.endedAt) : now) - Date.parse(run.startedAt) : 0;

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); await reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const retry = (fromStep?: string) => act(() => api(`/selfhost/${d.id}/deploy`, { method: 'POST', body: fromStep ? { fromStep } : {} }));
  const cancel = () => act(() => api(`/builds/${run!.id}/abort`, { method: 'POST' }));

  if (!run) return <StepPage step={6} title="Deploying to AWS" footer={<Link to="/settings/self-hosting" className="ml-auto">Back to Settings</Link>}><Banner tone="warn">This deploy has no run yet. <button className="underline" onClick={() => onEdit(5)}>Review it</button> and press Deploy.</Banner></StepPage>;
  const failStep = failedAt >= 0 ? run.steps[failedAt] : null;
  return (
    <StepPage step={6} wide
      kicker={failed ? `Stopped after ${dur(elapsed)}` : undefined}
      title={live ? 'Deploying to AWS' : run.status === 'success' ? 'Deployed to AWS' : run.status === 'aborted' ? 'The deploy was cancelled' : `${failStep?.name ?? 'The deploy'} failed`}
      lede={live ? <>Elapsed <b className="font-mono text-fg">{dur(elapsed)}</b> · usually 8 to 10 minutes, longer while a certificate waits for its DNS record</>
        : failed ? <>{failedAt > 0 ? `The first ${failedAt} steps are done and kept. ` : ''}Fix what the log says, then retry from this step; nothing before it runs again.</>
          : <>Finished in {dur(elapsed)}.</>}
      footer={live
        ? <><Button variant="danger" loading={busy} onClick={() => void cancel()}>Cancel deploy</Button><span className="hidden text-[12.5px] text-fg-3 sm:inline">Stops after the step running now. What exists stays until you remove it.</span><Link to="/settings/self-hosting" className="ml-auto"><Button>Back to Settings</Button></Link></>
        : failed
          ? <><Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => onEdit(3)}>Back to Configure</Button><Hint>{failStep ? `Retry starts at ${failStep.name}` : 'Runs every step again'}</Hint><Button variant="primary" loading={busy} onClick={() => void retry(failStep?.name)}>{failStep ? 'Retry from this step' : 'Deploy again'}</Button></>
          : <><span className="flex-1" /><NextBtn onClick={onDone}>Continue</NextBtn></>}>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      {failed && run.error && <Banner tone="fail" className="mb-4" title="What stopped it">{run.error}</Banner>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card pad={false} className="h-fit min-w-0 overflow-hidden">
          <div className="flex gap-1 px-4 pt-4">{run.steps.map((s) => <span key={s.name} className={cx('h-1 flex-1 rounded-full', s.status === 'success' || s.status === 'skipped' ? 'bg-primary' : s.status === 'running' ? 'bg-info' : s.status === 'failed' ? 'bg-fail' : 'bg-line-2')} />)}</div>
          <ol className="mt-3">
            {run.steps.map((s) => {
              const on = s.status === 'running';
              return (
                <li key={s.name} className={cx('flex items-center gap-3 border-t border-line px-4 py-3', on && 'bg-info-soft/40 shadow-[inset_2px_0_0_var(--info)]', s.status === 'failed' && 'bg-fail-soft/40 shadow-[inset_2px_0_0_var(--fail)]')}>
                  <span className="grid size-5 shrink-0 place-items-center">
                    {s.status === 'success' || s.status === 'skipped' ? <Check className="size-4 text-primary-hi" /> : on ? <Spinner size={16} className="text-info" /> : s.status === 'failed' ? <CircleAlert className="size-4 text-fail" /> : <span className="size-3.5 rounded-full border border-dashed border-line-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={cx('text-[13.5px] font-medium', s.status === 'pending' && 'text-fg-3')}>{s.name}</div>
                    <div className={cx('truncate text-[12px]', on ? 'text-info' : s.status === 'failed' ? 'text-fail' : 'text-fg-3')}>{s.status === 'failed' && s.failure?.meaning ? s.failure.meaning : (STEP_NOTE[s.name]?.(d) ?? '')}</div>
                  </div>
                  <span className="shrink-0 font-mono text-[12px] text-fg-3">{s.status === 'skipped' ? 'kept' : s.status === 'pending' ? (failed ? 'not started' : '') : on && s.startedAt ? dur(now - Date.parse(s.startedAt)) : dur(s.durationMs)}</span>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-line px-4 py-3 text-[12px] text-fg-3">{doneN} of {run.steps.length} done · run <Link className="underline-offset-2 hover:underline" to={`/runs/${run.id}`}>#{run.number}</Link> of {`Deploy ${d.config.name} to AWS`}</div>
        </Card>
        <div className="min-w-0">
          <LogView lines={lines} error={error} step={null} className="h-[520px]" fileName={`deploy-${d.config.name}-${run.number}.log`} />
        </div>
      </div>
      {failed && <RemoveCard full={full} reload={reload} />}
    </StepPage>
  );
}

function RemoveCard({ full, reload }: { full: Full; reload: () => Promise<void> }) {
  const d = full.draft;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rr = full.removeRun;
  const remove = async () => {
    setBusy(true); setErr(null);
    try { await api(`/selfhost/${d.id}/remove`, { method: 'POST', body: { confirm: name } }); await reload(); setOpen(false); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <Info className="size-4 shrink-0 text-fg-3" />
        <p className="min-w-0 flex-1 text-[13px] text-fg-2">What the finished steps made stays in your AWS account, and AWS bills it, until you retry or remove it.{rr ? ` Last removal: ${rr.status}.` : ''}</p>
        {!open && <Button size="sm" variant="danger" onClick={() => setOpen(true)}>Remove what was created</Button>}
      </div>
      {open && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void remove(); }}>
          <Field label={`Type ${d.config.name} to remove everything this deploy made, and the data on its volume`} className="min-w-[240px] flex-1"><Input mono value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button variant="ghost" onClick={() => setOpen(false)}>Keep it</Button>
          <Button type="submit" variant="danger-solid" loading={busy} disabled={name !== d.config.name}>Remove from AWS</Button>
          {err && <Banner tone="fail" className="w-full">{err}</Banner>}
        </form>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- 7 · done */

function Done({ full, setFull }: { full: Full; setFull: (f: Full) => void }) {
  const d = full.draft;
  const nav = useNavigate();
  const toast = useToast();
  const [choice, setChoice] = useState<'standby' | 'both'>((d.deploy?.finished?.choice as 'standby' | 'both') ?? 'standby');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const address = d.config.address === 'domain' ? `https://${d.config.domain}` : d.deploy?.lbDns ?? null;
  const m = d.deploy?.moved;
  const run = full.run;
  const took = run?.endedAt ? Date.parse(run.endedAt) - Date.parse(d.deploy!.startedAt) : null;
  const finish = async () => {
    setBusy(true); setErr(null);
    try { setFull(await api<Full>(`/selfhost/${d.id}/finish`, { method: 'POST', body: { choice } })); nav('/settings/self-hosting'); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <StepPage step={7} title="EZPipeline is running on AWS"
      lede={`Deployed${took ? ` in ${dur(took)}` : ''} · 1 task in ${d.config.region} · ≈ $${Math.round(full.estimate.total)}/month estimate, billed by AWS`}
      footer={<><Hint>You can change this later in Settings, Self-hosting</Hint><Button variant="primary" loading={busy} onClick={() => void finish()}>Save and finish</Button></>}>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-box border border-primary-line text-primary-hi"><Globe className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[15px]">{address ?? 'The load balancer address in the deploy log'}</div>
            <div className="text-[12.5px] text-primary-hi">Healthy</div>
          </div>
          {address && <><Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(address); toast.success('Address copied'); }}>Copy</Button>
            <a href={address} target="_blank" rel="noreferrer"><Button size="sm" variant="primary" iconRight={<ExternalLink className="size-3.5" />}>Open it</Button></a></>}
          {!address && run && <Link to={`/runs/${run.id}`}><Button size="sm">Open the log</Button></Link>}
        </div>
      </Card>
      {m && (
        <Card className="mt-4">
          <div className="text-[14.5px] font-semibold">{d.data.mode === 'move' ? `Moved: ${m.pipelines} pipelines, ${m.groups} groups` : d.data.mode === 'bundle' ? `Started from ${d.data.bundleFile}: ${m.pipelines} pipelines` : 'Started fresh'}</div>
          <p className="mt-1 text-[13px] text-fg-2">
            {d.data.mode === 'fresh' ? `You are its admin: sign in as ${d.by.username}, with the password you use here.`
              : `${m.variables} variables · ${m.credentials} credentials · ${m.runs} runs with their commits. ${m.users > 1 ? 'Users moved too, so sign in as you do here.' : `Sign in as ${d.by.username}, with the password you use here.`}`}
            {m.secrets === 'left-sealed' && ' The secrets stayed sealed: fill the variables in there.'}
          </p>
        </Card>
      )}
      {d.data.mode === 'move' && (
        <>
          <h2 className="mt-7 text-[15px] font-semibold">What about this instance?</h2>
          <div className="mt-3 flex flex-col gap-3" role="radiogroup" aria-label="This instance">
            <Pick on={choice === 'standby'} onPick={() => setChoice('standby')}>
              <div className="pr-8 text-[14px] font-medium">Keep it as a stand-by <span className="ml-1 rounded-full border border-primary-line px-2 py-0.5 text-[11.5px] text-primary-hi">Recommended</span></div>
              <div className="text-[12.5px] text-fg-3">{d.deploy?.pausedHere ? `${d.deploy.pausedHere.schedules.length} schedules and ${d.deploy.pausedHere.watches.length} watches are already paused here, so nothing runs twice.` : 'Schedules and auto deploy here keep their current state.'} Open it any time to compare.</div>
            </Pick>
            <Pick on={choice === 'both'} onPick={() => setChoice('both')}>
              <div className="pr-8 text-[14px] font-medium">Keep both running <span className="ml-1 rounded-full border border-warn-line bg-warn-soft px-2 py-0.5 text-[11.5px] text-warn">Runs twice</span></div>
              <div className="text-[12.5px] text-fg-3">Turns the schedules and auto deploy that were paused here back on. Both instances then run them.</div>
            </Pick>
          </div>
        </>
      )}
    </StepPage>
  );
}
