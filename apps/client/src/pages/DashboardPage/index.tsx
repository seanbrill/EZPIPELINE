import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PipelinePicker } from "../../components/Shared/PipelinePicker";
import BuildTerminal from '../../components/BuildTerminal';
import { formatDuration, formatDurationCompact } from '../../helpers/formatDuration';
import { formatBuildTime } from "../../helpers/formatBuildTime";
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
import { Play, Folder, Plus, Trash2, CheckCircle, Loader, XCircle, Circle, Square, Clock, AlertTriangle, Copy, Settings, ChevronRight, ChevronDown, ChevronsUpDown, ChevronsDownUp, Key, PauseCircle, LayoutGrid, FileText, GitCommit, RotateCcw } from 'lucide-react';
import { EnvTag } from '../../components/Shared/EnvTag';
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
    /**
     * The pipeline's `environment:` key - whatever it says, not a fixed set.
     * /api/targets spreads the parsed yaml, so this has always been on the
     * wire; nothing on this page read it.
     */
    environment?: string;
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
    /** The pipeline's `environment:` key, for the tag. Absent is fine. */
    environment?: string;
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
        status: 'pending' | 'running' | 'success' | 'failed' | 'error' | 'aborted';
        startTime?: string;
        endTime?: string;
        duration?: number;
        description?: string;
        continueOnError?: boolean;  // For status display logic
        /** For type 'action': what pressing the button will do, in order. */
        actions?: { do: string; [key: string]: unknown }[];
        /**
         * For type 'action': ask before doing it.
         *
         * Two shapes, chosen per button. A read-only or easily undone action
         * wants one press. "Merge to main and deploy production" wants to be
         * asked, in the same words the approval gate uses, because the cost of
         * a mis-click is a release.
         */
        confirm?: boolean;
        /**
         * For type 'action': stay disabled until every step ABOVE it has
         * succeeded.
         *
         * Position-relative rather than "wait for the whole pipeline", which
         * is the same thing for a button at the end and a different, useful
         * thing anywhere else. Everything needed to evaluate it is already
         * here: the step list is ordered and each entry carries a status.
         */
        requirePriorSteps?: boolean;
        /**
         * For `type: action`: whether the button is refused on any run but the
         * newest for this pipeline.
         *
         * For an action that operates on the CURRENT state of something -
         * "promote to production" merges whatever develop points at now -
         * pressing it from an older card does not do what the card implies. It
         * does not promote THAT run; it promotes today's head, from a row
         * describing last Tuesday.
         */
        requireLatestBuild?: boolean;
        /**
         * For `type: action`: the step in a NEWER run of this pipeline at
         * which this button stops working. Absent means the old behaviour -
         * any newer run at all refuses it.
         *
         * The point is that a new run EXISTING is not what makes an older
         * card's promote wrong; the new run having got far enough to change
         * what the promote would merge is. Several commits pushed in a row
         * each start a build, and the button was gone before anybody could
         * reach it, refused by a run that had so far only checked out a
         * branch.
         */
        requireLatestBuildUntilStep?: string;
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
/**
 * Whether a run is parked waiting for a person, and on which step.
 *
 * DERIVED THE SAME WAY THE APPROVE BUTTON IS, deliberately. The button renders
 * when the build is running or paused, the step is the active one, and its
 * declared type is 'approval'. If this used a looser rule - "status is paused"
 * - a collapsed card would flash for runs with no button waiting on them, and
 * a flash that sometimes means nothing is a flash people learn to ignore.
 */
function awaitingPerson(build: BuildHistoryEntry): string | null {
    if (build.status !== 'paused' && build.status !== 'running') return null;
    const step = (build.steps ?? []).find(
        s => s.name === build.activeStep && s.type === 'approval'
    );
    return step ? step.name : null;
}

/**
 * One bar standing in for every step of a run, for a card whose steps are
 * collapsed out of view.
 *
 * ── WHY SEGMENTS AND NOT A SINGLE FILLED TRACK ─────────────────────────────
 *
 * A single fill can only say how FAR along a run is. This has to say how far
 * along AND whether anything went wrong, because when the card is collapsed
 * there is nothing else on screen that can: a run that failed at step 4 of 23
 * and a run cleanly waiting at step 4 of 23 would draw the identical bar.
 *
 * One segment per step, coloured by that step's own status, is still read as
 * a single bar at a glance - and up close it is a map of the run. The failed
 * segment sits where the failure happened rather than being averaged away.
 *
 * ── THE THREE THINGS IT MUST SAY WITHOUT BEING CLICKED ─────────────────────
 *
 *   failed     the track turns red, and the segment that failed is red
 *   waiting    the bar flashes amber - somebody has to press something
 *   running    the live segment fills against its own estimate
 *
 * The running segment borrows stepProgress, which is the same estimate the
 * expanded step card draws, so collapsing a card never changes what the
 * progress is claimed to be. Its honesty notes apply here unchanged: no
 * history means an indeterminate segment rather than an invented number.
 */
