/**
 * First-run setup, seven steps (design sheet f7–f15; phone f19, f20).
 *
 * Each step saves when you continue, so a closed tab picks up where it
 * stopped. Step 2 makes the admin and signs them in; everything after runs as
 * that admin. Steps 4 to 6 can be skipped.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, Copy, Folder, KeyRound, Play, Repeat, Server, Shield, ShieldCheck,
  Sparkles, TriangleAlert, Upload, Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { api, ApiError } from '../../lib/api';
import { installsSnapshot, queueInstalls, subscribeInstalls } from '../../lib/pluginInstall';
import { Logo, LogoMark } from '../../components/brand/Logo';
import { VERSION } from '../../lib/instance';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { Checkbox, Switch } from '../../components/ui/Toggle';
import { Segmented } from '../../components/ui/Tabs';
import { Badge } from '../../components/ui/Badge';
import { Banner, Card } from '../../components/ui/Feedback';
import { BootSplash } from '../../components/shell/states';
import { cx } from '../../components/ui/cx';

type Theme = 'classic' | 'midnight' | 'light';
interface State {
  initialized: boolean; step: number; done: boolean; acknowledged: boolean;
  instance: { name: string; url: string; theme: Theme };
  plugins: string[]; firstPipeline: string | null;
  host?: { platform: string; docker: string | null; dataDir: string };
}
interface Plugin { id: string; name: string; description: string; isInstalled: boolean; version?: string; builtin?: boolean }
interface Template { id: string; name: string; steps: string[]; needs: { plugin?: string; builtin?: string } }
interface Cred { id: number; name: string; publicKey: string | null; test: { canRead: boolean | null; canWrite: boolean | null; error: string | null } }

const STEPS = [
  ['Welcome', 'What runs where'], ['Admin account', 'You, the primary admin'], ['Instance basics', 'Name, URL, theme'],
  ['Connect git', 'A deploy key, or skip'], ['Plugins', 'Tools your steps call'], ['First pipeline', 'A template'], ['Done', 'What is set up'],
] as const;

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server.');

/* ------------------------------------------------------------------ */
/* Frame                                                               */
/* ------------------------------------------------------------------ */

