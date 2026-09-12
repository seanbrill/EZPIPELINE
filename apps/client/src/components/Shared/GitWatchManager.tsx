import React, { useState, useEffect, useCallback } from 'react';
import { GitBranch, Trash2, Plus, AlertTriangle, CheckCircle2, XCircle, FolderTree, Pencil, Check, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useToast } from '../../contexts/ToastContext';
import API_URL from '../../config/api';

interface Watch {
    id: number;
    pipeline_target: string;
    group_path: string | null;
    repo_url: string;
    branch: string;
    poll_seconds: number;
    enabled: number;
    auto_approve: number;
    last_sha: string | null;
    last_checked_at: string | null;
    last_triggered_at: string | null;
    last_triggered_sha: string | null;
    last_error: string | null;
}

interface Target { id: string; appName: string; group?: string }

/**
 * Is `path` at or beneath `scope`?
 *
 * An empty scope is the root and contains everything. The trailing slash
 * matters: 'Notch.fm' must not swallow 'Notch.fmOther'.
 */
const inScope = (path: string, scope: string) =>
    scope === '' || path === scope || path.startsWith(scope + '/');

/** The part of a watch's path below the group being viewed, or '' if it is here. */
const relativePath = (path: string, scope: string) =>
    scope === '' ? path : path === scope ? '' : path.slice(scope.length + 1);

/**
 * Watches on a group: run a pipeline when a branch moves.
 *
 * Polling rather than webhooks, because this server usually has no inbound
 * route from the internet - so the panel says so rather than leaving somebody
 * hunting for a webhook URL that was never going to work.
 */