/**
 * How long a run has been WORKING for.
 *
 * ── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 *
 * `build.duration` arrives from the server as the sum of FINISHED steps, and a
 * step is only given a duration when it ends. So while a run is in flight the
 * one step actually doing the work contributes nothing at all, and the pill
 * reports the run as having taken however long everything BEFORE the current
 * step took.
 *
 * Reported 2026-09-20 against a dev build sitting on "Do the migrations build
 * the schema the code expects" at 4m1s, with the pill reading 34s - which is
 * exactly 0.9 + 3.7 + 0.1 + 0.4 + 14 + 3.9 + 2.1 + 8.6, the eight steps that
 * had finished.
 *
 * ── WHY NOT JUST now - startTime ───────────────────────────────────────────
 *
 * Because the server's definition is deliberate and worth keeping: it walks
 * the pipeline summing step durations and SKIPS approval steps. A prod run
 * parks on "Approve this rollout" until a person gets to it, and a pill that
 * said 3h because somebody approved after lunch would be reporting how
 * available Sean was, not how long the build took. Wall clock would throw that
 * away. Adding the running step's own elapsed time keeps the meaning and fixes
 * the arithmetic.
 *
 * Ticks, because `now` does.
 */
function runDuration(build: BuildHistoryEntry, now: number): number {
    const base = build.duration ?? 0;
    // Only a live run has a step still accruing. A finished one is already
    // whole, and an aborted one must stop counting - see the note in
    // RunProgressBar about the clock that ran for forty-five minutes.
    if (build.status !== 'running' && build.status !== 'paused') return base;
    const running = (build.steps ?? []).find(
        (s: any) => s.status === 'running' && typeof s.startedAt === 'number'
    );
    if (!running) return base;
    return base + Math.max(0, now - (running as any).startedAt);
}