function Rail({ step, at, summaries, onPick }: { step: number; at: number; summaries: (string | null)[]; onPick: (n: number) => void }) {
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-r border-line bg-bg-2 px-7 py-6 lg:flex">
      <Logo size={28} />
      <div className="mt-12 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">Set up this instance</div>
      <ol className="mt-4 flex flex-col">
        {STEPS.map(([name, sub], i) => {
          const n = i + 1;
          const done = n < at || (n === 7 && at === 7 && step === 7);
          const here = n === step;
          const reachable = n <= at && n !== 2;
          return (
            <li key={name} className="relative flex gap-3 pb-[22px] last:pb-0">
              {n < 7 && <span aria-hidden className={cx('absolute left-[13px] top-[30px] h-[calc(100%-30px)] w-px', n < at ? 'bg-primary/60' : 'bg-line-2')} />}
              <span className={cx('grid size-[27px] shrink-0 place-items-center rounded-full border text-[12px] font-medium',
                done ? (n === 7 ? 'border-primary bg-primary text-primary-ink' : 'border-primary/60 bg-primary/10 text-primary-hi') : here ? 'border-primary text-fg shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_20%,transparent)]' : 'border-line-3 text-fg-3')}>
                {done ? <Check className="size-3.5" /> : n}
              </span>
              <button type="button" disabled={!reachable || here} onClick={() => onPick(n)} className="text-left disabled:cursor-default">
                <div className={cx('text-[14px] font-medium', here || done ? 'text-fg' : 'text-fg-2')}>{name}</div>
                <div className="text-[12.5px] text-fg-3">{summaries[i] ?? sub}</div>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto border-t border-line pt-4 text-[12.5px] leading-relaxed text-fg-3">
        {step === 7 ? 'You can run setup again any time from Settings › General.' : 'Setup saves after every step. Close the tab and you pick up here.'}
        <div className="mt-2 font-mono text-[11.5px]">v{VERSION} · Apache 2.0</div>
      </div>
    </aside>
  );
}

function PhoneTop({ step }: { step: number }) {
  return (
    <div className="border-b border-line px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] lg:hidden">
      <div className="flex items-center gap-2.5"><LogoMark size={24} /><span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-3">Step {step} of 7 · {STEPS[step - 1][0]}</span></div>
      <div className="mt-3 flex gap-1">{STEPS.map((_, i) => <span key={i} className={cx('h-1 flex-1 rounded-full', i < step ? 'bg-primary' : 'bg-line-2')} />)}</div>
    </div>
  );
}

function StepPage({ step, title, lede, icon, children, footer }: { step: number; title: ReactNode; lede?: ReactNode; icon?: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-8 lg:py-14">
          {icon}
          <div className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3 lg:block">Step {step} of 7 · {STEPS[step - 1][0]}</div>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">{title}</h1>
          {lede && <p className="mt-2.5 text-[14.5px] leading-relaxed text-fg-2">{lede}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
      <footer className="border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-3 px-4 py-4 sm:px-8">{footer}</div>
      </footer>
    </div>
  );
}

const BackBtn = ({ onClick }: { onClick: () => void }) => <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onClick}>Back</Button>;
const Next = ({ children, ...p }: { children: ReactNode; onClick: () => void; loading?: boolean; disabled?: boolean }) => (
  <Button variant="primary" size="lg" iconRight={<ArrowRight className="size-4" />} {...p}>{children}</Button>
);

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function Welcome({ s, ack, setAck, onNext }: { s: State; ack: boolean; setAck: (v: boolean) => void; onNext: () => void }) {
  const cards: [ReactNode, string, string][] = [
    [<Folder key="f" />, 'Groups', 'Folders for pipelines, with shared environment, resources, credentials and auto deploy.'],
    [<Shield key="s" />, 'Approval gates', 'A run pauses until someone approves, like Promote to production.'],
    [<Repeat key="r" />, 'Versions', 'Successful builds are archived, so a rollback is one click.'],
  ];
  return (
    <StepPage step={1} title="Welcome to EZPipeline"
      icon={<span className="mb-6 block w-fit"><LogoMark size={48} /></span>}
      lede="Self-hosted CI/CD you can read. A pipeline is a YAML file. Its steps run in order as shell commands on this host, and the log streams live to your browser. Setup takes about five minutes."
      footer={<><a className="inline-flex items-center gap-2 text-[13.5px] font-medium text-fg-2 hover:text-fg" href="/docs" target="_blank" rel="noreferrer"><BookOpen className="size-4" />Read the docs first</a><span className="flex-1" /><Next onClick={onNext} disabled={!ack}>Get started</Next></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(([icon, t, d]) => (
          <Card key={t} className="flex flex-col gap-2">
            <span className="grid size-9 place-items-center rounded-box border border-line-2 bg-surface-2 text-fg-2 [&>svg]:size-4">{icon}</span>
            <b className="mt-2 text-[14px] font-semibold">{t}</b>
            <p className="text-[13px] leading-relaxed text-fg-2">{d}</p>
          </Card>
        ))}
      </div>
      <div className="mt-5 rounded-card border border-warn-line bg-warn-soft p-4">
        <div className="flex gap-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <div>
            <b className="text-[14px] font-semibold">Steps run on this host, with no isolation.</b>
            <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">They run as the EZPipeline user, with its files, its network and Docker. Anyone who can edit a pipeline can run code here, so give Edit YAML only to people you would give a shell.</p>
            <Checkbox className="mt-3" checked={ack} onChange={setAck} label="I understand who can run code on this host" />
          </div>
        </div>
      </div>
      {s.host && (
        <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-fg-3">
          <Server className="size-3.5" /><span>{s.host.platform}</span><span>{s.host.docker ? `Docker ${s.host.docker} found` : 'No Docker found'}</span><span className="break-all">Data in {s.host.dataDir}</span>
        </p>
      )}
    </StepPage>
  );
}

function strength(p: string) {
  let n = 0;
  if (p.length >= 12) n++;
  if (p.length >= 16) n++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++;
  if (/\d/.test(p) && /[^\w]/.test(p)) n++;
  return p.length < 12 ? Math.min(n, 1) : n;
}

function Admin({ onBack, onCreated }: { onBack: () => void; onCreated: (token: string, me: { username: string; displayName: string; mfa: boolean }) => Promise<void> }) {
  const [f, setF] = useState({ displayName: '', username: 'admin', email: '', password: '', confirm: '', mfa: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const st = strength(f.password);
  const label = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][st];
  const matches = f.confirm.length > 0 && f.confirm === f.password;
  const ok = f.username.length >= 2 && f.password.length >= 12 && matches && (!f.mfa || f.email.includes('@'));
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ token: string; username: string }>('/setup', { body: { username: f.username.trim(), displayName: f.displayName.trim(), email: f.email.trim() || undefined, password: f.password, mfa: f.mfa }, token: '' });
      await onCreated(r.token, { username: r.username, displayName: f.displayName.trim() || r.username, mfa: f.mfa && !!f.email.trim() });
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <StepPage step={2} title="Create the admin account" lede="This is the primary admin. It can't be removed or demoted, and it can reset anyone's password."
      footer={<><BackBtn onClick={onBack} /><span className="flex-1" /><Next onClick={() => void create()} loading={busy} disabled={!ok}>Create account</Next></>}>
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        {err && <Banner tone="fail" className="sm:col-span-2">{err}</Banner>}
        <Field label="Display name"><Input value={f.displayName} autoFocus autoComplete="name" onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="Username" hint="You sign in with it. It can't be changed later."><Input value={f.username} autoComplete="username" onChange={(e) => setF({ ...f, username: e.target.value.replace(/\s/g, '') })} /></Field>
        <Field label="Email" hint="Sign-in codes go here. Only admins can see it." className="sm:col-span-2"><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <div>
        <Field label="Password">
          <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
          {f.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cx('h-1 flex-1 rounded-full', i <= st ? (st >= 3 ? 'bg-primary' : st === 2 ? 'bg-warn' : 'bg-fail') : 'bg-line-2')} />)}</div>
              <span className={cx('text-[12px]', st >= 3 ? 'text-primary-hi' : st === 2 ? 'text-warn' : 'text-fail')}>{label} · {f.password.length} characters</span>
            </div>
          )}
        </div>
        <div>
        <Field label="Confirm password" error={f.confirm && !matches ? 'Does not match yet.' : undefined}>
          <Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
          {matches && <div className="mt-2 flex items-center gap-1 text-[12px] text-primary-hi"><Check className="size-3.5" />Matches</div>}
        </div>
        <div className={cx('rounded-card border p-4 sm:col-span-2', f.mfa ? 'border-primary/50 bg-primary/5' : 'border-line-2 bg-surface')}>
          <div className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-box border border-primary/40 bg-primary/10 text-primary-hi"><ShieldCheck className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><b className="text-[14px] font-semibold">Email me a code when I sign in</b><Badge tone="ok">Recommended</Badge></div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-2">This account can edit every pipeline, and pipelines run code on this host. A password alone is one leak away from that. Codes start once mail is set up in Settings › General.</p>
            </div>
            <Switch checked={f.mfa} onChange={(c) => setF({ ...f, mfa: c })} label={<span className="sr-only">Email codes</span>} />
          </div>
        </div>
        {f.password && f.password.length < 12 && <p className="text-[12.5px] text-fg-3 sm:col-span-2">Use at least 12 characters.</p>}
      </div>
    </StepPage>
  );
}

