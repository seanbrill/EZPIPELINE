import React, { useEffect, useState } from 'react';
import { PipelinePicker } from "../../components/Shared/PipelinePicker";
import BuildTerminal from '../../components/BuildTerminal';
import { formatDuration, formatDurationCompact } from '../../helpers/formatDuration';
import { readJSON, writeJSON } from '../../helpers/persistedState';
import { stepProgress } from '../../helpers/stepProgress';
import PipelineSettingsModal from '../../components/PipelineSettingsModal';
import FileTreeSidebar from '../../components/FileTreeSidebar';
import CreatePipelineModal from '../../components/CreatePipelineModal';
import CreateGroupModal from '../../components/CreateGroupModal';
import Terminal from '../../components/Terminal';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { Play, Folder, Plus, Trash2, CheckCircle, Loader, XCircle, Circle, Square, Clock, AlertTriangle, Copy, Settings, ChevronRight, Key, PauseCircle, LayoutGrid, FileText, GitCommit, RotateCcw } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import API_URL from '../../config/api';
import GroupConfigModal from '../../components/GroupConfigModal';

// ... interfaces ...

interface Pipeline {
    id: string;
    appName: string;
    description: string;
    version: string;
    group?: string;
    filePath?: string;
    env?: string;
    requireConfirmation?: boolean;
}



/** Live log lines kept in memory. Older lines fall off the top. */
const LOG_BUFFER_MAX = 5000;

export interface BuildHistoryEntry {
    /** The build's own uuid. `buildNumber` is the build's real number. */
    id: string;
    buildNumber: number;
    pipelineName: string;
    pipelineId: string;
    group: string;
    /**
     * 'paused' is a build waiting on an approval step. The server writes it at
     * EZPipelineController.ts:1035; this union omitted it, so a paused build
     * matched no branch: no status icon, and a Delete button where Abort
     * belongs. The Approve button was gated on 'running', which a paused build
     * is by definition not - so the only way to release a gate was a curl.
     */
    status: 'running' | 'paused' | 'success' | 'failed' | 'aborted' | 'error';
    startTime: string;
    endTime?: string;
    duration?: number;
    steps: Array<{
        name: string;
        /**
         * What the step IS, as the pipeline declared it. Absent for ordinary
         * steps; 'approval' marks a gate.
         *
         * The Approve button used to be drawn by matching the step's NAME
         * against "approv" or "gate", because the server did not send this.
         * A gate named "Authorise the first change to production" matched
         * neither and could not be released from the UI at all.
         */
        type?: string;
        status: 'pending' | 'running' | 'success' | 'failed' | 'error';
        startTime?: string;
        endTime?: string;
        duration?: number;
        description?: string;
        continueOnError?: boolean;  // For status display logic
        /** Median of recent successful runs, ms. Absent until there is history. */
        estimatedDuration?: number;
        /** Epoch ms this run started the step. */
        startedAt?: number;
    }>;
    triggeredBy: string;
    activeStep?: string;
    /** What the run contained. Empty when its workspace held no repository. */
    commits?: Commit[];
    /** The head it built at. Present even when the commit list is not. */
    commitSha?: string | null;
    /** What it produced. `rollbackable` is false for a mutable tag like latest. */
    artifacts?: Artifact[];
}

export interface Commit {
    sha: string;
    shortSha: string;
    author: string;
    date: string;
    subject: string;
}

export interface Artifact {
    reference: string;
    tag: string | null;
    digest: string | null;
    /** 'marker' when the pipeline declared it, 'log' when we recognised it. */
    source: string;
    rollbackable: boolean;
}

/**
 * ONE HEIGHT FOR EVERY CONTROL ON A RUN ROW.
 *
 * They were four: the Logs button at py-1, Abort as a py-1 rounded-full pill,
 * Settings and Delete as bare p-1 icons, and a two-line time/duration block
 * stacked beside them. Nothing shared a baseline, so "vertically aligned" was
 * not something the row could be - each control was as tall as its own
 * padding plus its own content.
 *
 * Stating the height once removes the question. Icon-only buttons take
 * `aspect-square` with it so they are round-ish rather than tall and thin.
 */
const RUN_CTRL_H = "h-7";

/**
 * What a run contained, and what it produced.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING TO SAY. A pipeline that clones no
 * repository and builds no image has no provenance, and an empty strip under
 * every one of its runs would be a permanent reminder of a feature that does
 * not apply to it.
 *
 * The commit list is collapsed by default. "Nine commits" is the fact somebody
 * scanning the page wants; the nine subjects are what they want after they have
 * decided this is the run they are looking at.
 */
