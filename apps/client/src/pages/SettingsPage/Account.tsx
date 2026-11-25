/** Settings › Account (design sheet f21). */
import { useEffect, useState } from 'react';
import { Laptop, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { ago } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { Blk, PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Toggle';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Banner, Skeleton } from '../../components/ui/Feedback';

interface Me { id: number; username: string; email: string | null; displayName: string | null; isAdmin: boolean; mfaEnabled: boolean; mfaEnforced: boolean }
interface Device { id: number; device_name: string | null; created_at: string; last_used_at: string | null }

const mask = (e: string) => e.replace(/^(.).*?(@.*)$/, '$1•••$2');

export default function Account() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Me>('/users/me').then((m) => { if (!live) return; setMe(m); setName(m.displayName ?? ''); setEmail(m.email ?? ''); }).catch(() => {});
    api<{ devices: Device[] }>('/me/devices').then((d) => { if (live) setDevices(d.devices); }).catch(() => { if (live) setDevices([]); });
    return () => { live = false; };
  }, []);

  if (!me) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  const dirty = name !== (me.displayName ?? '') || email !== (me.email ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await api(`/users/${me.id}`, { method: 'PATCH', body: { displayName: name.trim() || null, email: email.trim() } });
      setMe({ ...me, displayName: name.trim() || null, email: email.trim() || null });
      toast.success('Saved');
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const setCodes = async (on: boolean) => {
    if (!on && !(await confirm({ title: 'Turn off sign-in codes?', message: 'Your password alone will sign you in. Anyone who learns it can get in.', confirmText: 'Turn off', isDangerous: true }))) return;
    try {
      await api(`/users/${me.id}`, { method: 'PATCH', body: { mfaEnabled: on } });
      setMe({ ...me, mfaEnabled: on });
      toast.success(on ? 'Codes are on. You’ll get one at your next sign-in.' : 'Codes are off.');
    } catch (e) { toast.error((e as Error).message); }
  };

  const changePw = async () => {
    setPwErr(null);
    if (pw.next.length < 12) return setPwErr('A password is at least 12 characters.');
    if (pw.next !== pw.again) return setPwErr('The two new passwords are different.');
    setPwBusy(true);
    try {
      await api('/change-password', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: '', next: '', again: '' });
      toast.success('Password changed');
    } catch (e) { setPwErr((e as Error).message); } finally { setPwBusy(false); }
  };

  const forget = async (d: Device) => {
    try {
      await api(`/me/devices/${d.id}`, { method: 'DELETE' });
      setDevices((ds) => ds?.filter((x) => x.id !== d.id) ?? null);
      toast.success('That browser will be asked for a code next time.');
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <PageHead title="Account" lede="Your profile, password, sign-in codes, and the browsers you’ve trusted."
        action={<Button variant="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>Save changes</Button>} />

      <Blk title="Profile" desc="Shown on runs you start, approvals you give and in the audit log.">
        <div className="flex max-w-[520px] flex-col gap-4">
          <div className="flex items-center gap-3"><Avatar name={name || me.username} size={44} /><div className="text-[13px] text-fg-3">Initials avatar, made from your display name.</div></div>
          <Field label="Display name"><Input value={name} maxLength={80} placeholder={me.username} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Username" hint="Can’t be changed: scripts and tokens use it."><Input value={me.username} readOnly disabled mono /></Field>
          <Field label="Email" hint="You can sign in with it, and codes go to it."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
      </Blk>

      <Blk title="Password" desc="At least 12 characters. You stay signed in here.">
        <form className="flex max-w-[520px] flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void changePw(); }}>
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="New password again"><Input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
          {pwErr && <Banner tone="fail">{pwErr}</Banner>}
          <div><Button type="submit" icon={<Lock className="size-4" />} loading={pwBusy} disabled={!pw.current || !pw.next}>Change password</Button></div>
        </form>
      </Blk>

      <Blk title="Two-step sign-in" desc="A code by email after your password.">
        <div className="flex max-w-[520px] flex-col gap-3">
          <Switch checked={me.mfaEnabled} disabled={!me.email || (me.mfaEnabled && me.mfaEnforced && !me.isAdmin)} onChange={(on) => void setCodes(on)}
            label={<span className="flex items-center gap-2">Email code {me.mfaEnabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</span>}
            description={me.email ? `Codes go to ${mask(me.email)}.` : 'Add an email above first.'} />
          {me.mfaEnforced && <p className="text-[13px] text-fg-3">This instance requires codes for everyone{me.isAdmin ? '.' : '. An admin can turn yours off.'}</p>}
        </div>
      </Blk>

      <Blk title="Trusted browsers" desc="These skip the code for 30 days. Forget any you don’t recognise, then change your password.">
        {devices == null ? <Skeleton className="h-16 w-full" /> : devices.length === 0 ? (
          <p className="text-[13.5px] text-fg-3">None. Tick “Trust this browser” when you enter a code to skip it next time.</p>
        ) : (
          <ul className="overflow-hidden rounded-card border border-line">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <Laptop className="size-[18px] shrink-0 text-fg-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{d.device_name || 'A browser'}</div>
                  <div className="text-[12.5px] text-fg-3">Last used {ago(d.last_used_at ?? d.created_at)}</div>
                </div>
                <Button size="sm" onClick={() => void forget(d)}>Forget</Button>
              </li>
            ))}
          </ul>
        )}
      </Blk>
    </>
  );
}