function RunProgressBar({ build, now }: { build: BuildHistoryEntry; now: number }) {
    const steps = build.steps ?? [];
    const waitingOn = awaitingPerson(build);
    const failed = build.status === 'failed' || build.status === 'error';

    // A run whose steps never arrived. Drawing an empty track would say
    // "nothing has happened yet", which is a claim about the run rather than
    // about what is known of it.
    if (steps.length === 0) {
        return (
            <div className="h-1.5 rounded-full bg-slate-800/80" title="No steps recorded for this run" />
        );
    }

    const done = steps.filter(s => s.status === 'success').length;
    const buildLive = build.status === 'running' || build.status === 'paused';

    return (
        <div className="flex items-center gap-3">
            <div
                /* THE FLASH IS ON THE WORK THAT HAS NOT HAPPENED, not on the
                   whole bar. Flashing the container took the completed green
                   segments down with it, so at the dim end of the cycle a run
                   that had done nineteen steps looked like it had done none -
                   the movement cost the very information the bar exists to
                   carry, and read as a rendering fault rather than a prompt.
                   Now the finished segments stay solid, the gate and the
                   steps still ahead of it flash amber, and the eye is pulled
                   to where the run actually stopped. */
                className={`flex h-1.5 flex-1 gap-px overflow-hidden rounded-full ${
                    failed ? 'bg-red-950' : waitingOn ? 'bg-amber-950/70' : 'bg-slate-800'
                }`}
                role="img"
                aria-label={
                    waitingOn
                        ? `Waiting for approval on ${waitingOn}. ${done} of ${steps.length} steps complete.`
                        : `${done} of ${steps.length} steps complete, ${build.status}.`
                }
            >
                {steps.map((step, idx) => {
                    // The gate that is holding the run wears the attention
                    // colour itself, so expanding the card leads the eye
                    // straight to the step the flash was about.
                    const isWaiting = waitingOn !== null && step.name === waitingOn;
                    const running = step.status === 'running' && buildLive;
                    const fraction = running ? stepProgress(step.estimatedDuration, step.startedAt, now) : null;

                    // Ahead of a gate that is holding the run: amber and
                    // flashing, so the pulse is a region rather than one
                    // four-percent sliver nobody notices on a 23 step run.
                    const pending = step.status === 'pending';
                    let fill = waitingOn && pending ? 'bg-amber-500/30 run-attention' : 'bg-slate-700/40';
                    if (isWaiting) fill = 'bg-amber-400 run-attention';
                    else if (step.status === 'success') fill = 'bg-emerald-500';
                    else if (step.status === 'failed') fill = step.continueOnError ? 'bg-amber-500' : 'bg-red-500';
                    else if (step.status === 'error') fill = 'bg-amber-500';
                    else if (step.status === 'aborted') fill = 'bg-slate-600';
                    else if (running) fill = 'bg-blue-500';

                    // An estimate exists, so the segment fills against it
                    // rather than sitting solid the whole time it runs.
                    if (running && !isWaiting && fraction !== null) {
                        return (
                            <div
                                key={idx}
                                className="relative flex-1 bg-slate-700/40"
                                title={`${step.name} - running`}
                            >
                                <div
                                    className="absolute inset-y-0 left-0 bg-blue-500 transition-[width] duration-1000 ease-linear"
                                    style={{ width: `${Math.round(fraction * 100)}%` }}
                                />
                            </div>
                        );
                    }

                    return (
                        <div
                            key={idx}
                            className={`flex-1 ${fill} ${running && !isWaiting ? 'animate-pulse' : ''}`}
                            title={`${step.name}${step.status ? ` - ${step.status}` : ''}`}
                        />
                    );
                })}
            </div>

            {/* The count in words, because a bar of 23 thin segments is a
                shape rather than a number, and "17 / 23" is the thing worth
                reading out loud. */}
            <span
                className={`shrink-0 font-mono text-[11px] tabular-nums ${
                    failed ? 'text-red-400' : waitingOn ? 'text-amber-300' : 'text-slate-500'
                }`}
            >
                {waitingOn ? 'needs you' : `${done}/${steps.length}`}
            </span>
        </div>
    );
}

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
    /**
     * The build whose abort is in flight.
     *
     * Sean: "when I clicked abort the ui hung for a second before actually
     * showing the aborted status". It was not hung - it was working. Abort now
     * signals the step's process group and waits for the write, then this page
     * refetches the history, and BOTH round trips happened with the button
     * still reading "Abort" and still looking pressable.
     *
     * A control that does nothing visible for a second is a control people
     * press twice. Keyed by build id because this lives inside a list.
     */
    const [aborting, setAborting] = useState<string | null>(null);

    /**
     * The newest run of each pipeline, by id.
     *
     * buildHistory is sorted newest-first at fetch time, so the first row for
     * a pipeline is its latest - no timestamps compared here, and no second
     * definition of "latest" to drift from that sort.
     */
    const latestBuildPerPipeline = useMemo(() => {
        const newest = new Map<string, string>();
        for (const b of buildHistory) {
            if (b.id && !newest.has(b.pipelineId)) newest.set(b.pipelineId, b.id);
        }
        return newest;
    }, [buildHistory]);
    /**
     * For each run, the runs of the SAME pipeline that came after it.
     *
     * Same sort as above and for the same reason: buildHistory arrives
     * newest-first, so "newer than this one" is "already seen while walking
     * the list". No timestamps compared here either.
     *
     * Needed because "is this the latest run" turned out to be the wrong
     * question. `requireLatestBuildUntilStep` asks a better one - has anything
     * newer got far enough to change what this button would act on - and that
     * needs the newer runs themselves, not just the newest one's id.
     */
    const newerRunsPerBuild = useMemo(() => {
        const out = new Map<string, typeof buildHistory>();
        const seen = new Map<string, typeof buildHistory>();
        for (const b of buildHistory) {
            if (!b.id) continue;
            const older = seen.get(b.pipelineId) ?? [];
            out.set(b.id, older.slice());
            older.push(b);
            seen.set(b.pipelineId, older);
        }
        return out;
    }, [buildHistory]);
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

    /* ── WHICH RUNS ARE SHOWING THEIR STEPS ─────────────────────────────────
     *
     * COLLAPSED IS THE DEFAULT, and the set below holds the exceptions. A
     * provision pipeline draws twenty-three step cards at seven-and-a-half
     * rems each; a handful of runs is already several screens of scrolling
     * before the one being looked for is on it. The condensed bar says which
     * run failed, which is waiting, and how far the rest got, which is what
     * the list is being scanned for in the first place.
     *
     * Storing the EXPANDED ids rather than the collapsed ones matters: a run
     * this browser has never seen - one that finished while the tab was shut,
     * which is most of them - is absent from the set and therefore collapsed,
     * without anything having to write an entry for it first.
     */
    const [expandedBuilds, setExpandedBuilds] = useState<string[]>(
        () => readJSON<string[]>('ezpipeline.expandedBuilds', [])
    );
    const expandedSet = useMemo(() => new Set(expandedBuilds), [expandedBuilds]);
    /** Which build is mid-rollback, so its button alone shows it. */
    const [rollingBack, setRollingBack] = useState<string | null>(null);
    /** Which anytime action is in flight, as "<buildId>:<stepName>". */
    const [actionBusy, setActionBusy] = useState<string | null>(null);
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

    /**
     * Which group the page is showing, readable from callbacks made earlier.
     *
     * ── THE CLOSURE THAT KEPT PUTTING THE WRONG GROUP BACK ──────────────────
     *
     * fetchBuildHistory is called from five places, and one of them is the SSE
     * handler inside the effect keyed on [token]. That effect is created ONCE,
     * at mount, so the function it calls closed over whatever selectedGroup was
     * at mount and never saw another value.
     *
     * A running build emits events constantly, and every one of them refetched
     * THE GROUP FROM PAGE LOAD and wrote it over whatever the user had just
     * selected. The server log is unambiguous about it:
     *
     *   22:37:10  ?group=Notch.fm/Prod      the click
     *   22:37:12  ?group=Notch.fm/Dev       two seconds later, unprompted
     *
     * So the panel was right for a moment and then silently wrong, which is
     * exactly the "sometimes" in the report - and why clicking a pipeline
     * appeared to fix it: that fires a fresh correct fetch which wins until the
     * next event arrives.
     *
     * A ref rather than a dependency on the SSE effect, because adding one
     * would tear down and rebuild a live EventSource every time somebody clicks
     * a folder, dropping the stream that carries running-build output.
     */
    const selectedGroupRef = useRef(selectedGroup);
    useEffect(() => {
        selectedGroupRef.current = selectedGroup;
    }, [selectedGroup]);

    const fetchBuildHistory = async () => {
        // The CURRENT group, never the one this function was created beside.
        const group = selectedGroupRef.current;
        try {
            const query = group && group !== 'General' ? `?group=${encodeURIComponent(group)}` : '';
            const response = await fetch(`${API_URL}/api/builds/history${query}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();

            // ── AND DISCARD AN ANSWER ABOUT A GROUP NOBODY IS LOOKING AT ────
            //
            // Two requests can be in flight at once - a click and an SSE event
            // land together - and without this the LAST to resolve wins rather
            // than the most recent to be asked. That is the same wrong panel by
            // a different route, and it is the one that would survive the fix
            // above.
            if (selectedGroupRef.current !== group) return;

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
    /**
     * Press an anytime action.
     *
     * The chain stops at the first failure server-side, and the response lists
     * what every attempted action did - so a half-completed chain reports
     * "merged, then could not start the deploy" rather than one word. That
     * distinction is the whole reason the outcomes come back at all.
     */
    const runAction = async (
        build: BuildHistoryEntry,
        stepName: string,
        needsConfirm: boolean,
        summary: string
    ) => {
        if (needsConfirm) {
            const ok = await confirm({
                title: stepName,
                message: `This will ${summary}. Continue?`,
                confirmText: "Do it",
            });
            if (!ok) return;
        }
        setActionBusy(`${build.id}:${stepName}`);
        try {
            const res = await fetch(`${API_URL}/api/builds/${build.id}/action`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ step: stepName }),
            });
            const body = await res.json().catch(() => ({}));
            const outcomes: { action: string; ok: boolean; message: string }[] = body.outcomes ?? [];
            const done = outcomes.filter(o => o.ok).map(o => o.action).join(", ");
            const failed = outcomes.find(o => !o.ok);

            if (res.ok && !failed) {
                toast.success(`${stepName}: ${done || "done"}`);
            } else if (failed) {
                // Name what DID happen before what did not. A chain that merged
                // and then failed has changed something, and a message that
                // only says "failed" hides that.
                toast.error(
                    `${stepName}: ${done ? `${done}, then ` : ""}${failed.action} failed - ${failed.message}`
                );
            } else {
                toast.error(`${stepName}: ${body.error ?? "failed"}`);
            }
            fetchBuildHistory();
        } catch (e) {
            toast.error(`${stepName}: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionBusy(null);
        }
    };

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

    /**
     * Re-read the history whenever the selected group changes.
     *
     * ── THE ACTUAL BUG BEHIND "THE HISTORY IS NOT ADAPTING" ─────────────────
     *
     * fetchBuildHistory sends `?group=<selected>` and the server filters on it
     * properly, descendants included. But the only effect that called it
     * depended on [token], so it ran ONCE at mount and never again. Every later
     * click changed which group the client filtered by while the data underneath
     * stayed whatever the group at mount had asked for.
     *
     * That is why the symptoms looked contradictory. Selecting Notch.fm showed
     * only Prod runs, because Prod was the group restored from localStorage at
     * mount and the fetch had asked for Prod alone. Selecting Dev showed NOTHING,
     * because the client then filtered that Prod-only list for Dev. And a page
     * refresh "fixed" it because a refresh re-mounts, which re-fetches, with
     * whatever group was persisted.
     *
     * ── ITS OWN EFFECT, NOT A DEPENDENCY ON THE ONE ABOVE ───────────────────
     *
     * Adding selectedGroup to that effect's deps would tear down and rebuild the
     * EventSource on every click in the tree, which is a live SSE connection
     * carrying running-build output. Changing which builds you are looking at
     * must not drop the stream that fills them.
     */
    useEffect(() => {
        if (!token) return;
        fetchBuildHistory();
        // fetchBuildHistory is redefined every render, so it is deliberately
        // not a dependency: naming it here is an infinite refetch loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, selectedGroup]);

    useEffect(() => {
        if (!token) return;
        // Initial fetch for pipelines. The history is the effect above, which
        // also covers mount - it runs with the group restored from storage.
        fetchPipelines();

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
    /**
     * Pick a GROUP from the tree.
     *
     * ── IT HAS TO LET GO OF THE PIPELINE, AND THE LAST FIX FORGOT TO ────────
     *
     * The build list filters on the selected group AND, since pipeline
     * selection started narrowing it, on the armed pipeline. Nothing cleared
     * that pipeline when the group changed, so navigating from one group to
     * another left a filter pinned to a pipeline that is not in the new group -
     * and the two conditions together match nothing.
     *
     * What that looks like is the bug as reported: "as I click on the different
     * groups the pipeline history is not adapting, says no build history".
     * Empty, not stale, and NOT explained by the heading either: the heading
     * looks up the armed pipeline by id, does not find it in the new group, and
     * falls back to the group name. So the page says "Notch.fm/Prod Pipelines"
     * over an empty list while Prod has a fortnight of builds.
     *
     * It also explains why clicking a pipeline fixed it: that arms one which IS
     * in the group, so the filter starts matching again.
     *
     * CLEARED ONLY WHEN IT NO LONGER APPLIES. Blanking it on every group click
     * would throw away a deliberate Quick Run arming when somebody merely
     * clicks the group that pipeline lives in - which is the normal way to
     * navigate to it.
     */
    const handleSelectGroup = (group: string | undefined) => {
        setSelectedGroup(group);
        if (!selectedPipelineForRun) return;
        const armed = pipelines.find(p => p.id === selectedPipelineForRun);
        const stillApplies =
            group === undefined ||
            (armed && ((armed.group || "") === group || (armed.group || "").startsWith(group + "/")));
        if (!stillApplies) setSelectedPipelineForRun('');
    };

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
    // ── THE TREE SELECTS A PIPELINE AND THIS LIST IGNORED IT ────────────
    //
    // Clicking a pipeline in the sidebar sets selectedPipelineForRun, and this
    // filtered on the GROUP alone - so choosing a pipeline inside the group you
    // were already in changed nothing at all. The tree highlighted the row, the
    // run dropdown switched, and the history underneath carried on showing
    // every pipeline in the group. Reported as the history "not updating and
    // confusing", which is exactly right: the page had two controls claiming a
    // selection and one list disagreeing with both.
    //
    // FILTERED, AND THEN SAID OUT LOUD. Narrowing silently is the other half of
    // the same problem - a list that quietly holds one pipeline's builds looks
    // identical to a group that only ever ran one. The heading below names what
    // is being shown and offers a way back.
    // `appName`, not `name`. Pipeline has no `name`, so this was always
    // undefined and the heading it feeds - the one that exists to say WHICH
    // pipeline is being shown - rendered nothing at all. The type error was
    // sitting in the build the whole time saying so.
    const selectedPipelineName = selectedPipelineForRun
        ? pipelines.find(p => p.id === selectedPipelineForRun)?.appName
        : undefined;
    const filteredBuildHistory = buildHistory.filter(
        b =>
            inSelectedGroup(b.group) &&
            (!selectedPipelineForRun || b.pipelineId === selectedPipelineForRun)
    );

    /**
     * How many build rows are actually rendered.
     *
     * ── WHY THIS IS NEEDED AT ALL ──────────────────────────────────────────
     *
     * One build card draws a card per STEP, and the notch.fm deploy has 19 of
     * them. At 204 builds that is close to four thousand step cards in the
     * document, each with its own bar, icons and duration.
     *
     * It is worst exactly when somebody is watching: `now` ticks once a second
     * while any build is running, and every one of those cards reconciles on
     * every tick. The guard above stops that happening on an idle dashboard;
     * it cannot make four thousand cards cheap during a deploy.
     *
     * Ten at a time, more as you reach the bottom. The rows are already sorted
     * newest-first, so the first ten are the ones anybody opened the page for.
     */
    const PAGE = 10;
    const [visibleBuilds, setVisibleBuilds] = useState(PAGE);
    const visibleBuildHistory = filteredBuildHistory.slice(0, visibleBuilds);

    /* ── EXPANDING AND COLLAPSING ───────────────────────────────────────────
     *
     * The stored list is PRUNED to the runs currently known on every write.
     * Without that it only ever grows: every card ever expanded leaves an id
     * behind, including for builds long since deleted, and the preference
     * that survives a refresh slowly becomes a list of everything the browser
     * has ever seen.
     */
    const setExpanded = (ids: string[]) => {
        const known = new Set(buildHistory.map(b => b.id));
        const pruned = Array.from(new Set(ids)).filter(id => known.has(id));
        setExpandedBuilds(pruned);
        writeJSON('ezpipeline.expandedBuilds', pruned);
    };

    const toggleBuildExpanded = (id: string) => {
        setExpanded(expandedSet.has(id)
            ? expandedBuilds.filter(x => x !== id)
            : [...expandedBuilds, id]);
    };

    // Scoped to what is ON SCREEN, not to everything fetched. "Expand all"
    // pressed while looking at Prod should not also expand ninety Dev runs
    // that are one click of the side nav away.
    const allVisibleExpanded =
        visibleBuildHistory.length > 0 && visibleBuildHistory.every(b => expandedSet.has(b.id));
    const toggleAllVisible = () => {
        const visibleIds = visibleBuildHistory.map(b => b.id);
        setExpanded(allVisibleExpanded
            ? expandedBuilds.filter(id => !visibleIds.includes(id))
            : [...expandedBuilds, ...visibleIds]);
    };

    const moreToLoad = filteredBuildHistory.length > visibleBuilds;

    /**
     * The sentinel, held in STATE rather than a ref.
     *
     * A ref does not re-run the effect when the node appears, so the observer
     * would attach to null on first render and never to the real element. A
     * callback ref that sets state re-runs it exactly when the node arrives
     * and again when it leaves.
     */
    const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

    // Reset when the group changes: a window of 120 rows opened on one group
    // should not carry into the next one.
    useEffect(() => {
        setVisibleBuilds(PAGE);
    }, [selectedGroup]);

    useEffect(() => {
        if (!sentinel || !moreToLoad) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some(e => e.isIntersecting)) {
                    setVisibleBuilds(n => n + PAGE);
                }
            },
            // Start fetching slightly before the sentinel is on screen, so the
            // next rows are there by the time the scroll reaches them.
            { rootMargin: "400px" }
        );
        io.observe(sentinel);
        return () => io.disconnect();
    }, [sentinel, moreToLoad]);

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
                                onSelectGroup={handleSelectGroup}
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
                                    {selectedPipelineName
                                        ? selectedPipelineName
                                        : selectedGroup
                                            ? `${selectedGroup} Pipelines`
                                            : 'Pipelines'}
                                </h2>
                                {/* THE SUBTITLE IS THE ESCAPE HATCH. A filtered
                                    list that does not say it is filtered is the
                                    bug this fixed, one step later - so the
                                    narrower view names itself and offers the way
                                    back in the same sentence. */}
                                {selectedPipelineName ? (
                                    <p className="text-[var(--color-text-muted)] text-sm mt-1">
                                        Builds of this pipeline only.{" "}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedPipelineForRun("")}
                                            className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                                        >
                                            Show the whole group
                                        </button>
                                    </p>
                                ) : (
                                    <p className="text-[var(--color-text-muted)] text-sm mt-1">Recent builds for this group</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Only when there is something to act on. A
                                    control that does nothing is worse than an
                                    absent one: it invites a press and then
                                    teaches that the button is unreliable. */}
                                {visibleBuildHistory.length > 0 && (
                                    <button
                                        onClick={toggleAllVisible}
                                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 hover:border-emerald-500/50 px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                                        title={
                                            allVisibleExpanded
                                                ? `Collapse all ${visibleBuildHistory.length} runs shown here`
                                                : `Expand all ${visibleBuildHistory.length} runs shown here`
                                        }
                                        aria-expanded={allVisibleExpanded}
                                    >
                                        {allVisibleExpanded
                                            ? <ChevronsDownUp className="w-3.5 h-3.5" />
                                            : <ChevronsUpDown className="w-3.5 h-3.5" />}
                                        {allVisibleExpanded ? 'Collapse all' : 'Expand all'}
                                    </button>
                                )}
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
                            <>
                            {visibleBuildHistory.map((build) => (
                                <div key={build.id} className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden hover:border-slate-600 transition-colors">
                                    <div className={`p-4 bg-slate-900/50 flex items-center justify-between gap-4 ${expandedSet.has(build.id) ? 'border-b border-slate-700' : ''}`}>
                                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                                            {/* THE DISCLOSURE, first in the row.
                                                It is the control that decides what
                                                the rest of the card is, so it reads
                                                before the thing it governs. */}
                                            <button
                                                type="button"
                                                onClick={() => toggleBuildExpanded(build.id)}
                                                className="shrink-0 -ml-1 rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-white transition-colors"
                                                aria-expanded={expandedSet.has(build.id)}
                                                aria-label={`${expandedSet.has(build.id) ? 'Collapse' : 'Expand'} the steps of build ${build.buildNumber}`}
                                                title={expandedSet.has(build.id) ? 'Hide the steps' : 'Show the steps'}
                                            >
                                                {expandedSet.has(build.id)
                                                    ? <ChevronDown className="w-4 h-4" />
                                                    : <ChevronRight className="w-4 h-4" />}
                                            </button>
                                            <span className="text-slate-400 font-mono text-sm">#{build.buildNumber}</span>
                                            <span className="text-white font-semibold">{build.pipelineName}</span>
                                            {/* WHICH ENVIRONMENT this run touched. The history is a
                                                single list across every pipeline, so "notch.fm deploy"
                                                appears twice and the two rows are otherwise identical
                                                at a glance - which is the one thing you least want to
                                                misread when looking at a failure. */}
                                            <EnvTag environment={build.environment} />
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
                                                {formatBuildTime(build.startTime)}
                                            </span>
                                            {runDuration(build, now) > 0 && (
                                                <span className={`${RUN_CTRL_H} flex items-center gap-1 text-xs text-emerald-400/80 bg-emerald-400/10 px-2 rounded-full border border-emerald-400/20`}>
                                                    <Clock className="w-3 h-3" />
                                                    {formatDuration(runDuration(build, now))}
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
                                                    disabled={aborting === build.id}
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (!await confirm({
                                                            title: "Abort Pipeline",
                                                            message: "Are you sure you want to stop this running pipeline?",
                                                            isDangerous: true,
                                                            confirmText: "Abort"
                                                        })) return;

                                                        // Set BEFORE the request, cleared in finally, so the
                                                        // button reflects the work rather than the outcome -
                                                        // including when the request fails, where leaving it
                                                        // spinning forever would be the worse bug.
                                                        setAborting(build.id);
                                                        try {
                                                            await fetch(`${API_URL}/api/builds/${build.id}/abort`, {
                                                                method: 'POST',
                                                                headers: { Authorization: `Bearer ${token}` }
                                                            });
                                                            // Awaited now. It was fire-and-forget, so the
                                                            // spinner would have stopped while the list was
                                                            // still showing the build as running.
                                                            await fetchBuildHistory();
                                                        } finally {
                                                            setAborting(null);
                                                        }
                                                    }}
                                                    className={`${RUN_CTRL_H} bg-red-600/10 hover:bg-red-600/30 text-red-400 border border-red-500/30 px-3 text-xs rounded font-bold transition-all flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-red-600/10`}
                                                >
                                                    {aborting === build.id ? (
                                                        <>
                                                            <Loader className="w-3 h-3 animate-spin" /> Stopping
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Square className="w-3 h-3 fill-current" /> Abort
                                                        </>
                                                    )}
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
                                    {/* THE CONDENSED VIEW. One bar in place of the
                                        whole step grid, carrying the three things a
                                        collapsed run still has to say: how far it
                                        got, whether it failed, and whether it is
                                        waiting on a person. */}
                                    {!expandedSet.has(build.id) && (
                                        <div className="px-4 pb-3.5 pt-0.5">
                                            <RunProgressBar build={build} now={now} />
                                        </div>
                                    )}

                                    {expandedSet.has(build.id) && (
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
                                                                // ABORTED LOOKS STOPPED. No accent border and no
                                                                // glow: the whole complaint was that a stopped
                                                                // build's gate still looked like it wanted
                                                                // something from you.
                                                                step.status === 'aborted' ? 'bg-slate-900/50 border-slate-700 opacity-60' :
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
                                                        {/* A SQUARE, not a spinner and not a cross. "Stopped"
                                                            is its own outcome: a cross would read as failure
                                                            for a build somebody deliberately halted. */}
                                                        {step.status === 'aborted' && <Square className="w-3 h-3 text-slate-500" />}
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
                                                        // The BUILD has to be running too, not just the step.
                                                        // Belt and braces: the step status is derived server-side
                                                        // from the build status, and getting that derivation wrong
                                                        // is what made an aborted build count for forty-five
                                                        // minutes. This makes any future mistake in that mapping
                                                        // cost a wrong label rather than a clock that never stops.
                                                        const buildLive = build.status === 'running' || build.status === 'paused';
                                                        const elapsed = buildLive && step.status === 'running' && step.startedAt
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
                                                                            // AN ACTION NEVER RAN, so it has no
                                                                            // duration to withhold and "--" reads as a
                                                                            // step that was skipped. It says what it IS:
                                                                            // a button that waits on a finished build.
                                                                            : step.type === 'action' ? 'on demand'
                                                                                : step.status === 'running' ? '...'
                                                                                    : step.status === 'aborted' ? 'stopped' : '--'}
                                                                </div>

                                                                {/* NO BAR ON AN ACTION. A progress bar measures
                                                                    something that runs for a while; an action is a
                                                                    button that has not been pressed. Worse, the bar
                                                                    fell through to the build's own status, so a
                                                                    successful build drew a FULL GREEN bar under
                                                                    "Promote to production" - which reads as "this
                                                                    ran and succeeded" under the one control on the
                                                                    page that had not been touched. */}
                                                                {step.type !== 'action' && (
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
                                                                                        // NO animate-pulse. A pulsing bar is
                                                                                        // the loudest "still working" signal
                                                                                        // on the card, and it was the one
                                                                                        // left running under a stopped build.
                                                                                        step.status === 'aborted' ? 'bg-slate-600 w-full' :
                                                                                            'w-0'
                                                                            }`}></div>
                                                                    )}
                                                                </div>
                                                                )}
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

                                                    {/* ANYTIME ACTION - the button lives on ITS OWN STEP,
                                                        exactly like the Approve one above. It used to sit
                                                        in a bar below the grid while the step ALSO drew a
                                                        card showing a duration of "--", so one action
                                                        appeared twice and neither instance looked like a
                                                        control that belonged to a step.

                                                        Green, because that is already the house colour for
                                                        "a control that releases something" - the gate above
                                                        uses it and this does the same job one stage later. */}
                                                    {step.type === 'action' && (() => {
                                                        const chain = step.actions ?? [];
                                                        const summary = chain.map(a => String(a.do)).join(' then ') || 'nothing configured';
                                                        const running = actionBusy === `${build.id}:${step.name}`;
                                                        // EVERY STEP ABOVE THIS ONE, not "the pipeline
                                                        // finished". Same thing for a button at the end and
                                                        // a different, useful thing anywhere else.
                                                        const before = build.steps.slice(0, idx);
                                                        const waitingOn = step.requirePriorSteps
                                                            ? before.find(x => x.status !== 'success')
                                                            : undefined;
                                                        // SUPERSEDED, which is a different refusal from waiting.
                                                        // An action on the current state of something - promote
                                                        // merges whatever develop points at NOW - does not do
                                                        // what an old card implies when pressed from one.
                                                        //
                                                        // UNTIL A NAMED STEP, when one is configured. A new run
                                                        // existing is not what makes this card's button wrong -
                                                        // the new run having got far enough to change what the
                                                        // button acts on is. Pushing three commits in a row
                                                        // started three builds and took the promote away before
                                                        // anybody could press it, refused by a run that had so
                                                        // far only checked out a branch.
                                                        //
                                                        // ANY newer run, not just the newest, and REACHED rather
                                                        // than finished: if something after this card is already
                                                        // building images, this card no longer describes what
                                                        // pressing the button would do, whatever the run after
                                                        // THAT is up to.
                                                        const gate = step.requireLatestBuildUntilStep?.trim();
                                                        const newerRuns = build.id ? newerRunsPerBuild.get(build.id) ?? [] : [];
                                                        const overtakenBy = gate
                                                            ? newerRuns.find(b => (b.steps ?? []).some(
                                                                s => s.name === gate && s.status !== 'pending'
                                                            ))
                                                            : newerRuns[0];
                                                        const superseded = step.requireLatestBuild === true
                                                            && !!build.id
                                                            && !!overtakenBy;
                                                        const blocked = !!waitingOn || superseded;
                                                        // READY MEANS PRESSABLE RIGHT NOW, which is narrower
                                                        // than "not blocked": a button already running, or one
                                                        // with nothing configured, is green and does nothing.
                                                        // Flashing either would be an invitation to press a
                                                        // control that has no effect.
                                                        const ready = !blocked && !running && chain.length > 0;
                                                        return (
                                                            <div className="mt-3">
                                                                <button
                                                                    // aria-disabled WHEN BLOCKED, not disabled, and the
                                                                    // difference is the whole feature. A truly disabled
                                                                    // button receives no mouse events, so `title` never
                                                                    // fires on it - the hover explanation Sean asked
                                                                    // for would simply never appear. aria-disabled
                                                                    // announces the same thing to assistive tech while
                                                                    // leaving the element hoverable, and the click is
                                                                    // refused below instead of by the browser.
                                                                    //
                                                                    // `disabled` is still used for the two states that
                                                                    // are not about waiting: already running, and no
                                                                    // actions configured. Nothing to explain there.
                                                                    disabled={running || chain.length === 0}
                                                                    aria-disabled={blocked || undefined}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (blocked) return;
                                                                        runAction(build, step.name, step.confirm === true, summary);
                                                                    }}
                                                                    // A DISABLED BUTTON HAS TO SAY WHY. "Promote to
                                                                    // production" greyed out and silent is
                                                                    // indistinguishable from broken, which is the
                                                                    // failure this feature would otherwise ship.
                                                                    //
                                                                    // This is now the ONLY place that reason appears -
                                                                    // the caption under the button is gone - so it
                                                                    // names the step AND what it is still doing, rather
                                                                    // than assuming the reader can see the card it
                                                                    // refers to.
                                                                    title={waitingOn
                                                                        ? `Waiting on "${waitingOn.name}" (${waitingOn.status}) to finish first`
                                                                        : superseded
                                                                            ? gate
                                                                                ? `A newer run of this pipeline has reached "${gate}", so this card no longer describes what pressing this would do. Open the latest run instead.`
                                                                                : `There is a newer run of this pipeline. This action works on the current state, so running it from here would not promote THIS build - open the latest run instead.`
                                                                            : `${summary}${step.description ? `\n\n${step.description}` : ''}`}
                                                                    // AN ICON, NOT THE NAME. The card's heading is
                                                                    // already the step name, so the button repeated it
                                                                    // directly underneath - and being the longest text
                                                                    // in a 120px card, it wrapped to three lines and
                                                                    // made the one actionable control the hardest
                                                                    // thing on the card to read.
                                                                    //
                                                                    // Icon-only needs a name for anyone not looking at
                                                                    // it, hence aria-label; `title` already carries
                                                                    // what it will do, or why it cannot yet.
                                                                    aria-label={waitingOn
                                                                        ? `${step.name} - waiting on "${waitingOn.name}"`
                                                                        : superseded
                                                                            ? gate
                                                                                ? `${step.name} - unavailable, a newer run has reached "${gate}"`
                                                                                : `${step.name} - unavailable, a newer run of this pipeline exists`
                                                                            : step.name}
                                                                    // AMBER WHILE IT WAITS. Green-but-faded read as
                                                                    // "this is the button, it is just dim"; amber reads
                                                                    // as a state - the same colour this dashboard
                                                                    // already uses for a step that needs attention.
                                                                    // THE FLASH IS ONLY ON THE READY STATE. The
                                                                    // colour change from amber to green already says
                                                                    // it, but this button spends most of its life
                                                                    // blocked and the change lands on a dashboard
                                                                    // nobody is necessarily watching - so a deploy
                                                                    // can sit waiting on a press that nobody knows
                                                                    // is available. The ring is defined in
                                                                    // styles/index.css and stops animating, without
                                                                    // going away, under prefers-reduced-motion.
                                                                    className={`w-full px-2 py-1.5 rounded transition-all flex items-center justify-center border ${
                                                                        blocked
                                                                            ? "bg-amber-500/10 text-amber-400/80 border-amber-500/40 cursor-help hover:bg-amber-500/20"
                                                                            : "bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border-emerald-500/50"
                                                                    } ${ready ? "action-ready" : ""} disabled:opacity-40 disabled:cursor-not-allowed`}
                                                                >
                                                                    {running
                                                                        ? <Loader className="w-4 h-4 animate-spin" />
                                                                        : <Play className="w-4 h-4 fill-current" />}
                                                                </button>
                                                                {/* THE CAPTION IS GONE. It said `after "Build and
                                                                    push the images"` under a 120px card, wrapping to
                                                                    two or three lines and making the shortest-lived
                                                                    piece of information on the card the largest. The
                                                                    same sentence is on hover now, and on the
                                                                    aria-label for anyone not using a mouse. */}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            ))}
                                        </div>

                                        {/* The anytime-action buttons USED TO BE HERE, in a bar
                                            below the grid, and they are now drawn inside their
                                            own step card - see the button beside the Approve
                                            one above.

                                            The old comment argued the bar was right because an
                                            action "is not part of the run, so drawing it beside
                                            steps that succeeded would say it was skipped". That
                                            is true of a step CARD pretending to have run, and
                                            the answer is to fix the card rather than to draw the
                                            control twice: the action appeared once in the grid
                                            showing a duration of "--" AND again as a button
                                            underneath. One control, in the place the action
                                            is. */}

                                        <RunProvenance
                                            build={build}
                                            onRollback={rollbackTo}
                                            busy={rollingBack === build.id}
                                        />
                                    </div>
                                    )}
                                </div>
                            ))}

                            {/* THE SENTINEL. Rendered only while there is more
                                to show, so the observer disconnects on its own
                                at the end of the list rather than sitting there
                                firing against nothing.

                                A visible line rather than an empty div: a list
                                that silently grows as you scroll is good, and a
                                list that appears to end when it has not is not.
                                It says how many are left. */}
                            {moreToLoad && (
                                <div
                                    ref={setSentinel}
                                    className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500"
                                >
                                    <Loader className="w-3 h-3 animate-spin" />
                                    {filteredBuildHistory.length - visibleBuilds} older{" "}
                                    {filteredBuildHistory.length - visibleBuilds === 1 ? "build" : "builds"}
                                </div>
                            )}
                            </>
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
                        <div className="bg-[var(--color-surface)] rounded-xl p-6 w-full max-w-sm border border-slate-700 shadow-2xl">
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