const THEMES: { id: Theme; name: string; note: string; bg: string; side: string; bar: string }[] = [
  { id: 'classic', name: 'Classic', note: 'Zinc and emerald. The default.', bg: '#0b0b0d', side: '#131316', bar: '#2a2a30' },
  { id: 'midnight', name: 'Midnight', note: 'Blue-black, softer at night.', bg: '#0b1020', side: '#111834', bar: '#26325a' },
  { id: 'light', name: 'Light', note: 'For bright rooms.', bg: '#ffffff', side: '#f1f1f3', bar: '#d6d6db' },
];

function Basics({ s, onBack, onSave }: { s: State; onBack: () => void; onSave: (i: State['instance']) => Promise<void> }) {
  const [name, setName] = useState(s.instance.name === 'EZPipeline' ? '' : s.instance.name);
  const [url, setUrl] = useState(s.instance.url || window.location.origin);
  const [theme, setTheme] = useState<Theme>(s.instance.theme);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => { setBusy(true); setErr(''); try { await onSave({ name: name.trim() || 'EZPipeline', url: url.trim(), theme }); } catch (e) { setErr(errText(e)); setBusy(false); } };
  return (
    <StepPage step={3} title="Name this instance" lede="The name shows in the browser tab and on the sign-in page. The URL is used for every link to a run."
      footer={<><BackBtn onClick={onBack} /><span className="flex-1" /><Next onClick={() => void save()} loading={busy}>Continue</Next></>}>
      <div className="flex flex-col gap-5">
        {err && <Banner tone="fail">{err}</Banner>}
        <Field label="Instance name"><Input value={name} placeholder="EZPipeline" autoFocus onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="Public URL" hint={<>Taken from your address bar. A run links like <span className="font-mono">{(url || window.location.origin).replace(/\/+$/, '')}/runs/135</span></>}>
          <Input mono value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><span className="text-[13.5px] font-medium">Theme</span><span className="text-[12.5px] text-fg-3">Anyone can pick their own later in Settings › Appearance.</span></div>
          <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} onClick={() => setTheme(t.id)}
                className={cx('rounded-card border p-3 text-left transition-colors', theme === t.id ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-line-2 hover:border-line-3')}>
                <span aria-hidden className="flex h-[92px] overflow-hidden rounded-box border border-line" style={{ background: t.bg }}>
                  <span className="flex w-[30%] flex-col gap-1.5 p-2" style={{ background: t.side }}><span className="h-1 w-6 rounded bg-[#10b981]" />{[0, 1, 2].map((i) => <span key={i} className="h-1 w-8 rounded" style={{ background: t.bar }} />)}</span>
                  <span className="flex flex-1 flex-col gap-1.5 p-2"><span className="h-1 w-12 rounded" style={{ background: t.bar }} /><span className="h-1 w-full rounded" style={{ background: t.bar }} /><span className="mt-auto h-2 w-10 rounded bg-[#10b981]" /></span>
                </span>
                <span className="mt-3 flex items-start gap-2">
                  <span className="flex-1"><b className="block text-[14px] font-semibold">{t.name}</b><span className="text-[13px] text-fg-2">{t.note}</span></span>
                  <span className={cx('mt-1 grid size-4 place-items-center rounded-full border', theme === t.id ? 'border-primary' : 'border-line-3')}>{theme === t.id && <span className="size-2 rounded-full bg-primary" />}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </StepPage>
  );
}

function ConnectGit({ instanceName, onBack, onNext, cred, setCred }: { instanceName: string; onBack: () => void; onNext: () => void; cred: Cred | null; setCred: (c: Cred) => void }) {
  const [mode, setMode] = useState<'generate' | 'paste'>('generate');
  const [name, setName] = useState(`${instanceName} deploy key`);
  const [priv, setPriv] = useState('');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState<'' | 'make' | 'test'>('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy('make'); setErr('');
    try {
      if (mode === 'generate') setCred((await api<{ credential: Cred }>('/git-credentials/*/generate', { body: { name: name.trim() } })).credential);
      else {
        const c = (await api<{ credential: Cred }>('/git-credentials/*', { body: { name: name.trim(), kind: 'ssh_key', secret: priv } })).credential;
        setCred((await api<{ credential: Cred }>(`/git-credentials/*/${c.id}`, { method: 'PUT', body: { useForReads: true } })).credential);
        setPriv('');
      }
    } catch (e) { setErr(errText(e)); }
    setBusy('');
  };
  const test = async () => {
    if (!cred || !repo.trim()) return;
    setBusy('test'); setErr('');
    try { setCred((await api<{ credential: Cred }>(`/git-credentials/*/${cred.id}/test`, { body: { repoUrl: repo.trim() } })).credential); }
    catch (e) { setErr(errText(e)); }
    setBusy('');
  };
  const copy = async () => { if (cred?.publicKey) { await navigator.clipboard.writeText(cred.publicKey); setCopied(true); setTimeout(() => setCopied(false), 1500); } };
  const t = cred?.test;
  return (
    <StepPage step={4} title="Let pipelines read your repos" lede="EZPipeline clones over SSH with a deploy key. Make one here and add its public half to GitHub. Every pipeline reads with it, unless its group has its own."
      footer={<><BackBtn onClick={onBack} /><span className="flex-1" /><Button variant="ghost" onClick={onNext}>Skip, I&rsquo;ll add keys per group</Button><Next onClick={onNext} disabled={!cred}>Continue</Next></>}>
      {!cred ? (
        <div className="flex flex-col gap-4">
          <Segmented value={mode} onChange={setMode} items={[{ id: 'generate', label: 'Generate a key' }, { id: 'paste', label: 'Paste a key I have' }]} />
          {err && <Banner tone="fail">{err}</Banner>}
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {mode === 'paste' && <Field label="Private key" hint="The file without .pub, including its BEGIN and END lines. It is encrypted here and never shown again."><Textarea rows={6} value={priv} onChange={(e) => setPriv(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></Field>}
          <div><Button variant="primary" icon={mode === 'generate' ? <Sparkles className="size-4" /> : <KeyRound className="size-4" />} loading={busy === 'make'} disabled={!name.trim() || (mode === 'paste' && !priv.trim())} onClick={() => void make()}>{mode === 'generate' ? 'Generate the key' : 'Save the key'}</Button></div>
        </div>
      ) : (
        <Card className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-box border border-primary/40 bg-primary/10 text-primary-hi"><KeyRound className="size-4" /></span>
            <div className="min-w-0 flex-1"><b className="text-[14.5px] font-semibold">{cred.name}</b><div className="text-[12.5px] text-fg-3">ed25519 · the private half never leaves this host</div></div>
            <Badge>SSH key</Badge>
          </div>
          {cred.publicKey && (
            <div>
              <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium">Public key</span><Button size="sm" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button></div>
              <pre className="whitespace-pre-wrap break-all rounded-box border border-line bg-log-bg p-3 font-mono text-[12px] leading-relaxed text-log-fg">{cred.publicKey}</pre>
              <ol className="mt-4 list-inside list-decimal space-y-1.5 text-[13.5px] text-fg-2">
                <li>Copy the public key.</li><li>In GitHub, open the repo, then Settings › Deploy keys › Add deploy key.</li><li>Leave <b className="font-medium text-fg">Allow write access</b> off. Reading is all a clone and a watch need.</li>
              </ol>
            </div>
          )}
          <div className="border-t border-line pt-4">
            {err && <Banner tone="fail" className="mb-3">{err}</Banner>}
            <div className="flex gap-2"><Input mono className="flex-1" placeholder="git@github.com:you/app.git" value={repo} onChange={(e) => setRepo(e.target.value)} /><Button loading={busy === 'test'} disabled={!repo.trim()} onClick={() => void test()}>Test</Button></div>
            {t?.canRead != null && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                {t.canRead ? <Badge tone="ok"><Check className="size-3" />Can read</Badge> : <Badge tone="fail">Cannot read</Badge>}
                {t.canRead && <Badge>{t.canWrite ? 'Can push' : 'Cannot push'}</Badge>}
                <span className="text-fg-3">{t.canRead ? (t.canWrite ? 'It can push too. Untick write access unless a pipeline merges.' : 'All a clone and a watch need.') : t.error ?? 'Add the public key to the repository, then test again.'}</span>
              </div>
            )}
          </div>
        </Card>
      )}
    </StepPage>
  );
}

const TARGETS: { id: string; label: string; plugins: string[] }[] = [
  { id: 'filefreak', label: 'FileFreak Sites', plugins: ['filefreak'] },
  { id: 'aws', label: 'AWS', plugins: ['aws-cli'] },
  { id: 'azure', label: 'Azure', plugins: ['azure-cli', 'bicep', 'azcopy'] },
  { id: 'gcp', label: 'Google Cloud', plugins: ['gcloud'] },
  { id: 'k8s', label: 'Kubernetes', plugins: ['kubectl', 'helm'] },
  { id: 'server', label: 'Just this server', plugins: [] },
];
const ABBR: Record<string, string> = { 'aws-cli': 'AWS', 'azure-cli': 'Az', bicep: 'Bcp', azcopy: 'Az→', kubectl: 'k8s', helm: 'helm', terraform: 'tf', jq: 'jq', yq: 'yq', filefreak: 'FF', gcloud: 'GCP' };

function useInstalls() { return useSyncExternalStore(subscribeInstalls, installsSnapshot); }

/** "aws-cli/2.35.4 Python/3.14" or a warning line → "2.35.4". The check commands print all sorts. */
const semver = (v?: string) => v?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null;

function PluginRow({ p, big, on, onToggle }: { p: Plugin; big?: boolean; on: boolean; onToggle: () => void }) {
  return (
    <label className={cx('flex min-w-0 cursor-pointer items-center gap-3 rounded-card border bg-surface p-3.5 transition-colors', on ? 'border-primary/60' : 'border-line-2 hover:border-line-3', big && 'p-4 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]')}>
      <span className={cx('grid shrink-0 place-items-center rounded-box border border-line-2 bg-bg-2 font-mono text-[11px] font-semibold text-fg-2', big ? 'size-11 text-[12px]' : 'size-9')}>{ABBR[p.id] ?? p.name.slice(0, 2)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><b className="text-[14px] font-medium">{p.name}</b>{big && <Badge tone="ok">Featured</Badge>}{p.isInstalled && <Badge>installed{semver(p.version) ? ` ${semver(p.version)}` : ''}</Badge>}</span>
        <span className={cx('block text-[12.5px] text-fg-3', !big && 'truncate')}>{p.description}</span>
      </span>
      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={on || p.isInstalled} disabled={p.isInstalled} onChange={onToggle} />
    </label>
  );
}

function Plugins({ picked, setPicked, onBack, onNext }: { picked: string[]; setPicked: (p: string[]) => void; onBack: () => void; onNext: (toInstall: string[]) => void }) {
  const [list, setList] = useState<Plugin[] | null>(null);
  const [targets, setTargets] = useState<string[]>(['filefreak']);
  const [err, setErr] = useState('');
  useEffect(() => { api<{ plugins: Plugin[] }>('/plugins').then((r) => setList(r.plugins)).catch((e) => setErr(errText(e))); }, []);
  const installable = (list ?? []).filter((p) => !p.builtin);
  const builtin = (list ?? []).filter((p) => p.builtin);
  const featured = installable.find((p) => p.id === 'filefreak');
  const rest = installable.filter((p) => p.id !== 'filefreak');
  const toggleTarget = (id: string) => {
    const on = !targets.includes(id);
    setTargets(on ? [...targets, id] : targets.filter((t) => t !== id));
    const ps = TARGETS.find((t) => t.id === id)!.plugins.filter((p) => installable.some((x) => x.id === p));
    setPicked(on ? [...new Set([...picked, ...ps])] : picked.filter((p) => !ps.includes(p)));
  };
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  const todo = picked.filter((id) => !installable.find((p) => p.id === id)?.isInstalled);
  return (
    <StepPage step={5} title="Install the tools your steps call" lede="A plugin puts a command-line tool on this host for every pipeline. Pick where you deploy and we tick the rest."
      footer={<><BackBtn onClick={onBack} /><span className="flex-1" /><span className="hidden text-[13px] text-fg-3 sm:inline">{todo.length ? `${todo.length} plugin${todo.length === 1 ? '' : 's'} · installs in the background` : 'Nothing to install'}</span><Next onClick={() => onNext(todo)}>{todo.length ? `Install ${todo.length} and continue` : 'Continue'}</Next></>}>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13px] text-fg-2">I deploy to</span>
        {TARGETS.filter((t) => t.plugins.length === 0 || t.plugins.some((p) => installable.some((x) => x.id === p))).map((t) => {
          const on = targets.includes(t.id);
          return <button key={t.id} type="button" aria-pressed={on} onClick={() => toggleTarget(t.id)} className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px]', on ? 'border-primary/60 bg-primary/10 text-primary-hi' : 'border-line-2 text-fg-2 hover:border-line-3')}>{on && <Check className="size-3.5" />}{t.label}</button>;
        })}
      </div>
      {!list ? <p className="text-[13px] text-fg-3">Reading what is on this host…</p> : (
        <div className="flex flex-col gap-3">
          {featured && <PluginRow p={featured} big on={picked.includes(featured.id)} onToggle={() => toggle(featured.id)} />}
          <div className="grid gap-3 sm:grid-cols-2">{rest.map((p) => <PluginRow key={p.id} p={p} on={picked.includes(p.id)} onToggle={() => toggle(p.id)} />)}</div>
          {builtin.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-3">Included in the image</span>
              {builtin.map((p) => <Badge key={p.id}>{p.name}</Badge>)}
            </div>
          )}
        </div>
      )}
    </StepPage>
  );
}

