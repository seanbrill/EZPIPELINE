/**
 * Admin › Agent & API tokens (design sheet f34). Agent tokens are for AI
 * agents over MCP: they act through EZPipeline's tools, never a shell, and
 * only within their scopes. Below them, every person's API tokens, so an
 * admin can revoke one that leaked.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Copy, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { ago } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Field, Input } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Checkbox } from '../../components/ui/Toggle';
import { Banner, EmptyState, Skeleton } from '../../components/ui/Feedback';

interface Agent { id: number; name: string; scopes: string[]; created_at: string; last_used_at?: string | null }
interface Api { id: number; name: string; last4: string; level: 'read' | 'run' | 'full'; lastUsedAt: string | null; expiresAt: string | null; owner: string }
const LEVEL = { read: 'Read only', run: 'Run pipelines', full: 'Everything they can do' } as const;
const SCOPES = [{ id: 'yaml:read', label: 'Read pipelines', hint: 'List pipelines, read YAML, runs and logs.' }, { id: 'yaml:write', label: 'Change pipelines', hint: 'Edit YAML and environment through the tools.' }];

const th = 'px-4 py-2.5 font-normal';
const fetchAll = () => Promise.all([api<{ tokens: Agent[] }>('/agent-tokens'), api<{ tokens: Api[] }>('/admin/api-tokens')]);

export default function AgentTokens() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [tokens, setTokens] = useState<Api[] | null>(null);
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => { const [a, t] = await fetchAll(); setAgents(a.tokens); setTokens(t.tokens); }, []);
  useEffect(() => {
    let live = true;
    fetchAll().then(([a, t]) => { if (live) { setAgents(a.tokens); setTokens(t.tokens); } }).catch(() => { if (live) { setAgents([]); setTokens([]); } });
    return () => { live = false; };
  }, []);

  const revoke = async (what: string, path: string) => {
    if (!(await confirm({ title: `Revoke “${what}”?`, message: 'Anything using it stops working at once.', confirmText: 'Revoke', isDangerous: true }))) return;
    try { await api(path, { method: 'DELETE' }); toast.success('Revoked'); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (!agents || !tokens) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;

  return (
    <>
      <PageHead title="Agent & API tokens" lede="For scripts and AI agents. An agent acts through EZPipeline’s tools, never a shell, and only within its scopes."
        action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New agent token</Button>} />

      {made && (
        <Banner tone="ok" className="mb-5" title={`${made.name} is ready`}>
          <p>Copy the token now: it won’t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-ctl border border-line-2 bg-bg-2 px-2.5 py-1.5 font-mono text-[12.5px] text-fg">{made.token}</code>
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(made.token); toast.success('Copied'); }}>Copy</Button>
          </div>
        </Banner>
      )}

      <h2 className="mb-2.5 text-[15px] font-semibold">Agents (MCP)</h2>
      {agents.length === 0 ? <EmptyState icon={<Bot />} title="No agent tokens" className="rounded-card border border-line !py-10">Make one for each agent, so you can cut one off without the others.</EmptyState> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[560px] text-left text-[13.5px]">
            <thead className="bg-surface-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3"><tr><th className={th}>Token</th><th className={th}>Scopes</th><th className={th}>Made</th><th className={th}>Last used</th><th /></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3"><span className="flex flex-wrap gap-1">{a.scopes.map((s) => <Badge key={s} tone={s.endsWith('write') ? 'warn' : 'neutral'}>{s}</Badge>)}</span></td>
                  <td className="px-4 py-3 text-fg-2">{ago(a.created_at)}</td>
                  <td className="px-4 py-3 text-fg-2">{ago(a.last_used_at)}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="danger" onClick={() => void revoke(a.name, `/agent-tokens/${a.id}`)}>Revoke</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-1 mt-8 text-[15px] font-semibold">People’s API tokens</h2>
      <p className="mb-2.5 text-[13px] text-fg-3">Each acts as the person who made it, or less. Make your own in <Link className="text-fg-2 underline-offset-2 hover:underline" to="/settings/tokens">Settings › API tokens</Link>.</p>
      {tokens.length === 0 ? <p className="rounded-card border border-line px-4 py-6 text-center text-[13.5px] text-fg-3">Nobody has made one.</p> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[620px] text-left text-[13.5px]">
            <thead className="bg-surface-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3"><tr><th className={th}>Token</th><th className={th}>Whose</th><th className={th}>Can</th><th className={th}>Last used</th><th /></tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-3"><div className="font-medium">{t.name}</div><div className="font-mono text-[12px] text-fg-3">ezp_…{t.last4}</div></td>
                  <td className="px-4 py-3 text-fg-2">{t.owner}</td>
                  <td className="px-4 py-3 text-fg-2">{LEVEL[t.level]}</td>
                  <td className="px-4 py-3 text-fg-2">{ago(t.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="danger" onClick={() => void revoke(t.name, `/admin/api-tokens/${t.id}`)}>Revoke</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewAgent open={open} onClose={() => setOpen(false)} onMade={(name, token) => { setMade({ name, token }); setOpen(false); void load(); }} />
    </>
  );
}

function NewAgent({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: (name: string, token: string) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['yaml:read']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const make = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ token: string }>('/agent-tokens', { method: 'POST', body: { name: name.trim(), scopes } });
      onMade(name.trim(), r.token); setName(''); setScopes(['yaml:read']);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New agent token" description="Paste it into the agent’s MCP settings." size="md" busy={busy} dirty={!!name}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim() || !scopes.length} onClick={() => void make()}>Make token</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && scopes.length) void make(); }}>
        <Field label="Name" hint="Which agent, on which machine."><Input autoFocus value={name} maxLength={60} placeholder="Claude Code on my laptop" onChange={(e) => setName(e.target.value)} /></Field>
        <div className="flex flex-col gap-3">
          {SCOPES.map((s) => <Checkbox key={s.id} checked={scopes.includes(s.id)} label={s.label} hint={s.hint} onChange={(on) => setScopes(on ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))} />)}
        </div>
        {err && <Banner tone="fail">{err}</Banner>}
      </form>
    </Modal>
  );
}
