/**
 * What the server sends for a run, its steps, its commits and its artifacts.
 * Shared by every screen that shows a run. (Moved out of the v1 dashboard,
 * which still re-exports these until it is retired.)
 */

export type RunStatus = BuildHistoryEntry['status'];
export type StepStatus = RunStep['status'];
export type RunStep = BuildHistoryEntry['steps'][number];

/** One node of a run's substep tree (server: services/substeps.ts). Paths are 1-based: "11.2.1". */
export interface Substep {
    path: string;
    name: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    startedAt: number | null;
    endedAt: number | null;
    done: number | null;
    total: number | null;
    unit: string | null;
    source: 'yaml' | 'marker';
}

/** Per top-level step: its direct substeps counted, or its own progress counter (unit set). */
export interface SubstepSummary { done: number; total: number; failed: number; running: number; unit: string | null }

/** What the server recorded about a step that failed. */
export interface StepFailure {
    exitCode: number | null;
    signal: string | null;
    /** What the exit code usually means, when it means something particular (127: not found). */
    meaning: string | null;
    /** The substep it failed in ("3.2.1") and its name. */
    substep?: string;
    substepName?: string;
    /** The last lines the step printed, redacted. */
    lastLines: string[];
    /** Variables the command uses that no layer sets, or that are empty. */
    unset: string[];
    empty: string[];
    cwd?: string;
    shell?: string;
    durationMs?: number;
    /** Up to three lines of the command as written; commandLines says how long it really is. */
    command?: string;
    commandLines?: number;
}

export interface BuildHistoryEntry {
    /** Why the run failed, in one line. */
    error?: string;
    /** Keyed by 1-based step number ("11"). Only steps that have substeps or a counter. */
    substeps?: Record<string, SubstepSummary>;
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
        status: 'pending' | 'running' | 'success' | 'failed' | 'error' | 'aborted' | 'skipped';
        startTime?: string;
        endTime?: string;
        duration?: number;
        description?: string;
        continueOnError?: boolean;  // For status display logic
        /** Why a failed step failed (server: services/stepFailure.ts). Absent on runs from before it. */
        failure?: StepFailure;
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
    /** From the server's commit cache (v2); absent on older runs. */
    body?: string;
    files?: number | null;
    insertions?: number | null;
    deletions?: number | null;
}

export interface Artifact {
    reference: string;
    tag: string | null;
    digest: string | null;
    /** 'marker' when the pipeline declared it, 'log' when we recognised it. */
    source: string;
    rollbackable: boolean;
}

/** A pipeline as GET /api/targets returns it (the parsed YAML plus the caller's permissions). */
export interface PipelineInfo {
    id: string;
    appName: string;
    description?: string;
    version?: string;
    group?: string;
    environment?: string;
    requireConfirmation?: boolean;
    /** Where the YAML is, for the editor (relative to the pipelines folder, or absolute). */
    filePath?: string;
    steps?: Array<{ name: string; type?: string; description?: string }>;
    permissions?: {
        canView?: boolean; canRun?: boolean; canEditYaml?: boolean; canEditEnv?: boolean;
        canViewResources?: boolean; canUseClaude?: boolean; canUseTerminal?: boolean;
    };
}

/** One line of a build's output, as the stream and GET /builds/:id/logs carry it. */
export interface LogLine {
    id?: number;
    buildId: string;
    pipelineId?: string;
    stepIndex: number | null;
    /** The substep the line belongs to ("11.2.1"), or null for the step itself. */
    substep?: string | null;
    stream: 'stdout' | 'stderr' | 'system' | null;
    level?: string;
    text: string;
    at?: string;
}
