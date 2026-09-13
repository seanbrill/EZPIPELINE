import React, { useCallback, useEffect, useState } from 'react';
import { Key, Plus, Trash2, CheckCircle2, XCircle, AlertTriangle, Loader2, HelpCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useToast } from '../../contexts/ToastContext';
import API_URL from '../../config/api';

/**
 * The git credentials a group's pipelines run with.
 *
 * THE SCREEN THAT WOULD HAVE PREVENTED THE INCIDENT. "Promote to production"
 * failed with "the key you are authenticating with has been marked as read
 * only", and the reply was the finding: "not even sure how the git credentials
 * were set for ezpipeline". There was nowhere to look. The credential was an
 * SSH key in a Docker volume, named on no screen, with its permissions living
 * on GitHub.
 *
 * So the list shows WHAT THE CREDENTIAL CAN DO, not only that one exists, and
 * "never tested" is its own state rather than being collapsed into "no". The
 * read-only key was never-tested for its entire life, and a screen that showed
 * a red cross would at least have been wrong loudly.
 */

interface Cred {
    id: number;
    group: string;
    name: string;
    kind: 'ssh_key' | 'token';
    username: string | null;
    createdAt: string;
    test: {
        at: string | null;
        identity: string | null;
        canRead: boolean | null;
        canWrite: boolean | null;
        error: string | null;
    };
}

const GitCredentialManager: React.FC<{ group: string }> = ({ group }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();
    const toast = useToast();
    const g = encodeURIComponent(group);

    const [creds, setCreds] = useState<Cred[] | null>(null);
    const [adding, setAdding] = useState(false);
    const [testing, setTesting] = useState<number | null>(null);
    const [form, setForm] = useState({ name: '', kind: 'ssh_key' as Cred['kind'], secret: '', username: '' });

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${API_URL}/api/git-credentials/${g}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
            setCreds((await res.json()).credentials || []);
        } catch (e) {
            toast.error((e as Error).message);
            setCreds([]);
        }
    }, [token, g, toast]);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        try {
            const res = await fetch(`${API_URL}/api/git-credentials/${g}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || String(res.status));
            toast.success(`Saved ${form.name}. Test it before something depends on it.`);
            setForm({ name: '', kind: 'ssh_key', secret: '', username: '' });
            setAdding(false);
            await load();
        } catch (e) {
            toast.error((e as Error).message);
        }
    };

    const test = async (c: Cred) => {
        setTesting(c.id);
        try {
            const res = await fetch(`${API_URL}/api/git-credentials/${g}/${c.id}/test`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || String(res.status));
            // The WRITE result is the one worth announcing, because it is the
            // one that was silently wrong for months.
            if (data.test?.canWrite) toast.success(`${c.name} can read and write ${data.repoUrl}`);
            else if (data.test?.canRead) toast.error(`${c.name} can READ but not WRITE. A merge would fail.`);
            else toast.error(`${c.name} could not reach the repository`);
            await load();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setTesting(null);
        }
    };

    const remove = async (c: Cred) => {
        if (!(await confirm({
            title: `Delete ${c.name}?`,
            message: 'Any pipeline in this group that used it will fall back to whatever the host has, which is how the last problem started.',
            confirmText: 'Delete',
            danger: true,
        }))) return;
        try {
            const res = await fetch(`${API_URL}/api/git-credentials/${g}/${c.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(String(res.status));
            await load();
        } catch (e) {
            toast.error((e as Error).message);
        }
    };

    /** Three states, not two. "Never tested" is the one that bit. */
    const Verdict: React.FC<{ c: Cred }> = ({ c }) => {
        if (c.test.at === null) {
            return (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                    <HelpCircle className="w-3.5 h-3.5" />
                    Never tested
                </span>
            );
        }
        if (c.test.canWrite) {
            return (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Can read and write
                </span>
            );
        }
        if (c.test.canRead) {
            return (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Read only - a merge or a push will fail
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                <XCircle className="w-3.5 h-3.5" />
                Cannot reach the repository
            </span>
        );
    };

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-400 leading-relaxed">
                What this group&rsquo;s pipelines authenticate to git with. Without one they
                use whatever the server host happens to have, which is unnamed, unreadable
                from here, and how a read-only deploy key went unnoticed for months.
            </p>

            {creds === null ? (
                <p className="text-xs text-slate-500">Loading&hellip;</p>
            ) : creds.length === 0 ? (
                <p className="text-xs text-slate-500">
                    None yet. Pipelines here fall back to the host&rsquo;s own git configuration.
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {creds.map((c) => (
                        <li key={c.id} className="border border-slate-700 rounded-lg p-3 bg-slate-900/40">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <Key className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                        <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                                        <span className="text-[10px] uppercase tracking-wider text-slate-500">
                                            {c.kind === 'ssh_key' ? 'SSH key' : 'Token'}
                                        </span>
                                    </div>
                                    <div className="mt-1.5"><Verdict c={c} /></div>
                                    {/* The greeting is what identified the incident: GitHub
                                        names a REPOSITORY for a deploy key and a USER for a
                                        personal one, and the difference is the whole story. */}
                                    {c.test.identity && (
                                        <p className="mt-1 text-[11px] text-slate-500 font-mono truncate">
                                            {c.test.identity}
                                        </p>
                                    )}
                                    {c.test.error && (
                                        <p className="mt-1 text-[11px] text-amber-300/90 leading-relaxed">
                                            {c.test.error}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => void test(c)}
                                        disabled={testing === c.id}
                                        className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 disabled:opacity-50"
                                    >
                                        {testing === c.id ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : 'Test'}
                                    </button>
                                    <button
                                        onClick={() => void remove(c)}
                                        className="text-slate-500 hover:text-red-400 p-1"
                                        aria-label={`Delete ${c.name}`}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {adding ? (
                <div className="border border-slate-700 rounded-lg p-3 flex flex-col gap-2 bg-slate-900/40">
                    <input
                        className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-white"
                        placeholder="Name you will recognise, e.g. notch.fm deploy key"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                    <select
                        className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-white"
                        value={form.kind}
                        onChange={(e) => setForm({ ...form, kind: e.target.value as Cred['kind'] })}
                    >
                        <option value="ssh_key">SSH key (a deploy key, or your own)</option>
                        <option value="token">Token (a personal access token)</option>
                    </select>
                    {form.kind === 'token' && (
                        <input
                            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-white"
                            placeholder="Username (GitHub ignores it; other hosts do not)"
                            value={form.username}
                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                        />
                    )}
                    <textarea
                        className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-white font-mono min-h-[7rem]"
                        placeholder={form.kind === 'ssh_key'
                            ? '-----BEGIN OPENSSH PRIVATE KEY-----\n...\nThe PRIVATE half - the file without .pub'
                            : 'ghp_... or github_pat_...'}
                        value={form.secret}
                        onChange={(e) => setForm({ ...form, secret: e.target.value })}
                    />
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                        Encrypted before it is stored and never shown again. To change it,
                        delete this one and add another.
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => void save()}
                            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                        >
                            Save
                        </button>
                        <button
                            onClick={() => setAdding(false)}
                            className="text-xs px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:text-white"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setAdding(true)}
                    className="self-start inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add a credential
                </button>
            )}
        </div>
    );
};

export default GitCredentialManager;