function FirstPipeline({ picked, onBack, onSkip, onCreated }: { picked: string[]; onBack: () => void; onSkip: () => void; onCreated: (id: string, name: string, group: string, template: string) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pick, setPick] = useState('static-site');
  const [group, setGroup] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const installs = useInstalls();
  useEffect(() => {
    api<{ templates: Template[] }>('/templates').then((r) => setTemplates(r.templates)).catch((e) => setErr(errText(e)));
    api<{ targets: { group?: string }[] }>('/targets').then((r) => setGroups([...new Set(r.targets.map((t) => t.group).filter((g): g is string => !!g))])).catch(() => {});
    api<{ plugins: Plugin[] }>('/plugins').then((r) => setPlugins(r.plugins)).catch(() => {});
  }, []);
  const needNote = (t: Template): [boolean, string] => {
    if (t.needs.builtin) return [true, `Uses ${t.needs.builtin}, in the image`];
    if (!t.needs.plugin) return [true, 'For people who want to write the YAML.'];
    if (!plugins.length) return [true, 'Checking this host…'];
    const p = plugins.find((x) => x.id === t.needs.plugin);
    const label = p?.name ?? t.needs.plugin;
    if (p?.isInstalled || installs.some((j) => j.id === t.needs.plugin && j.state === 'installed')) return [true, `Uses ${label}, installed`];
    if (picked.includes(t.needs.plugin)) return [true, `Uses ${label}, installing now`];
    return [false, `Needs ${label}, not picked in step 5`];
  };
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ id: string }>('/config/create-pipeline', { body: { group: group.trim(), name: name.trim(), template: pick } });
      onCreated(r.id, name.trim(), group.trim(), pick);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <StepPage step={6} title="Make your first pipeline" lede="Start from a template, then edit its YAML. It is a file on disk you can read."
      footer={<><BackBtn onClick={onBack} /><span className="flex-1" /><Button variant="ghost" onClick={onSkip}>Skip for now</Button><Next onClick={() => void create()} loading={busy} disabled={!name.trim()}>Create pipeline</Next></>}>
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      <div role="radiogroup" aria-label="Template" className="grid gap-3 sm:grid-cols-2">
        {(templates ?? []).map((t) => {
          const on = pick === t.id;
          const [fine, note] = needNote(t);
          return (
            <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => setPick(t.id)}
              className={cx('flex flex-col gap-2 rounded-card border bg-surface p-4 text-left transition-colors', on ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-line-2 hover:border-line-3')}>
              <span className="flex items-start gap-2"><b className="flex-1 text-[14px] font-semibold">{t.name}</b><span className={cx('mt-0.5 grid size-4 place-items-center rounded-full border', on ? 'border-primary' : 'border-line-3')}>{on && <span className="size-2 rounded-full bg-primary" />}</span></span>
              <span className="font-mono text-[11.5px] text-fg-3">{t.steps.join(' › ')}</span>
              <span className={cx('flex items-center gap-1.5 text-[12.5px]', fine ? (on ? 'text-primary-hi' : 'text-fg-2') : 'text-warn')}>{fine ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}{note}</span>
            </button>
          );
        })}
        <div className="flex flex-col gap-2 rounded-card border border-dashed border-line-2 p-4 text-fg-3">
          <span className="flex items-center gap-2 text-[14px] font-semibold text-fg-2"><Upload className="size-4" />Import a bundle (.ezp)</span>
          <span className="text-[12.5px] leading-relaxed">Bring pipelines from another EZPipeline. Import arrives with export, in Settings › Data.</span>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Group" hint="A folder. New names are made for you; leave it empty for Ungrouped.">
          <Input list="setup-groups" leading={<Folder />} value={group} placeholder="e.g. Website" onChange={(e) => setGroup(e.target.value)} />
        </Field>
        <datalist id="setup-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <Field label="Pipeline name"><Input value={name} placeholder="e.g. Website release" onChange={(e) => setName(e.target.value)} /></Field>
      </div>
    </StepPage>
  );
}

