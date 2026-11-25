/** Settings › General (design sheet f145). Admins only; it changes things for everyone. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, RotateCcw, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { VERSION } from '../../lib/instance';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { Blk, PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Tabs';
import { Checkbox, Switch } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { Banner, Skeleton } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';

interface Instance { name: string; url: string; theme: 'classic' | 'midnight' | 'light' }
interface GeneralResp { instance: Instance; mfaEnforced: boolean; people: { total: number; codes: number }; mail: { provider: string; configured: boolean } }

export default function General() {
  const toast = useToast();
  const nav = useNavigate();
  const { confirm } = useConfirm();
  const [data, setData] = useState<GeneralResp | null>(null);
  const [inst, setInst] = useState<Instance | null>(null);
  const [enforce, setEnforce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mailOpen, setMailOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api<GeneralResp>('/settings/general').then((d) => { if (!live) return; setData(d); setInst(d.instance); setEnforce(d.mfaEnforced); }).catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, []);

  if (err && !data) return <Banner tone="fail">{err}</Banner>;
  if (!data || !inst) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  const dirty = JSON.stringify(inst) !== JSON.stringify(data.instance) || enforce !== data.mfaEnforced;

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api('/settings/general', { method: 'PUT', body: { instance: inst, mfaEnforced: enforce } });
      setData({ ...data, instance: inst, mfaEnforced: enforce });
      document.title = inst.name;
      toast.success('Saved');
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const rerun = async () => {
    if (!(await confirm({ title: 'Run setup again?', message: 'Nothing is lost: each step opens with what is set now. Everyone else can keep working.', confirmText: 'Open setup' }))) return;
    try { await api('/setup/state', { method: 'PUT', body: { rerun: true } }); nav('/setup'); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <PageHead title="General" lede="How this instance names itself, who must use sign-in codes, and how it sends mail. It changes things for everyone."
        action={<Button variant="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>Save changes</Button>} />
      {err && <Banner tone="fail" className="mb-5">{err}</Banner>}

      <Blk title="Instance" desc="Shown in the browser tab, on the sign-in page and in every link to a run.">
        <div className="flex max-w-[520px] flex-col gap-4">
          <Field label="Name"><Input value={inst.name} maxLength={60} onChange={(e) => setInst({ ...inst, name: e.target.value })} /></Field>
          <Field label="Public URL" hint="Links in emails and notifications start with this."><Input value={inst.url} placeholder="https://pipelines.example.com" mono onChange={(e) => setInst({ ...inst, url: e.target.value })} /></Field>
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Default theme</div>
            <Segmented label="Default theme" items={[{ id: 'classic', label: 'Classic' }, { id: 'midnight', label: 'Midnight' }, { id: 'light', label: 'Light' }]} value={inst.theme} onChange={(t) => setInst({ ...inst, theme: t as Instance['theme'] })} />
            <p className="mt-1.5 text-[12.5px] text-fg-3">For people who have not picked their own in Appearance.</p>
          </div>
        </div>
      </Blk>

      <Blk title="Sign-in codes" desc="A code by email after the password.">
        <div className="flex max-w-[560px] flex-col gap-3">
          <Switch checked={enforce} onChange={setEnforce} label="Require codes for everyone"
            description={`Off: each person chooses in Account. On: anyone without an email is asked for one at their next sign-in. ${data.people.codes} of ${data.people.total} ${data.people.total === 1 ? 'person has' : 'people have'} codes on.`} />
          {enforce && !data.mail.configured && <Banner tone="warn">Mail isn’t set up, so no codes can be sent. Set it up below first, or nobody will be asked for one.</Banner>}
        </div>
      </Blk>

      <Blk title="Mail" desc="Sends sign-in codes and run notifications.">
        <div className="flex max-w-[560px] items-center gap-3 rounded-card border border-line bg-surface p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-box border border-line-2 bg-surface-2"><Mail className="size-[18px] text-fg-2" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[14px] font-medium">{data.mail.provider ? data.mail.provider.toUpperCase() : 'Not chosen'}{data.mail.configured ? <Badge tone="ok" dot>Sending</Badge> : <Badge tone="warn">Not set up</Badge>}</div>
            <div className="text-[12.5px] text-fg-3">{data.mail.configured ? 'Ready to send.' : 'Codes and notifications can’t be sent yet.'}</div>
          </div>
          <Button size="sm" onClick={() => setMailOpen(true)}>{data.mail.configured ? 'Change' : 'Set up'}</Button>
        </div>
      </Blk>

      <Blk title="Setup" desc="The seven steps you saw the first time.">
        <div className="flex flex-col items-start gap-1.5">
          <Button icon={<RotateCcw className="size-4" />} onClick={() => void rerun()}>Run setup again</Button>
          <p className="text-[12.5px] text-fg-3">Nothing is lost: each step opens with what is set now.</p>
        </div>
      </Blk>

      <Blk title="Version" desc="What this server is running.">
        <div className="font-mono text-[14px]">v{VERSION}</div>
      </Blk>

      <MailModal open={mailOpen} onClose={() => setMailOpen(false)} onSaved={(configured, provider) => { setData({ ...data, mail: { provider, configured } }); }} />
    </>
  );
}

interface PField { key: string; label: string; type: 'text' | 'number' | 'boolean' | 'secret'; placeholder?: string; required: boolean; hint?: string; value?: string; isSet?: boolean }
interface Provider { id: string; label: string; blurb?: string; fields: PField[] }

/** The mail form. Secrets are never sent back: a blank secret means “unchanged”. */
function MailModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (configured: boolean, provider: string) => void }) {
  const toast = useToast();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [pick, setPick] = useState('');
  const [fields, setFields] = useState<PField[] | null>(null);
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ selected: string; providers: Provider[] }>('/settings/mail/providers').then((r) => { if (live) { setProviders(r.providers); setPick(r.selected || r.providers[0]?.id || ''); } }).catch(() => {});
    return () => { live = false; };
  }, [open]);

  useEffect(() => {
    if (!open || !pick) return;
    let live = true;
    api<{ fields: PField[] }>(`/settings/mail?provider=${encodeURIComponent(pick)}`).then((r) => {
      if (!live) return;
      setFields(r.fields);
      setVals(Object.fromEntries(r.fields.map((f) => [f.key, f.type === 'secret' ? '' : f.type === 'boolean' ? f.value === 'true' : f.value ?? ''])));
      setMsg(null);
    }).catch(() => {});
    return () => { live = false; };
  }, [open, pick]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api('/settings/mail', { method: 'POST', body: { provider: pick, values: vals } });
      const p = await api<{ configured: boolean; selected: string }>('/settings/mail/providers');
      onSaved(p.configured, p.selected);
      setMsg({ tone: 'ok', text: p.configured ? 'Saved. Send a test to be sure.' : 'Saved, but something required is still missing.' });
    } catch (e) { setMsg({ tone: 'fail', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const test = async () => {
    setTesting(true); setMsg(null);
    try { await api('/settings/mail/test', { method: 'POST', body: { to } }); setMsg({ tone: 'ok', text: `Sent to ${to}. Check the inbox.` }); toast.success('Test sent'); }
    catch (e) { setMsg({ tone: 'fail', text: (e as Error).message }); } finally { setTesting(false); }
  };

  const provider = providers?.find((p) => p.id === pick);
  return (
    <Modal open={open} onClose={onClose} title="Mail" description="How this instance sends sign-in codes and notifications." size="md" busy={busy || testing}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={busy} disabled={!fields} onClick={() => void save()}>Save</Button></>}>
      {!providers ? <Skeleton className="h-40 w-full" /> : (
        <div className="flex flex-col gap-4">
          <Field label="Provider" hint={provider?.blurb}>
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>{providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
          </Field>
          {fields?.map((f) => f.type === 'boolean' ? (
            <Checkbox key={f.key} checked={vals[f.key] === true} onChange={(v) => setVals({ ...vals, [f.key]: v })} label={f.label} hint={f.hint} />
          ) : (
            <Field key={f.key} label={f.label} hint={f.type === 'secret' && f.isSet ? 'Set. Leave blank to keep it.' : f.hint}>
              <Input type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'} autoComplete="off" value={String(vals[f.key] ?? '')} placeholder={f.type === 'secret' && f.isSet ? '••••••••' : f.placeholder}
                onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
            </Field>
          ))}
          <div className="border-t border-line pt-4">
            <div className="mb-1.5 text-[13px] font-medium">Send a test</div>
            <div className="flex gap-2">
              <Input type="email" value={to} placeholder="you@example.com" onChange={(e) => setTo(e.target.value)} className="flex-1" />
              <Button icon={<Send className="size-4" />} loading={testing} disabled={!to.includes('@')} onClick={() => void test()}>Send</Button>
            </div>
          </div>
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        </div>
      )}
    </Modal>
  );
}
