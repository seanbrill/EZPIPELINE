/**
 * Sign in (design sheet f8, f9; phone f18).
 *
 * Password first. Then, if the account has email codes on, the code. If the
 * instance requires codes and the account has no email yet, it is asked for
 * one and proves it with a code, using a token good only for that.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { api, ApiError } from '../../lib/api';
import { AuthShell, CodeInput } from '../../components/auth/AuthShell';
import { useInstance } from '../../lib/instance';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Checkbox } from '../../components/ui/Toggle';
import { Banner } from '../../components/ui/Feedback';

type Stage = 'password' | 'code' | 'email' | 'email-code';
interface LoginAnswer { token?: string; username?: string; isAdmin?: boolean; mfaRequired?: boolean; emailMasked?: string; emailSetupRequired?: boolean; mfaSetupRequired?: boolean; deviceToken?: string }

const RESEND_AFTER = 45;

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { login } = useAuth();
  const inst = useInstance();
  const [stage, setStage] = useState<Stage>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [trust, setTrust] = useState(false);
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState('');
  const [email, setEmail] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api<{ initialized: boolean }>('/setup/state', { token: '' }).then((s) => { if (!s.initialized) nav('/setup', { replace: true }); }).catch(() => {});
  }, [nav]);
  useEffect(() => () => window.clearInterval(timer.current), []);

  const startWait = () => {
    setWait(RESEND_AFTER);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setWait((w) => { if (w <= 1) window.clearInterval(timer.current); return Math.max(0, w - 1); }), 1000);
  };
  const finish = (a: LoginAnswer) => {
    if (a.deviceToken) { try { localStorage.setItem('device_token', a.deviceToken); } catch { /* storage blocked */ } }
    login(a.token!, a.username!, !!a.isAdmin);
    const from = (loc.state as { from?: string } | null)?.from;
    nav(a.mfaSetupRequired ? '/settings/account' : from && from !== '/login' ? from : '/', { replace: true });
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reach the server.'); }
    setBusy(false);
  };

  const signIn = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    let deviceToken: string | null = null;
    try { deviceToken = localStorage.getItem('device_token'); } catch { /* storage blocked */ }
    const a = await api<LoginAnswer>('/login', { body: { username, password, deviceToken, remember }, token: '' });
    if (a.mfaRequired) { setMasked(a.emailMasked ?? 'your email'); setCode(''); setStage('code'); startWait(); return; }
    if (a.emailSetupRequired) { setSetupToken(a.token!); setStage('email'); return; }
    finish(a);
  }); };
  const verify = (c = code) => { if (c.length === 6) void run(async () => {
    finish(await api<LoginAnswer>('/auth/mfa/verify', { body: { username, code: c, rememberMe: trust, remember }, token: '' }));
  }); };
  const resend = () => void run(async () => { await api('/auth/mfa/resend', { body: { username }, token: '' }); startWait(); });
  const sendEmailCode = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await api('/auth/setup/email-challenge', { body: { email }, token: setupToken });
    setMasked(email); setCode(''); setStage('email-code'); startWait();
  }); };
  const verifyEmail = (c = code) => { if (c.length === 6) void run(async () => {
    finish(await api<LoginAnswer>('/auth/setup/email-verify', { body: { code: c }, token: setupToken }));
  }); };
  const back = () => { setStage('password'); setCode(''); setError(''); setPassword(''); };

  return (
    <AuthShell>
      {stage === 'password' && (
        <form onSubmit={signIn} className="flex flex-col gap-5">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-line-2 bg-surface px-2 py-0.5 font-mono text-[11.5px] text-fg-2"><span className="size-1.5 rounded-full bg-primary" />{window.location.host}</span>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em]">Sign in to {inst?.name ?? 'EZPipeline'}</h1>
            <p className="mt-1.5 text-[14px] text-fg-2">Use the account an admin made for you.</p>
          </div>
          {error && <Banner tone="fail">{error}</Banner>}
          <Field label="Username or email">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required className="h-11" />
          </Field>
          <Field label="Password">
            <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required
              trailing={<button type="button" className="grid size-7 place-items-center text-fg-3 hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>} />
          </Field>
          <Checkbox checked={remember} onChange={setRemember} label="Keep me signed in on this device for 30 days" />
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!username || !password}>Sign in</Button>
          <p className="text-[12.5px] leading-relaxed text-fg-3">Forgot your password? An admin can set a new one for you in Admin › Users &amp; roles.</p>
        </form>
      )}

      {(stage === 'code' || stage === 'email-code') && (
        <div className="flex flex-col gap-5">
          <button type="button" onClick={back} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg"><ArrowLeft className="size-3.5" />Use a different account</button>
          <span className="grid size-11 place-items-center rounded-box border border-primary/40 bg-primary/10 text-primary-hi"><Mail className="size-5" /></span>
          <div>
            <h1 className="text-[30px] font-semibold tracking-[-0.02em]">Check your email</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">We sent a 6-digit code to <b className="font-medium text-fg">{masked}</b>. It works once and expires in 10 minutes.</p>
          </div>
          {error && <Banner tone="fail">{error}</Banner>}
          <CodeInput value={code} onChange={setCode} disabled={busy} onComplete={(c) => (stage === 'code' ? verify(c) : verifyEmail(c))} />
          {stage === 'code' && <Checkbox checked={trust} onChange={setTrust} label="Trust this browser for 30 days" />}
          <Button variant="primary" size="lg" loading={busy} disabled={code.length < 6} onClick={() => (stage === 'code' ? verify() : verifyEmail())}>{stage === 'code' ? 'Verify and sign in' : 'Verify email'}</Button>
          <div className="flex justify-between text-[12.5px] text-fg-3">
            {wait > 0 ? <span>Didn&rsquo;t get it? Resend in <span className="font-mono text-fg-2">0:{String(wait).padStart(2, '0')}</span></span>
              : <button type="button" className="text-primary-hi hover:underline" onClick={stage === 'code' ? resend : () => setStage('email')}>{stage === 'code' ? 'Send a new code' : 'Use a different email'}</button>}
            <span>Check spam first</span>
          </div>
          {stage === 'code' && <p className="text-[12.5px] leading-relaxed text-fg-3">Lost access to this inbox? An admin can turn email codes off for your account in Admin › Users &amp; roles.</p>}
        </div>
      )}

      {stage === 'email' && (
        <form onSubmit={sendEmailCode} className="flex flex-col gap-5">
          <button type="button" onClick={back} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg"><ArrowLeft className="size-3.5" />Use a different account</button>
          <div>
            <h1 className="text-[30px] font-semibold tracking-[-0.02em]">Add your email</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">This instance asks for a code from your email at every sign-in. Add the address the codes should go to; we send one now to check it.</p>
          </div>
          {error && <Banner tone="fail">{error}</Banner>}
          <Field label="Email"><Input type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!email.includes('@')}>Send the code</Button>
        </form>
      )}
    </AuthShell>
  );
}
