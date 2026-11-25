/** Admin › Users & roles (design sheet f29, f35). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MoreHorizontal, Search, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { ago } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { PageHead } from '../../components/settings/kit';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { Field, Input } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Tabs';
import { Menu, type MenuEntry } from '../../components/ui/Menu';
import { Modal } from '../../components/ui/Modal';
import { RadioGroup } from '../../components/ui/Toggle';
import { Banner, Skeleton } from '../../components/ui/Feedback';

export interface Person { id: number; username: string; email: string | null; displayName: string; isAdmin: boolean; isPrimaryAdmin: boolean; canManageUsers: boolean; mfaEnabled: boolean; lastSignIn: string | null }
type Filter = 'all' | 'admins' | 'members';

const role = (p: Person) => (p.isAdmin ? 'Admin' : p.canManageUsers ? 'Manager' : 'Member');

export default function UsersSection({ onCount }: { onCount?: (n: number) => void }) {
  const { isAdmin, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [enforced, setEnforced] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ users: Person[] }>('/users');
    setPeople(r.users);
    onCount?.(r.users.length);
  }, [onCount]);

  useEffect(() => {
    let live = true;
    api<{ users: Person[] }>('/users').then((r) => { if (live) { setPeople(r.users); onCount?.(r.users.length); } }).catch(() => { if (live) setPeople([]); });
    if (isAdmin) api<{ mfaEnforced: boolean }>('/settings/general').then((g) => setEnforced(g.mfaEnforced)).catch(() => {});
    return () => { live = false; };
  }, [onCount, isAdmin]);

  const shown = useMemo(() => (people ?? []).filter((p) =>
    (filter === 'all' || (filter === 'admins' ? p.isAdmin : !p.isAdmin)) &&
    (!q || `${p.displayName} ${p.username} ${p.email ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [people, q, filter]);

  if (!people) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  const admins = people.filter((p) => p.isAdmin).length;
  const noCodes = people.filter((p) => !p.mfaEnabled);

  const patch = async (p: Person, body: Record<string, unknown>, done: string) => {
    try { await api(`/users/${p.id}`, { method: 'PATCH', body }); toast.success(done); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (p: Person) => {
    if (!(await confirm({ title: `Remove ${p.displayName}?`, message: 'They can’t sign in any more. Their runs and audit entries keep their name.', confirmText: 'Remove', isDangerous: true, requireText: p.username }))) return;
    try { await api(`/users/${p.id}`, { method: 'DELETE' }); toast.success(`${p.displayName} removed`); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const actions = (p: Person): MenuEntry[] => {
    const self = p.username === user;
    const items: MenuEntry[] = [];
    if (isAdmin && !p.isPrimaryAdmin && !self) items.push(p.isAdmin
      ? { label: 'Make a member', onSelect: () => void patch(p, { isAdmin: false }, `${p.displayName} is a member`) }
      : { label: 'Make an admin', onSelect: () => void patch(p, { isAdmin: true }, `${p.displayName} is an admin`) });
    if (isAdmin && !p.isAdmin) items.push({ label: p.canManageUsers ? 'Stop managing people' : 'Let them manage people', onSelect: () => void patch(p, { canManageUsers: !p.canManageUsers }, 'Saved') });
    if (p.mfaEnabled && !self) items.push({ label: 'Turn codes off', onSelect: () => void patch(p, { mfaEnabled: false }, 'Codes are off for them. They can turn them on again in Account.') });
    if (!p.isAdmin) items.push({ label: 'Permissions', onSelect: () => nav(`/admin/permissions?user=${p.id}`) });
    if (!p.isPrimaryAdmin && !self) items.push({ label: 'Remove', danger: true, onSelect: () => void remove(p) });
    return items;
  };

  const roleBadge = (p: Person) => <span className="inline-flex items-center gap-1.5">{p.isAdmin ? <Badge tone="ok">Admin</Badge> : <Badge>{role(p)}</Badge>}{p.isPrimaryAdmin && <Badge>Primary</Badge>}</span>;

  return (
    <>
      <PageHead title="Users & roles" lede="Admins can do everything. Members can do exactly what each pipeline’s permissions allow."
        action={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Add person</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1 sm:max-w-[320px]"><Input leading={<Search className="size-4" />} placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Segmented label="Show" items={[{ id: 'all', label: `All ${people.length}` }, { id: 'admins', label: `Admins ${admins}` }, { id: 'members', label: `Members ${people.length - admins}` }]} value={filter} onChange={(v) => setFilter(v as Filter)} />
      </div>

      {/* Phone (f35): one card per person. */}
      <ul className="flex flex-col overflow-hidden rounded-card border border-line md:hidden">
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 last:border-0">
            <Avatar name={p.displayName} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{p.displayName}</div>
              <div className="truncate text-[12.5px] text-fg-3">{p.isPrimaryAdmin ? 'Primary admin' : role(p)} · <span className={p.mfaEnabled ? 'text-primary-hi' : 'text-warn'}>Codes {p.mfaEnabled ? 'on' : 'off'}</span> · {ago(p.lastSignIn, 'never signed in')}</div>
            </div>
            {actions(p).length > 0 && <Menu trigger={<IconButton label={`Actions for ${p.displayName}`} size="sm"><MoreHorizontal /></IconButton>} items={actions(p)} />}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-card border border-line md:block">
        <table className="w-full text-left text-[13.5px]">
          <thead className="bg-surface-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
            <tr><th className="px-4 py-2.5 font-normal">Name</th><th className="px-4 py-2.5 font-normal">Email</th><th className="px-4 py-2.5 font-normal">Role</th><th className="px-4 py-2.5 font-normal">Codes</th><th className="px-4 py-2.5 font-normal">Last sign-in</th><th className="w-12" /></tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={p.displayName} size={30} /><div className="min-w-0"><div className="truncate font-medium">{p.displayName}</div><div className="font-mono text-[12px] text-fg-3">{p.username}</div></div></div></td>
                <td className="max-w-[220px] truncate px-4 py-3 text-fg-2">{p.email ?? <span className="text-fg-3">—</span>}</td>
                <td className="px-4 py-3">{roleBadge(p)}</td>
                <td className="px-4 py-3">{p.mfaEnabled ? <span className="text-primary-hi">On</span> : <span className="text-warn">Off</span>}</td>
                <td className="px-4 py-3 text-fg-2">{ago(p.lastSignIn, 'Never')}</td>
                <td className="px-2 py-3 text-right">{actions(p).length > 0 && <Menu trigger={<IconButton label={`Actions for ${p.displayName}`} size="sm"><MoreHorizontal /></IconButton>} items={actions(p)} />}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-fg-3">Nobody matches.</td></tr>}
          </tbody>
        </table>
      </div>

      {isAdmin && enforced === false && noCodes.length > 0 && (
        <Banner tone="warn" className="mt-5" action={<Link to="/settings/general" className="whitespace-nowrap font-medium underline-offset-2 hover:underline">Require codes</Link>}>
          {noCodes.length === 1 ? `${noCodes[0].displayName} signs in` : `${noCodes.length} people sign in`} with a password alone. Anyone who can edit a pipeline’s YAML can run commands on this host.
        </Banner>
      )}

      <AddPerson open={adding} admin={isAdmin} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void load(); }} />
    </>
  );
}

