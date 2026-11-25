/** Settings › API tokens (design sheet f147): tokens that act as you, or less. */
import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { ago, toDate } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { RadioGroup } from '../../components/ui/Toggle';
import { Banner, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { formatDistanceToNowStrict } from 'date-fns';

type Level = 'read' | 'run' | 'full';
interface Tok { id: number; name: string; last4: string; level: Level; createdAt: string; lastUsedAt: string | null; expiresAt: string | null }

const LEVELS: { id: Level; label: string; desc: string }[] = [
  { id: 'read', label: 'Read only', desc: 'See pipelines, runs and logs.' },
  { id: 'run', label: 'Run pipelines', desc: 'Also start, stop and approve runs where you may.' },
  { id: 'full', label: 'Everything I can do', desc: 'Also change YAML, environment and files. Not your password, codes or tokens.' },
];
const label = (l: Level) => LEVELS.find((x) => x.id === l)?.label ?? l;

function expires(at: string | null) {
  if (!at) return 'Never';
  const d = toDate(at);
  return d.getTime() < Date.now() ? 'Expired' : `in ${formatDistanceToNowStrict(d)}`;
}

export default function Tokens() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [tokens, setTokens] = useState<Tok[] | null>(null);
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<{ token: string; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    api<{ tokens: Tok[] }>('/me/tokens').then((r) => { if (live) setTokens(r.tokens); }).catch(() => { if (live) setTokens([]); });
    return () => { live = false; };
  }, []);

  const revoke = async (t: Tok) => {
    if (!(await confirm({ title: `Revoke “${t.name}”?`, message: 'Anything using it stops working at once. This can’t be undone.', confirmText: 'Revoke', isDangerous: true }))) return;
    try {
      await api(`/me/tokens/${t.id}`, { method: 'DELETE' });
      setTokens((ts) => ts?.filter((x) => x.id !== t.id) ?? null);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <PageHead title="API tokens" lede="For scripts and CI calling this server as you. A token can do what you can, or less; never more."
        action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New token</Button>} />

      {made && (
        <Banner tone="ok" className="mb-5" title={`${made.name} is ready`}>
          <p>Copy it now. It is shown once; only a hash is kept.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-ctl border border-line-2 bg-bg-2 px-2.5 py-1.5 font-mono text-[12.5px] text-fg">{made.token}</code>
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(made.token); toast.success('Copied'); }}>Copy</Button>
          </div>
        </Banner>
      )}

      {tokens == null ? <Skeleton className="h-32 w-full" /> : tokens.length === 0 ? (
        <EmptyState icon={<KeyRound />} title="No tokens yet" action={<Button onClick={() => setOpen(true)}>New token</Button>}>Make one for each script, so you can revoke one without breaking the rest.</EmptyState>
      ) : (
        <>
        <ul className="overflow-hidden rounded-card border border-line md:hidden">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{t.name} <span className="font-mono text-[12px] font-normal text-fg-3">…{t.last4}</span></div>
                <div className="truncate text-[12.5px] text-fg-3">{label(t.level)} · used {ago(t.lastUsedAt).toLowerCase()} · expires {expires(t.expiresAt).toLowerCase()}</div>
              </div>
              <Button size="sm" variant="danger" onClick={() => void revoke(t)}>Revoke</Button>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-card border border-line md:block">
          <table className="w-full min-w-[560px] text-left text-[13.5px]">
            <thead className="bg-surface-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              <tr><th className="px-4 py-2.5 font-normal">Name</th><th className="px-4 py-2.5 font-normal">Can</th><th className="px-4 py-2.5 font-normal">Last used</th><th className="px-4 py-2.5 font-normal">Expires</th><th /></tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-3"><div className="font-medium">{t.name}</div><div className="font-mono text-[12px] text-fg-3">ezp_…{t.last4}</div></td>
                  <td className="px-4 py-3 text-fg-2">{label(t.level)}</td>
                  <td className="px-4 py-3 text-fg-2">{ago(t.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-fg-2">{expires(t.expiresAt)}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="danger" onClick={() => void revoke(t)}>Revoke</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <p className="mt-4 text-[13px] text-fg-3">Send it as <code className="font-mono text-fg-2">Authorization: Bearer ezp_…</code>. Each use is in the audit log under your name.</p>

      <NewToken open={open} onClose={() => setOpen(false)} onMade={(token, rec) => { setMade({ token, name: rec.name }); setTokens((ts) => [rec, ...(ts ?? [])]); setOpen(false); }} />
    </>
  );
}

function NewToken({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: (token: string, rec: Tok) => void }) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState<Level>('read');
  const [days, setDays] = useState('90');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const make = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ token: string; record: Tok }>('/me/tokens', { method: 'POST', body: { name, level, days: days === 'never' ? null : Number(days) } });
      setName(''); setLevel('read'); setDays('90');
      onMade(r.token, r.record);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New API token" size="md" busy={busy} dirty={!!name}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void make()}>Make token</Button></>}>
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void make(); }}>
        <Field label="Name" hint="What uses it, so you know what breaks if you revoke it."><Input autoFocus value={name} maxLength={60} placeholder="Release script" onChange={(e) => setName(e.target.value)} /></Field>
        <div>
          <div className="mb-2 text-[13px] font-medium">It can</div>
          <RadioGroup value={level} onChange={setLevel} className="!flex-col !items-start !gap-3"
            options={LEVELS.map((l) => ({ value: l.id, label: <span><span className="font-medium">{l.label}</span><span className="block text-[12.5px] text-fg-3">{l.desc}</span></span> }))} />
        </div>
        <Field label="Expires">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option><option value="never">Never</option>
          </Select>
        </Field>
        {err && <Banner tone="fail">{err}</Banner>}
      </form>
    </Modal>
  );
}