const GitWatchManager: React.FC<{ group: string }> = ({ group }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();
    const toast = useToast();

    const [watches, setWatches] = useState<Watch[]>([]);
    const [targets, setTargets] = useState<Target[]>([]);
    const [busy, setBusy] = useState(false);
    const [adding, setAdding] = useState(false);
    // Which watch is being edited in place, and the two fields it edits. Null
    // is "none": a row id would make the first row look permanently open.
    const [editing, setEditing] = useState<number | null>(null);
    const [editBranch, setEditBranch] = useState('');
    const [editPoll, setEditPoll] = useState('');

    const [pipelineTarget, setPipelineTarget] = useState('');
    const [repoUrl, setRepoUrl] = useState('');
    const [branch, setBranch] = useState('main');
    const [pollSeconds, setPollSeconds] = useState(60);
    const [autoApprove, setAutoApprove] = useState(false);

    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    const load = useCallback(async () => {
        try {
            const [wRes, tRes] = await Promise.all([
                fetch(`${API_URL}/api/git-watches`, { headers }),
                fetch(`${API_URL}/api/targets`, { headers }),
            ]);
            const w = await wRes.json();
            const t = await tRes.json();
            const all: Watch[] = w.watches ?? [];
            // A GROUP CONTAINS ITS FOLDERS, so it shows their watches too.
            //
            // Exact-match was wrong in the direction that hides things: a watch
            // on Notch.fm/Dev was invisible from Notch.fm, so the parent looked
            // like it had no automation while deploying on every push. Scoping
            // should narrow what you see as you go DOWN, not make the top level
            // the emptiest place in the tree.
            //
            // The prefix needs the slash. Without it 'Notch.fm' would also
            // match 'Notch.fmOther', which is a different group entirely.
            setWatches(all.filter(x => inScope(x.group_path ?? '', group)));
            const list: Target[] = Array.isArray(t) ? t : (t.targets ?? []);
            setTargets(list.filter(x => inScope(x.group ?? '', group)));
        } catch {
            toast.error('Could not load auto-deploy settings');
        }
    }, [group, token]);

    useEffect(() => { void load(); }, [load]);

    /**
     * Turning auto-approve ON is the one action here that removes a safety
     * step, so it is the one that asks. Turning it OFF just restores the pause
     * and needs no ceremony.
     */
    const confirmAutoApprove = async (pipelineLabel: string) => {
        return confirm({
            title: 'Skip approval gates on every push?',
            message:
                `Pushes to this branch will run "${pipelineLabel}" straight through its approval ` +
                `gates with nobody looking at the plan first. Anything that pipeline deploys, it ` +
                `deploys on a push.\n\n` +
                `Manual runs of the same pipeline still stop at the gate - this only applies to ` +
                `runs this watch starts.\n\n` +
                `Reasonable for a dev environment. Think harder about production.`,
            confirmText: 'Yes, skip gates on push',
            isDangerous: true,
        });
    };

    const add = async () => {
        if (!pipelineTarget || !repoUrl) {
            toast.error('Pick a pipeline and enter a repository URL');
            return;
        }
        if (autoApprove) {
            const label = targets.find(t => t.id === pipelineTarget)?.appName ?? pipelineTarget;
            if (!(await confirmAutoApprove(label))) return;
        }
        setBusy(true);
        try {
            // Check the remote BEFORE saving. A watch against a URL this server
            // cannot read is silent: it never fires, and looks identical to a
            // branch nobody has pushed to.
            const probe = await fetch(`${API_URL}/api/git-watches/probe`, {
                method: 'POST', headers, body: JSON.stringify({ repoUrl, branch }),
            }).then(r => r.json());

            if (!probe.ok) {
                toast.error(`Cannot read ${branch} from that repository: ${probe.error ?? 'unknown error'}`);
                setBusy(false);
                return;
            }

            // The watch belongs where the PIPELINE lives, not where you happened
            // to be standing when you created it. Saving the viewing group would
            // file a Notch.fm/Dev pipeline's watch under Notch.fm, where it would
            // then vanish the moment somebody opened Dev to look for it.
            const groupPath = targets.find(t => t.id === pipelineTarget)?.group ?? group;

            const res = await fetch(`${API_URL}/api/git-watches`, {
                method: 'POST', headers,
                body: JSON.stringify({ pipelineTarget, groupPath, repoUrl, branch, pollSeconds, autoApprove }),
            });
            if (!res.ok) throw new Error((await res.json()).error ?? 'failed');
            toast.success(`Watching ${branch}. The current commit is adopted without deploying; the next push runs it.`);
            setAdding(false);
            setRepoUrl(''); setBranch('main'); setAutoApprove(false); setPipelineTarget('');
            await load();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const patch = async (w: Watch, body: Record<string, unknown>) => {
        try {
            await fetch(`${API_URL}/api/git-watches/${w.id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
            await load();
        } catch { toast.error('Could not update that watch'); }
    };

    /**
     * Editing an existing watch, rather than deleting and re-adding it.
     *
     * Branch and interval only. Which PIPELINE a watch runs is not editable on
     * purpose: that is a different watch wearing the same row, and its history
     * of what it deployed would no longer be about the thing it points at.
     */
    const startEdit = (w: Watch) => {
        setEditing(w.id);
        setEditBranch(w.branch);
        setEditPoll(String(w.poll_seconds));
    };

    const saveEdit = async (w: Watch) => {
        const branch = editBranch.trim();
        if (!branch) { toast.error('A watch needs a branch to follow'); return; }
        // Floor matches the server's, so the UI cannot promise a 5-second poll
        // the server will quietly turn into 15.
        const poll = Math.max(15, Number(editPoll) || w.poll_seconds);
        const body: Record<string, unknown> = {};
        if (branch !== w.branch) body.branch = branch;
        if (poll !== w.poll_seconds) body.pollSeconds = poll;
        // PATCH answers 400 to an empty body, so a save that changed nothing is
        // closed here rather than sent and reported as a failure.
        if (Object.keys(body).length === 0) { setEditing(null); return; }
        await patch(w, body);
        setEditing(null);
    };

    const toggleAutoApprove = async (w: Watch) => {
        if (!w.auto_approve) {
            const label = targets.find(t => t.id === w.pipeline_target)?.appName ?? w.pipeline_target;
            if (!(await confirmAutoApprove(label))) return;
        }
        await patch(w, { autoApprove: !w.auto_approve });
    };

    const remove = async (w: Watch) => {
        if (!await confirm({
            title: 'Delete this watch?',
            message: `Pushes to ${w.branch} will stop deploying. Nothing already deployed changes.`,
            confirmText: 'Delete', isDangerous: true,
        })) return;
        try {
            await fetch(`${API_URL}/api/git-watches/${w.id}`, { method: 'DELETE', headers });
            await load();
        } catch { toast.error('Could not delete that watch'); }
    };

    const pipelineName = (id: string) => targets.find(t => t.id === id)?.appName ?? id;

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-400">
                Runs a pipeline when a branch moves. This server checks the remote on a timer
                rather than receiving a webhook, because it usually has no address the forge
                could call back on - so nothing needs opening up, and any git host works.
            </p>

            {watches.length === 0 && !adding && (
                <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
                    <GitBranch className="mx-auto mb-2 h-6 w-6 text-slate-500" />
                    <p className="text-sm text-slate-400">No branches watched in this group or below it.</p>
                </div>
            )}

            {watches.map(w => (
                <div key={w.id} className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <GitBranch className="h-4 w-4 shrink-0 text-emerald-400" />
                                <span className="font-medium text-white truncate">{pipelineName(w.pipeline_target)}</span>
                                {w.enabled
                                    ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">on</span>
                                    : <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">paused</span>}
                                {!!w.auto_approve && (
                                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-amber-400/30">
                                        skips gates
                                    </span>
                                )}
                                {/* Only for watches that live further down. Labelling
                                    the ones belonging to THIS group would be noise on
                                    every row of a leaf group. */}
                                {relativePath(w.group_path ?? '', group) && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/60 px-2 py-0.5 text-xs text-slate-300">
                                        <FolderTree className="h-3 w-3" />
                                        {relativePath(w.group_path ?? '', group)}
                                    </span>
                                )}
                            </div>
                            {editing === w.id ? (
                                /* EDIT IN PLACE, rather than delete-and-recreate.
                                   Changing which branch a watch follows used to mean
                                   removing it and adding it back, which loses the
                                   remembered sha and the row's history for what is
                                   usually a one-word change. The PATCH route has
                                   always supported this; only the UI did not. */
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs text-slate-500">
                                        {w.repo_url} #
                                    </span>
                                    <input
                                        value={editBranch}
                                        onChange={e => setEditBranch(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') void saveEdit(w);
                                            if (e.key === 'Escape') setEditing(null);
                                        }}
                                        autoFocus
                                        placeholder="branch"
                                        className="w-40 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-xs text-white"
                                    />
                                    <span className="text-xs text-slate-500">every</span>
                                    <input
                                        type="number"
                                        min={15}
                                        value={editPoll}
                                        onChange={e => setEditPoll(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') void saveEdit(w);
                                            if (e.key === 'Escape') setEditing(null);
                                        }}
                                        className="w-20 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white"
                                    />
                                    <span className="text-xs text-slate-500">seconds</span>
                                </div>
                            ) : (
                                <p className="mt-1 truncate font-mono text-xs text-slate-400">
                                    {w.repo_url} <span className="text-slate-500">#</span>{w.branch}
                                    <span className="text-slate-500"> · every {w.poll_seconds}s</span>
                                </p>
                            )}
                            {editing === w.id && editBranch.trim() !== w.branch && (
                                /* SAID BEFORE SAVING, because it looks like data loss
                                   afterwards. The server clears the remembered sha when
                                   the branch changes, so the next check adopts the new
                                   branch's head instead of deploying it - otherwise
                                   pointing a watch at a different branch would fire a
                                   deploy for a commit that is not new. */
                                <p className="mt-1 text-xs text-amber-300/80">
                                    Changing the branch starts from that branch's current head:
                                    the next check adopts it, and the push after that deploys.
                                </p>
                            )}
                            <p className="mt-1 text-xs text-slate-500">
                                {w.last_error ? (
                                    <span className="text-rose-400 inline-flex items-center gap-1">
                                        <XCircle className="h-3 w-3" /> {w.last_error}
                                    </span>
                                ) : w.last_triggered_sha ? (
                                    <span className="inline-flex items-center gap-1">
                                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                        last deployed {w.last_triggered_sha.slice(0, 7)}
                                    </span>
                                ) : w.last_sha ? (
                                    <>watching from {w.last_sha.slice(0, 7)} — next push deploys</>
                                ) : (
                                    <>not checked yet</>
                                )}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {editing === w.id ? (
                                <>
                                    <button onClick={() => void saveEdit(w)}
                                        className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 inline-flex items-center gap-1">
                                        <Check className="h-3.5 w-3.5" /> Save
                                    </button>
                                    <button onClick={() => setEditing(null)}
                                        className="rounded-lg border border-slate-600 p-1.5 text-slate-400 hover:bg-slate-800">
                                        <X className="h-4 w-4" />
                                    </button>
                                </>
                            ) : (
                                <button onClick={() => startEdit(w)} title="Edit branch and interval"
                                    className="rounded-lg border border-slate-600 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
                                    <Pencil className="h-4 w-4" />
                                </button>
                            )}
                            <button onClick={() => void patch(w, { enabled: !w.enabled })}
                                className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">
                                {w.enabled ? 'Pause' : 'Resume'}
                            </button>
                            <button onClick={() => void toggleAutoApprove(w)}
                                className={`rounded-lg border px-2.5 py-1 text-xs ${w.auto_approve
                                    ? 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10'
                                    : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
                                {w.auto_approve ? 'Require approval' : 'Skip approval'}
                            </button>
                            <button onClick={() => void remove(w)}
                                className="rounded-lg border border-slate-600 p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}

            {adding ? (
                <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                    <select value={pipelineTarget} onChange={e => setPipelineTarget(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white">
                        <option value="">Pipeline to run…</option>
                        {targets.map(t => <option key={t.id} value={t.id}>{t.appName}</option>)}
                    </select>
                    <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
                        placeholder="git@github.com:owner/repo.git"
                        className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-white" />
                    <div className="flex gap-3">
                        <input value={branch} onChange={e => setBranch(e.target.value)} placeholder="main"
                            className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-white" />
                        <input type="number" min={15} value={pollSeconds}
                            onChange={e => setPollSeconds(Number(e.target.value))}
                            className="w-32 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white" />
                    </div>

                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <input type="checkbox" checked={autoApprove}
                            onChange={e => setAutoApprove(e.target.checked)} className="mt-0.5" />
                        <span className="text-xs">
                            <span className="flex items-center gap-1.5 font-medium text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5" /> Skip approval gates on push
                            </span>
                            <span className="mt-0.5 block text-slate-400">
                                Push-triggered runs go straight through without anybody reading the plan.
                                Manual runs still stop. You will be asked to confirm.
                            </span>
                        </span>
                    </label>

                    <div className="flex gap-2">
                        <button disabled={busy} onClick={() => void add()}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                            {busy ? 'Checking the remote…' : 'Add watch'}
                        </button>
                        <button disabled={busy} onClick={() => setAdding(false)}
                            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
                    <Plus className="h-4 w-4" /> Watch a branch
                </button>
            )}
        </div>
    );
};

export default GitWatchManager;