function AddPerson({ open, admin, onClose, onAdded }: { open: boolean; admin: boolean; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ username: '', displayName: '', email: '', password: '', role: 'member' as 'member' | 'admin' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setBusy(true); setErr(null);
    try {
      await api('/users', { method: 'POST', body: { username: f.username.trim(), displayName: f.displayName, email: f.email, password: f.password, isAdmin: f.role === 'admin' } });
      toast.success(`${f.displayName || f.username} can sign in now`);
      setF({ username: '', displayName: '', email: '', password: '', role: 'member' });
      onAdded();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a person" description="Give them the username and password yourself. They can change the password in Account." size="md" busy={busy} dirty={!!f.username}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.username || f.password.length < 12} onClick={() => void add()}>Add</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Field label="Username" hint="Letters, digits, dots and dashes. It can’t be changed."><Input autoFocus mono value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Display name"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="Email" hint="Optional. They can sign in with it, and codes go to it."><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" hint="At least 12 characters."><Input type="text" autoComplete="off" mono value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {admin && <div><div className="mb-2 text-[13px] font-medium">Role</div><RadioGroup value={f.role} onChange={(r) => setF({ ...f, role: r })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} /></div>}
        {err && <Banner tone="fail">{err}</Banner>}
      </form>
    </Modal>
  );
}