function RunProvenance({
    build,
    onRollback,
    busy,
}: {
    build: BuildHistoryEntry;
    onRollback: (build: BuildHistoryEntry) => void;
    busy: boolean;
}) {
    const [open, setOpen] = useState(false);
    const commits = build.commits ?? [];
    const artifacts = build.artifacts ?? [];
    const rollbackable = artifacts.filter(a => a.rollbackable);
    if (commits.length === 0 && artifacts.length === 0) return null;

    return (
        <div className="border-t border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {commits.length > 0 && (
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
                    aria-expanded={open}
                >
                    <GitCommit className="w-3.5 h-3.5" />
                    {commits.length} commit{commits.length === 1 ? '' : 's'}
                    <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
            )}

            {build.commitSha && (
                <span className="font-mono text-slate-500" title={build.commitSha}>
                    @{build.commitSha.slice(0, 7)}
                </span>
            )}

            {artifacts.map(a => (
                <span
                    key={a.reference}
                    // A mutable tag is drawn quieter than a fixed one, because
                    // it is the one you cannot go back to.
                    className={`font-mono px-1.5 py-0.5 rounded border ${a.rollbackable
                        ? 'text-cyan-300/90 border-cyan-500/25 bg-cyan-500/5'
                        : 'text-slate-500 border-slate-700'}`}
                    title={`${a.reference}${a.digest ? `\n${a.digest}` : ''}\nfound by: ${a.source}`}
                >
                    {a.tag ?? a.reference}
                </span>
            ))}

            {build.status === 'success' && rollbackable.length > 0 && (
                <button
                    onClick={() => onRollback(build)}
                    disabled={busy}
                    className="ml-auto flex items-center gap-1.5 text-amber-300/90 hover:text-amber-200 border border-amber-500/30 hover:border-amber-400/50 rounded px-2 py-1 transition-colors disabled:opacity-50"
                    title="Run this pipeline again, pinned to the images this run deployed"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {busy ? 'Starting...' : 'Roll back to this'}
                </button>
            )}

            {open && commits.length > 0 && (
                <ul className="w-full mt-1 flex flex-col gap-1 border-l border-slate-800 pl-3">
                    {commits.map(c => (
                        <li key={c.sha} className="flex items-baseline gap-2 min-w-0">
                            <span className="font-mono text-slate-500 shrink-0">{c.shortSha}</span>
                            <span className="text-slate-300 truncate" title={c.subject}>{c.subject}</span>
                            <span className="text-slate-600 shrink-0 ml-auto">{c.author}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * What the dashboard was looking at, so a refresh does not throw it away.
 *
 * Every reload dropped you back to "all groups, no pipeline picked", which on
 * an instance with more than one project means re-navigating before you can
 * see the thing you were already watching - and a refresh is the ordinary way
 * to check on a running build.
 *
 * Per browser, not per account: it is a view preference, not data. Nothing
 * here is authoritative, and everything read back out is checked against what
 * actually exists before it is used. See restoreIfStillThere.
 */
const SELECTION_KEY = 'ezpipeline.dashboard.selection';

interface StoredSelection {
    /** Group path. Absent or empty means "all groups", which is the default. */
    group?: string;
    /** Pipeline id for the Quick Run picker. */
    pipeline?: string;
}

function readSelection(): StoredSelection {
    const parsed = readJSON<StoredSelection>(SELECTION_KEY, {});
    // readJSON guarantees only that it parsed, not that it is the right shape:
    // an older version of this key could have held a string.
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeSelection(next: StoredSelection) {
    writeJSON(SELECTION_KEY, next);
}

/** Whether the sidebar was collapsed. Same reasoning as the selection. */
const SIDEBAR_KEY = 'ezpipeline.sidebar.collapsed';

const DashboardPage: React.FC = () => {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [buildHistory, setBuildHistory] = useState<BuildHistoryEntry[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    // Restored from the last visit, then VALIDATED once the real lists arrive -
    // see the setAllGroups and setPipelines calls. A remembered group that has
    // since been deleted or renamed would otherwise filter everything away and
    // leave an empty dashboard with nothing on screen to explain it.
    const [selectedGroup, setSelectedGroup] = useState<string | undefined>(
        () => readSelection().group || undefined
    );
    const [configuringGroup, setConfiguringGroup] = useState<string | undefined>(undefined);
    const [selectedPipelineForRun, setSelectedPipelineForRun] = useState<string>(
        () => readSelection().pipeline || ''
    );
    const [logsExpanded, setLogsExpanded] = useState(false);
    /** Which build is mid-rollback, so its button alone shows it. */
    const [rollingBack, setRollingBack] = useState<string | null>(null);
    const { token } = useAuth();
    const [logFilter, setLogFilter] = useState("");
    // What to open, not just which pipeline: the Logs button needs a tab and a
    // build id to land on.
    type ModalTarget = { pipeline: Pipeline; tab?: 'steps' | 'environment' | 'resources' | 'schedule' | 'history' | 'versions'; buildId?: string };
    const [activePipeline, setActivePipeline] = useState<ModalTarget | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(
        () => readJSON<boolean>(SIDEBAR_KEY, false)
    );
    const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
    const [newGroupName, setNewGroupName] = useState("");
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [groupParentPath, setGroupParentPath] = useState<string | undefined>(undefined);
    const [, setGroups] = useState<string[]>([]); // Added for setGroups in fetchPipelines
    const [isRunning, setIsRunning] = useState(false);
    const { confirm } = useConfirm();
    const toast = useToast();
    const [logsTab, setLogsTab] = useState<'logs' | 'terminal'>('logs');
    const [socket, setSocket] = useState<Socket | null>(null);

    const fetchPipelines = async () => {
        try {
            const response = await fetch(`${API_URL}/api/targets`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            setPipelines(data.targets || []);

            // Same rule as the remembered group: a remembered pipeline that is
            // gone must not stay in the picker. It would show an id where a
            // name belongs and arm a Run button pointed at nothing.
            setSelectedPipelineForRun(previous => {
                if (!previous) return previous;
                const stillThere = (data.targets || []).some((p: Pipeline) => p.id === previous);
                return stillThere ? previous : '';
            });

            // Extract unique groups
            const uniqueGroups = Array.from(new Set((data.targets || []).map((p: Pipeline) => p.group).filter(Boolean)));
            setGroups(['All', ...uniqueGroups as string[]]);
        } catch (error) {
            console.error('Error fetching pipelines:', error);
        }
    };

    const fetchBuildHistory = async () => {
        try {
            const query = selectedGroup && selectedGroup !== 'General' ? `?group=${encodeURIComponent(selectedGroup)}` : '';
            const response = await fetch(`${API_URL}/api/builds/history${query}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            // Sort by startTime DESC (newest first)
            const sorted = (data.history || [])
                .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
            setBuildHistory(sorted);
        } catch (error) {
            console.error('Error fetching build history:', error);
        }
    };

    /**
     * Run the pipeline again, pinned to what an earlier run deployed.
     *
     * CONFIRMED, because it deploys. Every other button on this row either
     * opens something or stops something; this one changes what is serving
     * traffic, and the tag it will pin is named in the question so the answer
     * is to a specific thing rather than to the word "rollback".
     */
    const rollbackTo = async (build: BuildHistoryEntry) => {
        const targets = (build.artifacts ?? []).filter(a => a.rollbackable);
        const tags = [...new Set(targets.map(a => a.tag).filter(Boolean))];
        if (!await confirm({
            title: `Roll back to build #${build.buildNumber}?`,
            message:
                `This starts ${build.pipelineName} again, pinned to ` +
                (tags.length === 1 ? `tag ${tags[0]}` : `${targets.length} recorded images`) +
                `. Nothing is rebuilt - it points the deployment at images that are already in the registry. ` +
                `The pipeline has to honour EZP_IMAGE_TAG for that to take effect.`,
            isDangerous: true,
            confirmText: "Roll back",
        })) return;

        setRollingBack(build.id);
        try {
            const res = await fetch(`${API_URL}/api/builds/${build.id}/rollback`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'Rollback could not be started');
            toast.success(body.message || 'Rolling back');
            fetchBuildHistory();
        } catch (e: any) {
            // The server's own sentence. It distinguishes "that run recorded no
            // fixed tag" from a generic failure, and only one of those has
            // something the reader can do about it.
            toast.error(e?.message || 'Rollback could not be started');
        } finally {
            setRollingBack(null);
        }
    };

    const deleteBuild = async (id: string) => {
        if (!await confirm({
            title: "Delete Build",
            message: "Are you sure you want to delete this build execution history?",
            confirmText: "Delete",
            isDangerous: true
        })) return;

        try {
            await fetch(`${API_URL}/api/builds/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            fetchBuildHistory();
        } catch (error) {
            console.error('Error deleting build:', error);
        }
    };

    const clearHistory = async (group?: string) => {
        if (!await confirm({
            title: group ? "Clear Group History" : "Clear All History",
            message: group ? `Clear build history for group '${group}' ? ` : "Clear ALL build history globally? This cannot be undone.",
            confirmText: "Clear All",
            isDangerous: true
        })) return;

        try {
            const query = group ? `?group=${encodeURIComponent(group)}` : '';
            await fetch(`${API_URL}/api/builds/history${query}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            fetchBuildHistory();
        } catch (error) {
            console.error('Error clearing history:', error);
        }
    };

    useEffect(() => {
        if (!token) return;
        // Initial fetch for pipelines and build history
        fetchPipelines();
        fetchBuildHistory();

        // A TICKET, not the session token.
        //
        // EventSource cannot set headers, so whatever authenticates it has to
        // travel in the URL - and a URL ends up in the server's access log, in
        // any proxy, in browser history and in the Referer of anything the page
        // loads next. This used to put the admin JWT there.
        //
        // The ticket is fetched over a normal authenticated POST, where headers
        // work, and is good for thirty seconds and one connection. It still
        // appears in the URL and that no longer matters.
        let eventSource: EventSource | null = null;
        let cancelled = false;

        void (async () => {
            try {
                const res = await fetch(`${API_URL}/api/logs-stream/ticket`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!res.ok) throw new Error(`ticket ${res.status}`);
                const { ticket } = await res.json();
                if (cancelled) return;
                eventSource = new EventSource(`${API_URL}/api/logs-stream?ticket=${encodeURIComponent(ticket)}`);
                wire(eventSource);
            } catch {
                setLogs((prev) => [...prev, '>>> Could not open the live stream <<<']);
            }
        })();

        function wire(es: EventSource) {
            es.onopen = () => {
                setLogs((prev) => [...prev, '>>> Connected to Live Stream <<<']);
            };

            es.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);

                if (payload.type === 'connected') return;

                // Handle Logs
                if (payload.message) {
                    // Bounded. This grew without limit, so a long build ended
                    // as an unresponsive tab rather than a finished deploy.
                    setLogs((prev) => {
                        const next = [...prev, payload.message];
                        return next.length > LOG_BUFFER_MAX
                            ? next.slice(next.length - LOG_BUFFER_MAX)
                            : next;
                    });
                    return;
                }

                // Handle Events
                const { type } = payload;
                if (!type) {
                    return;
                }

                if (type === 'progress' || type === 'build_start' || type === 'build_complete' || type === 'build_error' || type === 'build_aborted' || type === 'build_paused' || type === 'build_approved') {
                    // Refresh build history to get latest status
                    // Debounce or check?
                    // For now, just rely on fetch
                    fetchBuildHistory();
                }

                } catch (e) {
                    setLogs((prev) => [...prev, event.data]);
                }
            };
        }

        return () => {
            // Set before the stream may even exist: the ticket request is
            // async, so an unmount can land while it is still in flight and
            // the connection would otherwise be opened after cleanup ran.
            cancelled = true;
            eventSource?.close();
        };
    }, [token]);

    // Initialize Socket.IO
    useEffect(() => {
        if (!token) return;
        const newSocket = io(API_URL, { auth: { token }, reconnection: true });
        setSocket(newSocket);
        return () => { newSocket.disconnect(); };
    }, [token]);

    const runPipeline = async (target: string) => {
        if (isRunning) return;
        setIsRunning(true);
        const pipeline = pipelines.find(p => p.id === target);

        // Check if confirmation is required
        if (pipeline?.requireConfirmation) {
            if (!await confirm({
                title: "Confirmation Required",
                message: `You are about to run: "${pipeline.appName}"\nGroup: ${pipeline.group || 'General'} \n\nAre you sure you want to proceed ? `,
                confirmText: "Run Pipeline"
            })) {
                setIsRunning(false);
                return;
            }
            await executePipeline(target);
            return;
        }

        await executePipeline(target);
    };

    const executePipeline = async (target: string) => {
        setIsRunning(true);

        try {
            await fetch(`${API_URL}/api/run-pipeline`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ target }),
            });

        } catch (e) {
            toast.error('Failed to start pipeline');
        } finally {
            setIsRunning(false);
        }
    };

    // Get unique groups
    const [allGroups, setAllGroups] = useState<Set<string>>(new Set());
    const [fileTree, setFileTree] = useState<any[]>([]);

    const fetchGroups = async () => {
        try {
            const res = await fetch(`${API_URL}/api/config/files`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();

            setFileTree((data.yaml || []).filter((node: any) =>
                node.name !== 'General' || (node.children && node.children.length > 0)
            ));

            // Extract folders from YAML tree
            const folders = new Set<string>();
            const traverse = (nodes: any[]) => {
                nodes.forEach(node => {
                    if (node.type === 'directory') {
                        folders.add(node.path);
                        if (node.children) traverse(node.children);
                    }
                });
            };

            if (data.yaml) {
                traverse(data.yaml);
            }

            // Also merge from pipelines just in case
            pipelines.forEach(p => {
                if (p.group && p.group !== 'General') folders.add(p.group);
            });



            setAllGroups(folders);

            // A REMEMBERED GROUP THAT NO LONGER EXISTS IS WORSE THAN NONE.
            //
            // It filters every pipeline away, so the dashboard comes up empty
            // with nothing on screen saying why - and the cause is a group
            // deleted or renamed in a session the reader may not have been
            // part of. Checked here, where the authoritative list has just
            // arrived, rather than in an effect that would also fire on the
            // empty set before the first fetch and clear a valid choice.
            //
            // EXACT, or a group filed BENEATH it. Not "a parent of it exists".
            //
            // The first version of this also accepted `previous.startsWith(g)`,
            // reasoning that a parent still being there made the selection
            // valid. It does the opposite: "Notch.fm/Gone" passes on the
            // strength of "Notch.fm", so a deleted subgroup is remembered
            // forever and the dashboard stays empty. Tried it against the real
            // group list; it kept two of the three deleted cases.
            //
            // The descendant clause is kept because a group can exist only
            // implicitly: a pipeline filed at "A/B" puts "A/B" in this set
            // without "A" ever being a directory of its own.
            setSelectedGroup(previous => {
                if (!previous) return previous;
                const stillThere = Array.from(folders).some(
                    g => g === previous || g.startsWith(previous + '/')
                );
                return stillThere ? previous : undefined;
            });
        } catch (e) {
            console.error("Failed to fetch groups", e);
        }
    };

    useEffect(() => {
        if (!token) return;
        fetchGroups();
    }, [pipelines, token]);

    // Write the selection back on every change, including the ones made by the
    // validation above - so a group that has been deleted is forgotten rather
    // than cleared on screen and restored again on the next refresh.
    useEffect(() => {
        writeSelection({ group: selectedGroup, pipeline: selectedPipelineForRun });
    }, [selectedGroup, selectedPipelineForRun]);

    useEffect(() => {
        writeJSON(SIDEBAR_KEY, sidebarCollapsed);
    }, [sidebarCollapsed]);

    // A local clock, so a running step's bar advances between server updates
    // instead of jumping only when a step changes.
    //
    // ONLY WHILE SOMETHING IS RUNNING. A dashboard of finished builds must not
    // re-render once a second for the life of the tab. `paused` deliberately
    // does not count: a build waiting at an approval gate is waiting on a
    // person, and a bar creeping forward would be inventing progress.
    const [now, setNow] = useState(() => Date.now());
    const anyRunning = buildHistory.some(b => b.status === 'running');
    useEffect(() => {
        if (!anyRunning) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [anyRunning]);

    const createGroup = async (parentPath?: string) => {
        setGroupParentPath(parentPath);
        setShowGroupModal(true);
    };

    const confirmCreateGroup = async (name: string) => {
        // Construct full path
        const finalPath = groupParentPath ? `${groupParentPath}/${name}` : name;

        if (allGroups.has(finalPath)) {
            toast.error("Group name already exists!");
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/config/create-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ type: 'yaml', path: finalPath })
            });
            // fetch only rejects on a NETWORK failure, so an un-checked call
            // reported "Group created!" for a 400, a 403 and a 500 alike. With
            // the listing bug above it also meant a retry hit "Folder already
            // exists", got a 500, and was toasted as another success. Endless
            // green ticks, nothing ever appearing.
            if (!res.ok) {
                const detail = await res.json().catch(() => null);
                toast.error(detail?.error || detail?.message || `Could not create the group (${res.status}).`);
                return;
            }
            toast.success("Group created!");
            fetchGroups(); // Refresh groups from server
            setSelectedGroup(finalPath);
        } catch (e) {
            console.error(e);
            toast.error("Could not reach the server to create the group.");
        }
    };

    const deleteGroup = async (group: string) => {
        if (group === 'General') {
            toast.error("Cannot delete General group.");
            return;
        }

        // Check if pipelines exist in this group (or sub-groups)
        const hasPipelines = pipelines.some(p => p.group === group || p.group?.startsWith(group + '/'));
        if (hasPipelines) {
            toast.error(`Cannot delete group '${group}' because it contains pipelines. Please move or delete them first.`);
            return;
        } else {
            if (!await confirm({
                title: `Delete Group?`,
                message: `Delete group '${group}'?`,
                confirmText: "Delete",
                isDangerous: true
            })) return;
        }

        try {
            const res = await fetch(`${API_URL}/api/config/delete-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ type: 'yaml', path: group })
            });
            if (!res.ok) throw new Error("Failed");

            // Refresh
            setSelectedGroup("General");
            fetchPipelines();
            fetchGroups();
        } catch (e) {
            toast.error("Failed to delete group");
        }
    };

    const handleDropPipeline = async (e: React.DragEvent, group: string) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('pipeline');
        if (!data) return;

        const pipeline: Pipeline = JSON.parse(data);
        if (pipeline.group === group) return; // Same group
        if (!pipeline.filePath) return;

        if (!await confirm({
            title: "Move Pipeline?",
            message: `Move ${pipeline.appName} to ${group}?`,
            confirmText: "Move"
        })) return;

        try {
            const fileName = pipeline.filePath.split('/').pop();
            const newPath = group === 'General' ? fileName : `${group}/${fileName}`;

            await fetch(`${API_URL}/api/config/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    type: 'yaml',
                    currentPath: pipeline.filePath,
                    newPath
                })
            });
            fetchPipelines();
            fetchGroups(); // Refresh groups too
        } catch (e) {
            console.error(e);
            toast.error("Failed to move pipeline");
        }
    };

    const handleMovePipeline = async (sourcePath: string, targetFolder: string) => {
        // Find pipeline by checking if filePath includes the source path
        const pipeline = pipelines.find(p => p.filePath?.includes(sourcePath));
        if (!pipeline || !pipeline.filePath) return;

        // Extract current group from pipeline
        const currentGroup = pipeline.group || 'General';
        if (currentGroup === targetFolder) return; // Same folder

        if (!await confirm({
            title: "Move Pipeline?",
            message: `Move ${pipeline.appName} to ${targetFolder}?`,
            confirmText: "Move"
        })) return;

        try {
            // Extract pipeline bundle directory name from source path
            const bundleName = sourcePath.split('/').pop();
            const newPath = targetFolder ? `${targetFolder}/${bundleName}` : bundleName;

            await fetch(`${API_URL}/api/config/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    type: 'yaml',
                    currentPath: sourcePath,
                    newPath
                })
            });
            fetchPipelines();
            fetchGroups();
            toast.success('Pipeline moved successfully');
        } catch (e) {
            console.error(e);
            toast.error("Failed to move pipeline");
        }
    };



    const triggerRenameGroup = (group: string) => {
        setRenamingGroup(group);
        // Extract just the folder name from the full path
        const folderName = group.split('/').pop() || group;
        setNewGroupName(folderName);
    };

    const performRenameGroup = async () => {
        if (!renamingGroup || !newGroupName) {
            setRenamingGroup(null);
            return;
        }

        // Extract parent path and old folder name
        const pathParts = renamingGroup.split('/');
        const oldFolderName = pathParts.pop();
        const parentPath = pathParts.join('/');

        // If name unchanged, cancel
        if (newGroupName === oldFolderName) {
            setRenamingGroup(null);
            return;
        }

        // Construct new full path
        const newFullPath = parentPath ? `${parentPath}/${newGroupName}` : newGroupName;

        try {
            // Rename the folder on the backend
            await fetch(`${API_URL}/api/config/rename-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    type: 'yaml',
                    oldPath: renamingGroup,
                    newPath: newFullPath
                })
            });

            // Update selected group if it was the renamed one
            if (selectedGroup === renamingGroup) {
                setSelectedGroup(newFullPath);
            }

            setRenamingGroup(null);
            fetchPipelines();
            fetchGroups();
            toast.success('Folder renamed successfully');
        } catch (e) {
            console.error(e);
            toast.error("Failed to rename folder");
        }
    };

    /**
     * Which pipeline a tree path refers to.
     *
     * The tree deals in bundle directories ("Notch.fm/Prod/deploy-prod") and a
     * pipeline knows its own file ("…/deploy-prod/pipeline.yaml"), so the match
     * is on the directory plus the filename.
     */
    const pipelineAtPath = (path: string) =>
        pipelines.find(p => p.filePath?.endsWith(`${path}/pipeline.yaml`));

    /**
     * Clicking a pipeline in the tree ARMS IT, it does not open the editor.
     *
     * It used to throw the settings modal over the whole dashboard, so the
     * common act of choosing which pipeline to look at cost a modal and a
     * dismissal, and browsing the tree meant opening and closing a YAML editor
     * repeatedly. Editing is the rarer intent, and it has two buttons of its
     * own: beside Run, and on the tree row itself.
     *
     * Selecting the group as well is what makes this work rather than merely
     * appear to. The Quick Run picker is fed from the pipelines in the CURRENT
     * group, so arming one filed somewhere else would set a value the picker
     * cannot display: a Run button aimed at a name nobody can see.
     */
    const handleSelectPipeline = (path: string) => {
        const found = pipelineAtPath(path);
        if (!found) return;
        if (!inSelectedGroup(found.group)) setSelectedGroup(found.group || undefined);
        setSelectedPipelineForRun(found.id);
    };

    /**
     * Open the editor for a pipeline named in the tree.
     *
     * THE ROUTE THAT DOES NOT NEED A BUILD. The gear on a run row was the only
     * other one, and a pipeline that has never run has no run row - so once
     * clicking the tree stopped opening the editor, a newly created pipeline
     * could not be opened at all.
     */
    const handleOpenPipeline = (path: string) => {
        const found = pipelineAtPath(path);
        if (found) setActivePipeline({ pipeline: found });
    };

    const groupsList = Array.from(allGroups).sort();
    // Show pipelines from selected group AND all child groups
    // NO GROUP SELECTED MEANS EVERYTHING, not "the ones filed at the root".
    //
    // Both of these used to return only General when nothing was selected, so
    // the default view of a dashboard with two projects on it was empty, and
    // seeing any run at all meant first guessing which group it belonged to.
    // The heading says "Pipelines" in that state, not "General pipelines",
    // which is the reading this now matches.
    const inSelectedGroup = (group: string | undefined) => {
        if (selectedGroup === undefined) return true;
        const g = group || "";
        // The group itself, or anything filed beneath it.
        return g === selectedGroup || g.startsWith(selectedGroup + '/');
    };

    // Top-level groups only: the rail has room for one row of icons, and
    // FileFreak/Server/Kubernetes collapses to the same FileFreak button that
    // FileFreak/Client does. Clicking one selects it; expanding shows the rest.
    const topLevelGroups = Array.from(
        new Set(
            pipelines
                .map(p => (p.group || '').split('/')[0])
                .filter(g => g && g !== 'General')
        )
    ).sort();

    const filteredPipelines = pipelines.filter(p => inSelectedGroup(p.group));

    // THE BUILD'S OWN NUMBER, not its position in this list.
    //
    // This used to be `array.length - index`, which renumbered every build by
    // where it happened to sit in whatever page had been fetched. Two things
    // followed. The visible number CAPPED at the page size - the newest build
    // read #100 forever while the database was already at #103, which is how
    // this was reported. And the number was not stable: the same build was
    // called something different tomorrow, and the rollback confirmation
    // ("Roll back to build #N?") named a build by a number that had already
    // moved, while the pipeline itself was handed the real build_number.
    //
    // The server has sent the real one all along, as `buildNumber`.
    const filteredBuildHistory = buildHistory.filter(b => inSelectedGroup(b.group));

    return (
        <div className="flex flex-col h-full bg-[var(--color-bg)]">
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className={`bg-[var(--color-surface)] border-r border-slate-700 flex flex-col pt-4 flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-12' : 'w-64'}`}>
                    {!sidebarCollapsed ? (
                        <div className="flex-1 flex flex-col min-h-0">
                            <FileTreeSidebar
                                fileTree={fileTree}
                                selectedGroup={selectedGroup || ''}
                                onSelectGroup={setSelectedGroup}
                                onSelectPipeline={handleSelectPipeline}
                                onOpenPipeline={handleOpenPipeline}
                                onCreateGroup={createGroup}
                                onDeleteGroup={deleteGroup}
                                onRenameGroup={triggerRenameGroup}
                                onDropPipeline={handleDropPipeline}
                                onMovePipeline={handleMovePipeline}
                                collapsed={sidebarCollapsed}
                                onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
                                className="flex-1"
                            />
                        </div>
                    ) : (
                        /* COLLAPSED: an icon rail, not an empty strip.
                           This used to render one chevron and nothing else, so
                           collapsing the sidebar did not save space - it removed
                           navigation entirely, and the only way back to a group
                           was to expand again. One button per top-level group,
                           selection still visible, so the rail is usable rather
                           than merely narrow. */
                        <div className="flex flex-col items-center gap-1 px-1">
                            <button
                                onClick={() => setSidebarCollapsed(false)}
                                className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors mb-2"
                                title="Expand sidebar"
                                aria-label="Expand sidebar"
                                aria-expanded={false}
                            >
                                <ChevronRight className="w-5 h-5 text-emerald-500" />
                            </button>

                            <button
                                onClick={() => setSelectedGroup(undefined)}
                                title="All pipelines"
                                aria-label="All pipelines"
                                aria-current={selectedGroup === undefined ? 'true' : undefined}
                                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors border ${
                                    selectedGroup === undefined
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : 'text-slate-400 border-transparent hover:bg-slate-700 hover:text-white'
                                }`}
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>

                            {topLevelGroups.map((g) => {
                                // Highlighted when it is the selected group OR an
                                // ancestor of it, so drilling into Notch.fm/Dev
                                // still shows Notch.fm as where you are.
                                const active = selectedGroup === g || (selectedGroup?.startsWith(g + '/') ?? false);
                                return (
                                    <button
                                        key={g}
                                        onClick={() => setSelectedGroup(g)}
                                        title={g}
                                        aria-label={g}
                                        aria-current={active ? 'true' : undefined}
                                        className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center transition-colors border ${
                                            active
                                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                                : 'text-slate-400 border-transparent hover:bg-slate-700 hover:text-white'
                                        }`}
                                    >
                                        <Folder className="w-4 h-4" />
                                        <span className="text-[9px] leading-none mt-0.5 font-semibold">
                                            {g.slice(0, 2).toUpperCase()}
                                        </span>
                                    </button>
                                );
                            })}

                            <button
                                onClick={() => setShowCreateModal(true)}
                                title="New pipeline"
                                aria-label="New pipeline"
                                className="w-10 h-10 mt-2 rounded-lg flex items-center justify-center text-slate-400 border border-transparent hover:bg-emerald-600 hover:text-white transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <div className="p-4 border-t border-slate-700">
                        {!sidebarCollapsed && (
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                            >
                                <Plus className="w-4 h-4" /> New Pipeline
                            </button>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg)]">
                    {/* Quick Run Bar */}
                    <div className="bg-[var(--color-surface)] border-b border-slate-700/50 p-4 flex-shrink-0 z-10 shadow-sm">
                        <h2 className="text-lg font-bold text-[var(--color-text)] whitespace-nowrap mb-7">Quick Run</h2>
                        <div className="flex gap-4 items-center p-4 bg-[var(--color-surface)] border border-[var(--color-text-muted)]/25 rounded-lg shadow-sm">
                            <span className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Quick Run</span>
                            {filteredPipelines.length > 0 ? (
                                <div className="flex gap-2 flex-1">
                                    {/* Was a native <select>, which cannot be searched, cannot
                                        group, and dealt with two pipelines sharing a name by
                                        appending "(group)" to both. See PipelinePicker. */}
                                    <PipelinePicker
                                        className="flex-1 max-w-md"
                                        pipelines={filteredPipelines}
                                        value={selectedPipelineForRun}
                                        onChange={setSelectedPipelineForRun}
                                    />
                                    <button
                                        onClick={() => selectedPipelineForRun && runPipeline(selectedPipelineForRun)}
                                        disabled={!selectedPipelineForRun}
                                        className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 text-white px-6 py-2 rounded font-medium transition-colors flex items-center gap-2"
                                    >
                                        <Play className="w-4 h-4" />
                                        Run
                                    </button>
                                    {/* THE WAY TO THE EDITOR THAT DOES NOT NEED A BUILD.
                                        The other one is the gear on a run row, which a
                                        pipeline that has never run does not have - so
                                        until this existed, a newly created pipeline
                                        could not be opened at all once clicking it in
                                        the tree stopped doing so. It sits beside Run
                                        because that is where the selection now lives:
                                        this is the pipeline you have picked, here is
                                        running it and here is editing it. */}
                                    <button
                                        onClick={() => {
                                            const p = pipelines.find(x => x.id === selectedPipelineForRun);
                                            if (p) setActivePipeline({ pipeline: p });
                                        }}
                                        disabled={!selectedPipelineForRun}
                                        className="bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/40 disabled:cursor-not-allowed disabled:opacity-40 text-slate-300 hover:text-white border border-slate-700 px-4 py-2 rounded font-medium transition-colors flex items-center gap-2"
                                        title="Edit this pipeline: steps, environment, resources, schedule"
                                    >
                                        <Settings className="w-4 h-4" />
                                        Settings
                                    </button>
                                </div>
                            ) : (
                                <p className="text-[var(--color-text-muted)] text-sm">Select a group or create a pipeline</p>
                            )}
                        </div>
                    </div>

                    {/* Build History List */}
                    <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4 custom-scrollbar">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                    <Folder className="w-6 h-6 text-emerald-500" />
                                    {selectedGroup ? `${selectedGroup} Pipelines` : 'Pipelines'}
                                </h2>
                                <p className="text-[var(--color-text-muted)] text-sm mt-1">Recent builds for this group</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {selectedGroup && (
                                    <button
                                        onClick={() => setConfiguringGroup(selectedGroup)}
                                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 hover:border-emerald-500/50 px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                                        title={`Environment and resources shared by every pipeline in ${selectedGroup}`}
                                    >
                                        <Key className="w-3.5 h-3.5" />
                                        Group Config
                                    </button>
                                )}
                                <button
                                    onClick={() => clearHistory(selectedGroup || undefined)}
                                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                                    title={selectedGroup ? `Clear history for ${selectedGroup}` : "Clear root history"}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Clear History
                                </button>
                            </div>
                        </div>

                        {filteredBuildHistory.length > 0 ? (
                            filteredBuildHistory.map((build) => (
                                <div key={build.id} className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden hover:border-slate-600 transition-colors">
                                    <div className="p-4 bg-slate-900/50 border-b border-slate-700 flex items-center justify-between gap-4">
                                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                                            <span className="text-slate-400 font-mono text-sm">#{build.buildNumber}</span>
                                            <span className="text-white font-semibold">{build.pipelineName}</span>
                                            {/* Who started it. A push-triggered run is the one nobody
                                                was watching, so it is worth telling apart from a run
                                                somebody chose to start and is sitting in front of. */}
                                            {build.triggeredBy && (
                                                <span
                                                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                                        build.triggeredBy.startsWith('git watch')
                                                            ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/30'
                                                            : 'bg-slate-700/60 text-slate-300'
                                                    }`}
                                                    title={
                                                        build.triggeredBy.startsWith('git watch')
                                                            ? `Started automatically: ${build.triggeredBy}`
                                                            : `Started by ${build.triggeredBy}`
                                                    }
                                                >
                                                    {build.triggeredBy.startsWith('git watch') ? '⟳ auto' : '⏵'}
                                                    <span className="font-mono">
                                                        {build.triggeredBy.startsWith('git watch')
                                                            ? build.triggeredBy.replace('git watch ', '')
                                                            : build.triggeredBy}
                                                    </span>
                                                </span>
                                            )}
                                            <span className={`flex items-center gap-1.5 text-sm ${build.status === 'success' ? 'text-emerald-400' :
                                                build.status === 'running' ? 'text-blue-400' :
                                                build.status === 'paused' ? 'text-amber-300' :
                                                    build.status === 'failed' ? (
                                                        // Check if any step failed with continueOnError
                                                        build.steps?.some((s: any) => s.status === 'failed' && s.continueOnError) ? 'text-amber-400' : 'text-red-400'
                                                    ) :
                                                        build.status === 'error' ? 'text-amber-400' :
                                                            'text-slate-400'
                                                }`}>
                                                {build.status === 'success' && <CheckCircle className="w-4 h-4" />}
                                                {build.status === 'running' && <Loader className="w-4 h-4 animate-spin" />}
                                                {build.status === 'paused' && <PauseCircle className="w-4 h-4" />}
                                                {build.status === 'failed' && (
                                                    build.steps?.some((s: any) => s.status === 'failed' && s.continueOnError) ?
                                                        <AlertTriangle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />
                                                )}
                                                {build.status === 'error' && <AlertTriangle className="w-4 h-4" />}
                                                <span className="capitalize">{build.status === 'failed' && build.steps?.some((s: any) => s.status === 'failed' && s.continueOnError) ? 'Warning' : build.status}</span>
                                            </span>
                                            {/* WHEN and HOW LONG are facts about the run, so they
                                                sit with the rest of them. They used to be stacked in
                                                the right-hand group beside the buttons, which is what
                                                made that side impossible to align: a two-line block
                                                next to a row of icons has no shared baseline. */}
                                            <span className="theme-text-muted text-sm font-medium tabular-nums">
                                                {new Date(build.startTime).toLocaleTimeString()}
                                            </span>
                                            {build.duration !== undefined && build.duration > 0 && (
                                                <span className={`${RUN_CTRL_H} flex items-center gap-1 text-xs text-emerald-400/80 bg-emerald-400/10 px-2 rounded-full border border-emerald-400/20`}>
                                                    <Clock className="w-3 h-3" />
                                                    {formatDuration(build.duration)}
                                                </span>
                                            )}
                                        </div>

                                        {/* EVERY CONTROL, ON THE RIGHT, IN ONE GROUP.
                                            Logs and Abort used to live in the left-hand group among
                                            the run's details - and Abort carried `ml-auto`, which
                                            pushed it to the right edge of THAT group while the
                                            parent was already doing justify-between. Two things
                                            competing to place one button is why the spacing looked
                                            arbitrary and moved as the details either side of it
                                            changed width.
                                            Information reads left to right; the things you can press
                                            are always in the same place, whatever the run says. */}
                                        <div className="flex shrink-0 items-center gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const p = pipelines.find(x => x.id === build.pipelineId);
                                                    if (p) setActivePipeline({ pipeline: p, tab: 'history', buildId: build.id });
                                                    else toast.error('That run\'s pipeline no longer exists');
                                                }}
                                                title="Open this run's logs"
                                                aria-label={`Open logs for build ${build.buildNumber}`}
                                                className={`${RUN_CTRL_H} text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 hover:border-emerald-500/50 px-2.5 rounded transition-colors flex items-center gap-1.5`}
                                            >
                                                <FileText className="w-3.5 h-3.5" />
                                                Logs
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const pipeline = pipelines.find(p => p.id === build.pipelineId);
                                                    if (pipeline) {
                                                        setActivePipeline({ pipeline });
                                                    }
                                                }}
                                                className={`${RUN_CTRL_H} aspect-square text-slate-500 hover:text-emerald-400 transition-colors hover:bg-slate-800 rounded flex items-center justify-center`}
                                                title="Open pipeline settings"
                                                aria-label="Open pipeline settings"
                                            >
                                                <Settings className="w-4 h-4" />
                                            </button>
                                            {(build.status === 'running' || build.status === 'paused') ? (
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (!await confirm({
                                                            title: "Abort Pipeline",
                                                            message: "Are you sure you want to stop this running pipeline?",
                                                            isDangerous: true,
                                                            confirmText: "Abort"
                                                        })) return;

                                                        await fetch(`${API_URL}/api/builds/${build.id}/abort`, {
                                                            method: 'POST',
                                                            headers: { Authorization: `Bearer ${token}` }
                                                        });
                                                        fetchBuildHistory();
                                                    }}
                                                    className={`${RUN_CTRL_H} bg-red-600/10 hover:bg-red-600/30 text-red-400 border border-red-500/30 px-3 text-xs rounded font-bold transition-all flex items-center gap-1`}
                                                >
                                                    <Square className="w-3 h-3 fill-current" /> Abort
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deleteBuild(build.id);
                                                    }}
                                                    className={`${RUN_CTRL_H} aspect-square text-slate-500 hover:text-red-400 rounded hover:bg-slate-700 transition-all flex items-center justify-center`}
                                                    title="Delete Build"
                                                    aria-label="Delete build"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="p-4 bg-slate-900/30">
                                        <div className="flex flex-wrap gap-2">
                                            {build.steps.map((step, idx) => (
                                                // min-h so a card is not as short as its own text. Step
                                                // names here run to four or five wrapped lines - "Is this
                                                // pipeline running its own current definition" - and the
                                                // duration and bar are pinned to the bottom with mt-auto,
                                                // so a short name used to give a squat card sitting beside
                                                // a tall one with no room around either.
                                                <div key={idx} title={step.description} className={`flex-1 min-w-[120px] min-h-[7.5rem] rounded-lg p-3 border transition-colors flex flex-col ${step.status === 'running' ? 'bg-slate-900 border-blue-500/50 shadow-sm shadow-blue-500/10' :
                                                    step.status === 'success' ? 'bg-slate-900 border-emerald-900/50' :
                                                        step.status === 'failed' ? 'bg-red-950/20 border-red-500/50 shadow-sm shadow-red-500/10' :
                                                            step.status === 'error' ? 'bg-amber-950/20 border-amber-500/50 shadow-sm shadow-amber-500/10' :
                                                                'bg-slate-900/50 border-slate-800 opacity-60'
                                                    }`}>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className={`text-sm font-medium ${step.status === 'running' ? 'text-blue-400' :
                                                            step.status === 'success' ? 'text-emerald-400' :
                                                                step.status === 'failed' ? 'text-red-400' :
                                                                    step.status === 'error' ? 'text-amber-400' :
                                                                        'text-slate-500'
                                                            }`}>{step.name}</span>

                                                        {step.status === 'running' && <Loader className="w-3 h-3 text-blue-500 animate-spin" />}
                                                        {step.status === 'success' && <CheckCircle className="w-3 h-3 text-emerald-500" />}
                                                        {step.status === 'failed' && <XCircle className="w-3 h-3 text-red-500" />}
                                                        {step.status === 'error' && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                                                        {step.status === 'pending' && <Circle className="w-3 h-3 text-slate-700" />}
                                                    </div>

                                                    {(() => {
                                                        // An approval gate never carries an estimate - the server
                                                        // withholds it, because a gate's duration is how long
                                                        // somebody took to click - so stepProgress returns null
                                                        // for one and it keeps the indeterminate bar.
                                                        const fraction = step.status === 'running'
                                                            ? stepProgress(step.estimatedDuration, step.startedAt, now)
                                                            : null;
                                                        const elapsed = step.status === 'running' && step.startedAt
                                                            ? Math.max(0, now - step.startedAt)
                                                            : null;
                                                        return (
                                                            <>
                                                                {/* ONE LINE, ALWAYS. This row is the last thing above
                                                                    the progress bar and used to be locked to h-4, so
                                                                    the longer running text wrapped to a second line
                                                                    and the bar was drawn straight over it. Now it
                                                                    cannot wrap, cannot overflow, and the row can grow
                                                                    if a future format ever needs it to. */}
                                                                <div
                                                                    className="text-slate-500 text-xs font-mono mb-1 min-h-4 mt-auto whitespace-nowrap overflow-hidden text-ellipsis"
                                                                    title={step.duration
                                                                        ? formatDuration(step.duration)
                                                                        : elapsed !== null
                                                                            ? `${formatDuration(elapsed)} so far${step.estimatedDuration ? `, usually about ${formatDuration(step.estimatedDuration)}` : ''}`
                                                                            : undefined}
                                                                >
                                                                    {step.duration
                                                                        ? formatDuration(step.duration)
                                                                        : elapsed !== null
                                                                            // Elapsed AND the usual time, which is the
                                                                            // whole point: "2m10s / ~40s" says this run
                                                                            // is slow, where "..." never did. Compact,
                                                                            // because two long-form durations do not fit
                                                                            // a 120px card. The full wording is on hover.
                                                                            ? <>{formatDurationCompact(elapsed)}
                                                                                {step.estimatedDuration
                                                                                    ? <span className="text-slate-600"> / ~{formatDurationCompact(step.estimatedDuration)}</span>
                                                                                    : null}
                                                                            </>
                                                                            : step.status === 'running' ? '...' : '--'}
                                                                </div>

                                                                <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                                                                    {fraction !== null ? (
                                                                        <div
                                                                            className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
                                                                            style={{ width: `${(fraction * 100).toFixed(1)}%` }}
                                                                            title={`about ${Math.round(fraction * 100)}% of the usual time for this step`}
                                                                        />
                                                                    ) : (
                                                                        <div className={`h-full transition-all duration-500 ${step.status === 'running' ? 'bg-blue-500 w-full animate-pulse' :
                                                                            step.status === 'success' ? 'bg-emerald-500 w-full' :
                                                                                step.status === 'failed' ? 'bg-red-500 w-full' :
                                                                                    step.status === 'error' ? 'bg-amber-500 w-full' :
                                                                                        'w-0'
                                                                            }`}></div>
                                                                    )}
                                                                </div>
                                                            </>
                                                        );
                                                    })()}

                                                    {/* Approval Button - Only for 'approval' steps.
                                                        Decided by the step's declared TYPE, which is
                                                        what the pipeline actually says. This used to
                                                        match the NAME against "approv" or "gate", so a
                                                        gate called "Authorise the first change to
                                                        production" got no button and a production run
                                                        could only be released with a curl. 'running' is
                                                        still accepted alongside 'paused' because a gate
                                                        is genuinely parked either way. */}
                                                    {(build.status === 'paused' || build.status === 'running') && build.activeStep === step.name && step.type === 'approval' && (
                                                        <div className="mt-3 flex justify-center">
                                                            <button
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    if (!await confirm({
                                                                        title: "Approve Step",
                                                                        message: "Confirm approval to resume pipeline execution?",
                                                                        confirmText: "Approve & Resume"
                                                                    })) return;

                                                                    await fetch(`${API_URL}/api/builds/${build.id}/approve`, {
                                                                        method: 'POST',
                                                                        headers: { Authorization: `Bearer ${token}` }
                                                                    });
                                                                    fetchBuildHistory();
                                                                }}
                                                                className="w-full bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/50 px-2 py-1 text-[10px] uppercase tracking-wide rounded font-bold transition-all animate-pulse flex items-center justify-center gap-1"
                                                            >
                                                                <CheckCircle className="w-3 h-3" /> Approve
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <RunProvenance
                                            build={build}
                                            onRollback={rollbackTo}
                                            busy={rollingBack === build.id}
                                        />
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="flex flex-col items-center justify-center p-16 border border-dashed border-[var(--color-text-muted)]/30 rounded-xl bg-[var(--color-text-muted)]/5">
                                <div className="p-4 bg-[var(--color-surface)] rounded-full mb-4 ring-1 ring-[var(--color-text-muted)]/20 shadow-lg">
                                    <Clock className="w-8 h-8 text-[var(--color-text-muted)]" />
                                </div>
                                <h3 className="text-lg font-medium text-[var(--color-text)] mb-1">No builds history</h3>
                                <p className="text-sm text-[var(--color-text-muted)]">Executions will appear here</p>
                            </div>
                        )}
                    </div>

                    {/* Expandable Server Logs / Terminal */}
                    <div
                        className="border-t border-slate-700 flex-shrink-0 bg-black overflow-hidden transition-all duration-500 ease-in-out flex flex-col"
                        style={{ height: logsExpanded ? '24rem' : '69px' }}
                    >
                        <div
                            className="cursor-pointer hover:bg-slate-950 transition-colors flex-shrink-0"
                            onClick={() => setLogsExpanded(!logsExpanded)}
                        >
                            <div className="px-5 py-3 flex justify-between items-center">
                                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                                    {logsExpanded ? (
                                        <div className="flex gap-4" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => setLogsTab('logs')}
                                                className={`px-3 py-1 rounded transition-colors ${logsTab === 'logs' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-300 hover:text-white'}`}
                                            >
                                                Logs
                                            </button>
                                            <button
                                                onClick={() => setLogsTab('terminal')}
                                                className={`px-3 py-1 rounded transition-colors ${logsTab === 'terminal' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-300 hover:text-white'}`}
                                            >
                                                Terminal
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            Logs {logsExpanded && <span className="text-xs text-slate-600 font-normal normal-case ml-2">(Live Server Output)</span>}
                                        </>
                                    )}
                                    {logsExpanded && logsTab === 'logs' && buildHistory[0]?.status === 'running' && (() => {
                                        const runningStep = buildHistory[0].steps.find(s => s.status === 'running');
                                        return runningStep?.description ? (
                                            <span className="hidden md:inline-flex items-center gap-2 ml-4 px-3 py-1 bg-slate-900 border border-slate-700 rounded-full text-xs text-emerald-400 font-medium normal-case animate-pulse">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                {runningStep.description}
                                            </span>
                                        ) : null;
                                    })()}
                                </h2>
                                <div className="flex items-center gap-3">
                                    {logsExpanded && logsTab === 'logs' && (
                                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="text"
                                                placeholder="Filter logs..."
                                                value={logFilter}
                                                onChange={(e) => setLogFilter(e.target.value)}
                                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-emerald-500 outline-none w-48 transition-all"
                                            />
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const logsText = logs.join('\n');
                                                    navigator.clipboard.writeText(logsText);
                                                }}
                                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition-colors flex items-center gap-1 border border-slate-700"
                                                title="Copy all logs to clipboard"
                                            >
                                                <Copy className="w-3 h-3" /> Copy
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setLogs([]);
                                                    setLogFilter("");
                                                }}
                                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition-colors flex items-center gap-1 border border-slate-700"
                                            >
                                                <Trash2 className="w-3 h-3" /> Clear
                                            </button>
                                        </div>
                                    )}
                                    <span className="text-xl text-slate-500 font-mono">
                                        {logsExpanded ? '−' : '+'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        {logsExpanded && (
                            <div className="border-t border-slate-800 flex-1 min-h-0">
                                {logsTab === 'logs' ? (
                                    <BuildTerminal
                                        logs={logFilter
                                            ? logs.filter(l => l.toLowerCase().includes(logFilter.toLowerCase()))
                                            : logs
                                        }
                                    />
                                ) : (
                                    <Terminal socket={socket} />
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* Modal */}
            {
                activePipeline && (
                    <PipelineSettingsModal
                        pipeline={activePipeline.pipeline}
                        openTab={activePipeline.tab}
                        openBuildId={activePipeline.buildId}
                        onClose={() => setActivePipeline(null)}
                        onUpdate={() => { fetchPipelines(); fetchGroups(); }}
                        availableGroups={groupsList}
                    />
                )
            }

            {/* Rename Group Modal */}
            {
                renamingGroup && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                        <div className="bg-[var(--color-surface)] rounded-xl p-6 w-96 border border-slate-700 shadow-2xl">
                            <h3 className="text-lg font-semibold text-white mb-4">Rename Group</h3>
                            <input
                                type="text"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') performRenameGroup();
                                    if (e.key === 'Escape') setRenamingGroup(null);
                                }}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white mb-4 focus:border-emerald-500 outline-none"
                                placeholder="New group name"
                                autoFocus
                            />
                            <div className="flex gap-2 justify-end">
                                <button
                                    onClick={() => setRenamingGroup(null)}
                                    className="px-4 py-2 text-slate-400 hover:text-white transition-colors text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={performRenameGroup}
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium text-sm"
                                >
                                    Rename
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showCreateModal && (
                    <CreatePipelineModal
                        onClose={() => setShowCreateModal(false)}
                        onCreated={() => { fetchPipelines(); fetchGroups(); }}
                        availableGroups={groupsList}
                        defaultGroup={selectedGroup}
                    />
                )
            }

            {
                showGroupModal && (
                    <CreateGroupModal
                        parentPath={groupParentPath}
                        onClose={() => setShowGroupModal(false)}
                        onConfirm={confirmCreateGroup}
                    />
                )
            }

            {/* ConfirmationModal removed - handled by Global Context */}
        {configuringGroup && (
                <GroupConfigModal
                    group={configuringGroup}
                    onClose={() => setConfiguringGroup(undefined)}
                />
            )}
        </div>
    );
};

export default DashboardPage;