function Done({ s, me, cred, first, onEdit, onOpen, busy }: {
  s: State; me: { displayName: string; username: string; mfa: boolean } | null; cred: Cred | null;
  first: { id: string; name: string; group: string; template: string } | null; onEdit: (n: number) => void; onOpen: () => void; busy: boolean;
}) {
  const installs = useInstalls();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  useEffect(() => { api<{ plugins: Plugin[] }>('/plugins').then((r) => setPlugins(r.plugins)).catch(() => {}); }, [installs]);
  const nameOf = (id: string) => plugins.find((p) => p.id === id)?.name ?? id;
  const rows: [string, ReactNode, number | null][] = [
    ['Admin', me ? <>{me.displayName} <span className="text-fg-3">({me.username})</span>{me.mfa ? ' · email codes on' : ''}</> : 'Created', null],
    ['Instance', <>{s.instance.name} · <span className="font-mono text-[12.5px]">{s.instance.url.replace(/^https?:\/\//, '') || window.location.host}</span> · {THEMES.find((t) => t.id === s.instance.theme)?.name}</>, 3],
    ['Git', cred ? <>{cred.name} {cred.test.canRead ? <Badge tone="ok">Can read</Badge> : <Badge>not tested</Badge>}</> : <span className="text-fg-3">Skipped. Add keys on a group&rsquo;s Credentials tab.</span>, 4],
    ['Plugins', s.plugins.length ? (
      <span className="flex flex-wrap gap-x-3 gap-y-1">{s.plugins.map((id) => {
        const j = installs.find((x) => x.id === id);
        const st = plugins.find((p) => p.id === id)?.isInstalled ? 'installed' : j?.state ?? 'queued';
        return <span key={id} className={cx('inline-flex items-center gap-1.5 text-[13px]', st === 'installed' ? 'text-primary-hi' : st === 'failed' ? 'text-fail' : 'text-fg-2')}><span className={cx('size-1.5 rounded-full', st === 'installed' ? 'bg-primary' : st === 'failed' ? 'bg-fail' : 'bg-run animate-pulse')} />{nameOf(id)}{st === 'installing' && ' · installing'}{st === 'failed' && ' · failed'}</span>;
      })}</span>
    ) : <span className="text-fg-3">None. Add them in Settings › Plugins.</span>, 5],
    ['First pipeline', first ? <>{first.name}{first.group && <> <span className="text-fg-3">in</span> {first.group}</>}</> : <span className="text-fg-3">Skipped</span>, first ? null : 6],
  ];
  const next: [ReactNode, string, string][] = [
    first?.template === 'static-site' ? [<KeyRound key="k" />, 'Add FILEFREAK_KEY', `The Deploy step signs in with it. Add it as a secret on ${first.group || first.name}.`] : [<KeyRound key="k" />, 'Add your secrets', 'On the pipeline or its group, in Environment. Secrets stay hidden until revealed.'],
    [<Play key="p" />, 'Run it', 'Watch each step stream in live. Stop it at any step.'],
    [<Users key="u" />, 'Invite a teammate', 'Choose what they can do on each pipeline.'],
  ];
  return (
    <StepPage step={7} title={`${s.instance.name} is ready`} lede="Here is what you set up. All of it can be changed later in Settings."
      icon={<span className="mb-6 grid size-12 place-items-center rounded-card border border-primary/40 bg-primary/10 text-primary-hi"><Check className="size-6" /></span>}
      footer={<><span className="hidden text-[13px] text-fg-3 sm:inline">The Getting started list on the Overview keeps track of these.</span><span className="flex-1" /><Next onClick={onOpen} loading={busy}>Open EZPipeline</Next></>}>
      <Card pad={false} className="overflow-hidden">
        {rows.map(([k, v, edit]) => (
          <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3.5 last:border-0 sm:flex-nowrap">
            <span className="w-full text-[13px] text-fg-3 sm:w-36 sm:shrink-0">{k}</span>
            <span className="min-w-0 flex-1 text-[13.5px]">{v}</span>
            {edit && <button type="button" className="text-[13px] font-medium text-fg-2 hover:text-fg" onClick={() => onEdit(edit)}>Edit</button>}
          </div>
        ))}
      </Card>
      <div className="mt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">Next, in this order</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {next.map(([icon, t, d], i) => (
          <Card key={t} className="flex flex-col gap-2">
            <span className="flex items-center justify-between"><span className={cx('grid size-8 place-items-center rounded-box border [&>svg]:size-4', i === 0 ? 'border-warn-line bg-warn-soft text-warn' : 'border-line-2 bg-surface-2 text-fg-2')}>{icon}</span><span className="font-mono text-[12px] text-fg-3">{i + 1}</span></span>
            <b className="mt-2 text-[14px] font-semibold">{t}</b>
            <p className="text-[13px] leading-relaxed text-fg-2">{d}</p>
          </Card>
        ))}
      </div>
    </StepPage>
  );
}

/* ------------------------------------------------------------------ */
/* The wizard                                                          */
/* ------------------------------------------------------------------ */

export default function SetupPage() {
  const nav = useNavigate();
  const { login, token, isAdmin } = useAuth();
  const { setTheme } = useTheme();
  const [s, setS] = useState<State | null>(null);
  const [step, setStep] = useState(1);
  const [ack, setAck] = useState(false);
  const [me, setMe] = useState<{ displayName: string; username: string; mfa: boolean } | null>(null);
  const [cred, setCred] = useState<Cred | null>(null);
  const [picked, setPicked] = useState<string[]>(['filefreak', 'jq']);
  const [first, setFirst] = useState<{ id: string; name: string; group: string; template: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<State>('/setup/state').then((st) => {
    if (!live) return;
    if (st.initialized && st.step === undefined) { nav(token ? '/' : '/login', { replace: true }); return; }
    if (st.done) { nav('/', { replace: true }); return; }
    setS(st);
    setAck(st.acknowledged);
    setStep(st.initialized ? Math.max(3, st.step) : 1);
    if (st.plugins.length) setPicked(st.plugins);
    if (st.initialized) {
      // What earlier visits made, for the summaries.
      api<{ credentials: Cred[] }>('/git-credentials/*').then((r) => setCred(r.credentials[0] ?? null)).catch(() => {});
      api<{ user: { username: string; display_name?: string; mfa_enabled?: number } }>('/check-auth')
        .then((r) => setMe({ username: r.user.username, displayName: r.user.display_name || r.user.username, mfa: r.user.mfa_enabled === 1 })).catch(() => {});
    }
    }).catch(() => {});
    return () => { live = false; };
  }, [nav, token]);


  const save = async (patch: Record<string, unknown>) => setS({ ...(await api<State>('/setup/state', { method: 'PUT', body: patch })), host: s?.host, initialized: true });
  const go = (n: number) => { setStep(n); document.getElementById('main')?.scrollTo(0, 0); };

  const summaries = useMemo<(string | null)[]>(() => s ? [
    null,
    s.initialized ? `${me?.username ?? 'admin'}${me?.mfa ? ' · codes on' : ''}` : null,
    s.step > 3 ? `${s.instance.name} · ${THEMES.find((t) => t.id === s.instance.theme)?.name}` : null,
    s.step > 4 ? (cred ? `1 deploy key${cred.test.canRead ? ' · can read' : ''}` : 'Skipped') : null,
    s.step > 5 ? (s.plugins.length ? `${s.plugins.length} installing` : 'None') : null,
    s.step > 6 ? (first ? 'From a template' : 'Skipped') : null,
    null,
  ] : [], [s, me, cred, first]);

  if (!s) return <BootSplash label="Opening setup…" />;
  if (s.initialized && !isAdmin && step > 2) return <BootSplash label="Signing in…" />;

  const at = s.initialized ? Math.max(s.step, step) : step;
  let body: ReactNode;
  if (step === 1) body = <Welcome s={s} ack={ack} setAck={setAck} onNext={() => (s.initialized ? go(3) : go(2))} />;
  else if (step === 2) body = (
    <Admin onBack={() => go(1)} onCreated={async (tok, who) => {
      login(tok, who.username, true);
      setMe(who);
      setS({ ...(await api<State>('/setup/state', { method: 'PUT', body: { acknowledged: true, step: 3 }, token: tok })), host: s.host, initialized: true });
      go(3);
    }} />
  );
  else if (step === 3) body = <Basics s={s} onBack={() => go(1)} onSave={async (instance) => { await save({ instance, step: 4 }); setTheme(instance.theme); document.title = instance.name; go(4); }} />;
  else if (step === 4) body = <ConnectGit instanceName={s.instance.name} cred={cred} setCred={setCred} onBack={() => go(3)} onNext={() => void save({ step: 5 }).then(() => go(5))} />;
  else if (step === 5) body = (
    <Plugins picked={picked} setPicked={setPicked} onBack={() => go(4)} onNext={(todo) => {
      // Only what is missing: an installed tool is not installed again.
      queueInstalls(todo);
      void save({ plugins: picked, step: 6 }).then(() => go(6));
    }} />
  );
  else if (step === 6) body = (
    <FirstPipeline picked={picked} onBack={() => go(5)} onSkip={() => void save({ step: 7 }).then(() => go(7))}
      onCreated={(id, name, group, template) => { setFirst({ id, name, group, template }); void save({ firstPipeline: id, step: 7 }).then(() => go(7)); }} />
  );
  else body = (
    <Done s={s} me={me} cred={cred} first={first} busy={busy} onEdit={go} onOpen={async () => {
      setBusy(true);
      try { await save({ done: true }); } catch { /* the overview still opens */ }
      const fp = first?.id ?? s.firstPipeline;
      nav(fp ? `/pipelines/${encodeURIComponent(fp)}?tour=1` : '/', { replace: true });
    }} />
  );

  return (
    <div className="flex h-dvh bg-bg text-fg">
      <Rail step={step} at={at} summaries={summaries} onPick={go} />
      <div className="flex min-w-0 flex-1 flex-col">
        <PhoneTop step={step} />
        {body}
      </div>
    </div>
  );
}

