import * as fs from "fs";
import path from "path";
import { parse } from "yaml";
import { normalizePipeline } from "../services/pipelineFile.js";

// Interface for Logger compatibility
interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: any): void;
  /** One line of a step's own output. */
  out?(text: string, stream: "stdout" | "stderr"): void;
}


export interface RunOptions {
  customYaml?: string,
  customWorkspace?: string,
  skipClean?: boolean,
  autoApprove?: boolean,
  triggeredBy?: string,
  /** The commit this run is expected to build, when the trigger knows it (a git watch). */
  commitSha?: string,
  /**
   * Variables for THIS RUN ONLY, above every file-based layer.
   *
   * Written by a rollback, which is the one case where the instruction is
   * more specific than any scope: "deploy this exact tag, whatever the
   * pipeline would have built". They are never persisted, so the next
   * ordinary run is unaffected.
   */
  envOverrides?: Record<string, string>,
  /**
   * Rerun from this step: the ones before it are marked skipped and the
   * workspace is kept as the last run left it, so their output is still there.
   */
  fromStep?: string,
}

export class ApprovalError extends Error {
  constructor(public code: "not_found" | "not_paused", message: string) {
    super(message);
  }
}

export interface EZPIPELINEYAML {
  id: string;
  appName: string;
  version: string;
  description: string;
  steps: Step[];
  /** A dev, prod or qa tag, shown beside the pipeline. */
  environment?: string;
  /** Becomes the last step, "Deploy to Kubernetes" (services/pipelineFile.ts). */
  kubernetes?: KubernetesConfig;
  /** The folder it is in, under the pipelines folder. Set as it is loaded, never from the file. */
  group?: string;
  filePath?: string; // Added for frontend management
  /** A run needs confirming: the run route refuses one that is not confirmed. */
  requireConfirmation?: boolean;
}

export interface KubernetesConfig {
  /** false: leave the block in the file without deploying. */
  enabled?: boolean;
  /** The kubeconfig context, passed as --context. Not switched globally. */
  context?: string;
  /** Passed as --namespace. */
  namespace?: string;
  /** kubectl apply -f, from the workspace. */
  deploymentFile: string;
  /** A second kubectl apply -f. */
  serviceFile?: string;
  /** Wait for these ("deployment/web") with kubectl rollout status; the step fails if one does not become ready. */
  rollout?: string | string[];
  /** How long each rollout may take: "5m" (the default), "90s", "1h". */
  timeout?: string;
}

export interface Step {
  name: string;
  /** The command. Absent when the step is made of `steps:` instead. */
  run: string;
  /** Substeps, run in order in this step's cwd and env (services/substeps.ts). */
  steps?: Step[];
  /**
   * For `type: action`. The chain this button runs, in order, stopping at the
   * first failure. See services/ActionRunner.ts.
   */
  actions?: { do: string; [key: string]: unknown }[];
  /** For `type: action`: ask before running the chain. */
  confirm?: boolean;
  /**
   * For `type: action`: stay disabled until every step ABOVE it has succeeded.
   *
   * Position-relative rather than "wait for the whole pipeline", which is the
   * same thing for a button at the end and a different, useful thing anywhere
   * else. A promote button after the smoke check means "the deploy worked";
   * the same flag on an action placed halfway means "the part before me
   * worked", and the config does not change to say it.
   */
  requirePriorSteps?: boolean;
  /**
   * For `type: action`: refuse the button on any run but the newest for this
   * pipeline.
   *
   * ── FOR ACTIONS ON CURRENT STATE, WHICH IS NOT THE SAME AS THIS RUN ──────
   *
   * "Promote to production" merges whatever develop points at NOW. Pressed
   * from an older card it does not promote that card's build - it promotes
   * today's head, from a row describing last week, and the card implies
   * otherwise simply by being the thing somebody clicked.
   *
   * Named for the CONDITION rather than the trigger: `requireLatestBuild`
   * reads the same way as requirePriorSteps above it and says what must be
   * true, where "disableOnNewBuild" says what happens and leaves the reader
   * to work out when.
   *
   * Off by default, because it is wrong for the other kind of action - a
   * rollback, or anything that re-runs THIS build's artifacts, is exactly the
   * button you want on an old card.
   */
  requireLatestBuild?: boolean;
  /**
   * For `type: action`: how far the NEXT run may get before this button stops
   * working. A step name in this same pipeline, or absent for "not at all".
   *
   * `requireLatestBuild` on its own is all-or-nothing: the moment a new run
   * appears the button is refused, which is correct for a promote pressed off
   * a card from last Tuesday and wrong for the case that actually happens.
   * Sean pushes several commits in a row, each one starting a dev build, and
   * the promote he meant to press on the first is disabled before he reaches
   * it - by a run that has done nothing yet but check out a branch.
   *
   * What makes the older card WRONG is not the new run existing, it is the new
   * run having got far enough to change the thing the action works on. So this
   * names that step. Until the newest run reaches it, the older card's button
   * is still honest; from that step onwards it is not.
   *
   * REACHED, not finished: any status but `pending` counts. A step that is
   * halfway through building an image has already started replacing what the
   * button would have promoted.
   */
  requireLatestBuildUntilStep?: string;
  cwd?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
  shell?: string;
  type?: string;
  description?: string;
}

export interface BuildStepHistory {
  name: string;
  /**
   * What the step IS, carried through from the pipeline definition. Absent
   * for an ordinary step; 'approval' marks a gate.
   *
   * The dashboard needs this to know where to offer an Approve button. Until
   * it was sent, the client matched the step's NAME against "approv" and
   * "gate" instead, so a gate called "Authorise the first change to
   * production" could not be released from the UI at all.
   */
  type?: string;
  /**
   * For `type: action`: what pressing the button will do, in order. Sent so
   * the dashboard can name the chain before anybody presses it.
   */
  actions?: { do: string; [key: string]: unknown }[];
  /** For `type: action`: whether the UI asks before running the chain. */
  confirm?: boolean;
  /**
   * For `type: action`: whether the button stays disabled until every step
   * ABOVE it has succeeded. The client holds the ordered step list and each
   * step's status, so it needs nothing else to work this out.
   */
  requirePriorSteps?: boolean;
  /**
   * For `type: action`: whether the button is refused on any run but the
   * newest for this pipeline. The client holds the whole history and can see
   * which run is newest, so it needs nothing else to work this out.
   */
  requireLatestBuild?: boolean;
  /**
   * For `type: action`: how far the NEXT run may get before this button stops
   * working. A step name in this same pipeline, or absent for "not at all".
   *
   * `requireLatestBuild` on its own is all-or-nothing: the moment a new run
   * appears the button is refused, which is correct for a promote pressed off
   * a card from last Tuesday and wrong for the case that actually happens.
   * Sean pushes several commits in a row, each one starting a dev build, and
   * the promote he meant to press on the first is disabled before he reaches
   * it - by a run that has done nothing yet but check out a branch.
   *
   * What makes the older card WRONG is not the new run existing, it is the new
   * run having got far enough to change the thing the action works on. So this
   * names that step. Until the newest run reaches it, the older card's button
   * is still honest; from that step onwards it is not.
   *
   * REACHED, not finished: any status but `pending` counts. A step that is
   * halfway through building an image has already started replacing what the
   * button would have promoted.
   */
  requireLatestBuildUntilStep?: string;
  /**
   * 'aborted' is the step the build was ON when somebody stopped it.
   *
   * Distinct from 'failed', which says something went wrong, and from
   * 'running', which it used to be reported as - leaving a stopped build's
   * approval gate spinning as though it were still waiting for a click.
   */
  status: 'success' | 'failed' | 'running' | 'pending' | 'skipped' | 'error' | 'aborted';
  startTime?: Date;
  endTime?: Date;
  duration?: number; // in milliseconds
  /**
   * The median duration of this step across recent SUCCESSFUL runs of the same
   * pipeline, in milliseconds. Absent until the step has succeeded at least
   * once, which the client shows as an indeterminate bar rather than a guess.
   */
  estimatedDuration?: number;
  /** Epoch ms this run started the step, so elapsed can be measured. */
  startedAt?: number;
}

export interface BuildHistoryEntry {
  buildNumber: number;
  pipelineName: string;
  pipelineId: string;
  targetName?: string;
  group: string;
  status: 'success' | 'failed' | 'running' | 'aborted';
  startTime: Date;
  endTime?: Date;
  duration?: number; // in milliseconds
  steps: BuildStepHistory[];
  triggeredBy: string;
  id?: string;
  activeStep?: string;
  /** What this run contained. Empty when the workspace held no repository. */
  commits?: { sha: string; shortSha: string; author: string; date: string; subject: string }[];
  /** The head it built at, so the row can name a version without a commit list. */
  commitSha?: string | null;
  /**
   * The pipeline's `environment:` key - whatever it says, not a fixed set.
   *
   * The history is one list across every pipeline, so two runs of "notch.fm
   * deploy" are otherwise identical at a glance, which is the worst thing to
   * misread when looking at a failure.
   */
  environment?: string;
  /** Images it produced. `rollbackable` is false for a mutable tag like latest. */
  artifacts?: { reference: string; tag: string | null; digest: string | null; source: string; rollbackable: boolean }[];
}

import { execSync, spawn } from "child_process";
import { PluginManager } from "../services/PluginManager.js";
import { stepEstimates } from "../services/stepEstimates.js";

import dotenv from "dotenv";
import Logger from "./Logger.js";
import { LineSplitter } from "../services/LineSplitter.js";
import { DatabaseService } from "../services/Database.js";
import { CommitService } from "../services/CommitService.js";
import { Build } from "../types/other/index.js";
import { VersioningService } from "../services/VersioningService.js";
import { ProvenanceService } from "../services/ProvenanceService.js";
import { BuildService } from "../services/BuildService.js";
import { readAccessForGroup } from "../services/gitCredentials.js";
import { EventEmitter } from "events";

// Serve static files (adjust paths as needed)
import { fileURLToPath } from "url";
import { PIPELINES_DIR } from "../config/index.js";
import { SubstepTracker, validateSteps } from "../services/substeps.js";
import { readEnv } from "../services/EnvLayers.js";
import { CommandFailed, exitMeaning, failureLines, failureSummary, startMeaning, variablesInTrouble } from "../services/stepFailure.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../"); // apps/server root

export default class EZPipelineController extends EventEmitter {
  static instance: EZPipelineController;
  public targets: EZPIPELINEYAML[] = [];
  public builds: Build[] = [];
  // public buildIndex: number = 0; // Removed
  private logger = Logger.getInstance();
  private buildService = BuildService.getInstance();

  // Build history storage (delegated to BuildService)
  // private buildHistory: BuildHistoryEntry[] = []; // Removed in-memory storage
  private buildNumberCounter: number = 1;
  // private readonly MAX_HISTORY_SIZE = 100;

  constructor() {
    super();
    EZPipelineController.instance = this;
    this.initialize();
  }

  //#region private methods

  private initialize() {
    this.refreshTargets();
  }

  // Build history management methods
  public addBuildHistory(entry: BuildHistoryEntry) {
    // No-op for now, as we rely on BuildService.createBuild(). 
    // If we wanted to track step history in DB we would add it here.
    this.logger.info(`📊 Build history updated: #${entry.buildNumber} ${entry.pipelineName} - ${entry.status}`);
  }

  public clearBuildHistory(group?: string) {
    if (group) {
      // Find all targets in this group
      const groupTargets = this.targets.filter(t => {
        const tGroup = t.group || "General";
        return tGroup === group || tGroup.startsWith(`${group}/`);
      }).map(t => t.id);

      this.buildService.clearBuildsByTargets(groupTargets);
    } else {
      this.buildService.clearBuildHistory(); // Clear all
    }
  }

  public clearPipelineHistory(pipelineId: string) {
    this.buildService.clearBuildHistory(pipelineId);
  }

  public getBuildHistory(group?: string): BuildHistoryEntry[] {
    // PER PIPELINE, not the newest 100 overall. The old call made pipelines
    // compete for one global window: a project with 197 builds showed 79,
    // because 21 of the newest 100 rows belonged to three other pipelines.
    // See BuildService.getRecentBuildsPerPipeline.
    const rawBuilds = this.buildService.getRecentBuildsPerPipeline();
    const estimates = stepEstimates(rawBuilds as any);

    // Map to BuildHistoryEntry
    let entries: BuildHistoryEntry[] = rawBuilds.map(b => {
      const pipeline = this.targets.find(t => t.id === b.target);

      // Calculate Total Duration & Parse Timings
      let totalDuration = 0;
      let timings: Record<string, any> = {};
      const timingsString = (b as any).step_timings;
      if (timingsString) {
        try {
          timings = JSON.parse(timingsString);
        } catch (e) { }
      }

      if (pipeline) {
        pipeline.steps.forEach(step => {
          if (step.type === 'approval') return;
          const stepTime = timings[step.name];
          if (stepTime && typeof stepTime.duration === 'number') {
            totalDuration += stepTime.duration;
          }
        });
      }

      const activeStepName = (b as any).active_step;

      return {
        id: b.id,
        buildNumber: (b as any).build_number || 0,
        pipelineName: pipeline ? pipeline.appName : b.target,
        pipelineId: b.target,
        group: pipeline?.group || '',
        status: b.status as any,
        // Straight off the parsed pipeline, so a renamed or invented
        // environment needs no change here.
        environment: (pipeline as any)?.environment,
        startTime: new Date(b.started_at),
        endTime: b.ended_at ? new Date(b.ended_at) : undefined,
        triggeredBy: (b as any).triggered_by || 'manual',
        activeStep: activeStepName,
        // Why it failed, in one line (services/stepFailure.ts), redacted when it was written.
        error: b.status === 'failed' || b.status === 'error' ? ((b as any).error ?? undefined) : undefined,
        // Provenance, read alongside the row rather than fetched per build by
        // the client: the dashboard renders a hundred of these and a request
        // each would be a hundred requests to draw one page.
        commitSha: (b as any).commit_sha ?? null,
        commits: ProvenanceService.getInstance().commitsFor((b as any).commits ?? null),
        artifacts: ProvenanceService.getInstance().artifactsFor(b.id).map((a) => ({
          ...a,
          rollbackable: ProvenanceService.isRollbackable(a),
        })),
        duration: totalDuration,
        steps: pipeline ? pipeline.steps.map((s, index) => {
          let stepStatus: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'error' | 'aborted' = 'pending';
          const activeIndex = activeStepName ? pipeline.steps.findIndex(step => step.name === activeStepName) : -1;

          if (b.status === 'success') {
            stepStatus = 'success';
          } else if (b.status === 'failed' || b.status === 'aborted' || b.status === 'error' || b.status === 'running' || b.status === 'paused') {
            if (activeIndex !== -1) {
              if (index < activeIndex) stepStatus = 'success';
              else if (index === activeIndex) {
                if (b.status === 'failed') stepStatus = 'failed';
                else if (b.status === 'error') stepStatus = 'error';
                // ABORTED IS NOT RUNNING, and it used to fall through to the
                // `else` below and be reported as exactly that. The step the
                // build died on kept its blue border, its spinner and its
                // pulsing bar, so a stopped deployment's approval gate sat
                // there looking like it was still waiting for somebody to
                // press it. Sean's report: "aborted pipeline approval gate
                // looks like its waiting for me".
                //
                // The client already refused to run the CLOCK on a build that
                // is not live, which is why the elapsed time was right while
                // everything around it was wrong. That guard was compensating
                // for this mapping; this is the mapping being correct.
                else if (b.status === 'aborted') stepStatus = 'aborted';
                else stepStatus = 'running';
              } else {
                stepStatus = 'pending';
              }
            } else if ((b.status === 'failed' || b.status === 'error') && timings[s.name]?.status) {
              stepStatus = timings[s.name].status;
            }
          }

          // A step that failed and was allowed to (continueOnError) failed, whatever came after.
          if (timings[s.name]?.status === 'failed' && timings[s.name]?.continueOnError) stepStatus = 'failed';

          // A step the run stepped over says so, whatever the run's outcome:
          // a rerun from a later step did not succeed at the ones it skipped.
          if (timings[s.name]?.status === 'skipped' && s.type !== 'action') stepStatus = 'skipped';

          let stepDuration: number | undefined = undefined;
          if (timings[s.name]) {
            stepDuration = timings[s.name].duration;
          }

          return {
            name: s.name,
            // WHAT THE STEP IS, not what it is called.
            //
            // Without this the client could not tell an approval gate from any
            // other step, so it guessed from the name: it drew the Approve
            // button when the name contained "approv" or "gate". A gate called
            // "Authorise the first change to production" matched neither, and
            // a production run sat paused with no way to release it.
            //
            // The pipeline declares `type: approval` right there in the YAML.
            // Sending it costs one field and removes a heuristic that was
            // always going to fail on somebody's wording.
            type: s.type,
            // The chain, so the dashboard can name what a button will do
            // before somebody presses it. Values only; nothing here is secret
            // that the pipeline yaml does not already show.
            actions: s.actions,
            confirm: s.confirm,
            requirePriorSteps: s.requirePriorSteps,
            requireLatestBuild: s.requireLatestBuild,
            requireLatestBuildUntilStep: s.requireLatestBuildUntilStep,
            status: stepStatus,
            duration: stepDuration,
            // What this step usually takes, and when this run started it. The
            // client needs both to draw a bar that moves: one to scale
            // against, one to measure from.
            //
            // NEVER FOR AN APPROVAL GATE. A gate's recorded duration is how
            // long a person took to click, which is not a property of the step
            // and not a thing to predict. Real history had two of them at 1.4m
            // and 39.5s; offering those as estimates would put "~1.4m" beside a
            // gate that takes exactly as long as somebody is away from their
            // desk. Dropped here rather than on the client so there is one
            // place that decides it.
            estimatedDuration: s.type === 'approval'
              ? undefined
              : estimates.get(b.target)?.get(s.name),
            startedAt: typeof timings[s.name]?.start === "number" ? timings[s.name].start : undefined,
            // A failed step's exit code, what it means, its last lines and any unset variables.
            failure: timings[s.name]?.failure,
            continueOnError: s.continueOnError || undefined,
          };
        }) : []
      };
    });

    if (group) {
      entries = entries.filter(entry => entry.group === group || (entry.group && entry.group.startsWith(`${group}/`)));
    }

    return entries;
  }

  public getNextBuildNumber(): number {
    return this.buildNumberCounter++;
  }

  public refreshTargets() {
    const pipelinesDir = PIPELINES_DIR;

    // Create default structure if not exists
    if (!fs.existsSync(pipelinesDir)) {
      // Don't enforce General folder
      // const generalDir = path.join(pipelinesDir, "General");
      // fs.mkdirSync(generalDir, { recursive: true });
    }

    const getPipelines = (dir: string): { configPath: string, group: string }[] => {
      let results: { configPath: string, group: string }[] = [];
      if (!fs.existsSync(dir)) return [];

      const items = fs.readdirSync(dir, { withFileTypes: true });
      const isPipeline = items.some(i => i.name === '.pipeline');

      if (isPipeline) {
        // Found a pipeline bundle
        let configName = 'pipeline.yaml';
        if (!items.some(i => i.name === 'pipeline.yaml')) {
          const anyYaml = items.find(i => i.name.endsWith('.yaml') || i.name.endsWith('.yml'));
          if (anyYaml) configName = anyYaml.name;
        }

        const configPath = path.join(dir, configName);
        if (fs.existsSync(configPath)) {
          // Group: Rel path from pipelinesDir to parent of this bundle
          const parentDir = path.dirname(dir);
          let group = path.relative(pipelinesDir, parentDir);
          if (group === '.') group = '';
          if (!group) group = ''; // Explicitly allow empty for root

          results.push({ configPath, group });
        }
        return results;
      }

      // Recurse
      items.forEach(item => {
        if (item.isDirectory()) {
          // Skip internal folders if they accidentally exist in root (like 'node_modules'?? unlikely in data/pipelines)
          results = results.concat(getPipelines(path.join(dir, item.name)));
        }
      });

      return results;
    };

    const found = getPipelines(pipelinesDir);

    // Legacy Fallback: scan for flat yaml files in 'yaml' folders if no pipelines found? 
    // Or just support mixed mode by also scanning for 'yaml' folders only if isPipeline is false.
    // The recursive function above skips children if isPipeline is true. 
    // If isPipeline is false, it recurses.
    // Use legacy logic inside the generic recursion?

    // Let's refine the scanner to support legacy 'yaml' folders for now too.
    // Check if dir name is 'yaml'. If so, all yamls inside are pipelines.

    const getPipelinesMixed = (dir: string): { configPath: string, group: string }[] => {
      let results: { configPath: string, group: string }[] = [];
      if (!fs.existsSync(dir)) return [];

      const items = fs.readdirSync(dir, { withFileTypes: true });
      const isPipeline = items.some(i => i.name === '.pipeline');

      if (isPipeline) {
        let configName = 'pipeline.yaml';
        if (!items.some(i => i.name === 'pipeline.yaml')) {
          const anyYaml = items.find(i => i.name.endsWith('.yaml') || i.name.endsWith('.yml'));
          if (anyYaml) configName = anyYaml.name;
        }
        const configPath = path.join(dir, configName);
        if (fs.existsSync(configPath)) {
          const parentDir = path.dirname(dir);
          let group = path.relative(pipelinesDir, parentDir);
          // Cleanup group name
          if (group === '.') group = '';
          results.push({ configPath, group });
        }
        return results;
      }

      // Legacy check: Is this a 'yaml' folder?
      if (path.basename(dir) === 'yaml') {
        // All yamls here are legacy pipelines
        items.forEach(i => {
          if (i.isFile() && (i.name.endsWith('.yaml') || i.name.endsWith('.yml'))) {
            const parentDir = path.dirname(dir); // e.g. .../General/yaml -> .../General
            let group = path.relative(pipelinesDir, parentDir);
            if (group === '.') group = '';
            results.push({ configPath: path.join(dir, i.name), group });
          }
        });
        return results;
      }

      // Check for loose YAML files in this directory (not in a 'yaml' subfolder)
      items.forEach(i => {
        if (i.isFile() && (i.name.endsWith('.yaml') || i.name.endsWith('.yml'))) {
          // Calculate group as the full path from pipelinesDir to this directory
          let group = path.relative(pipelinesDir, dir);
          if (group === '.') group = '';
          if (!group) group = '';
          results.push({ configPath: path.join(dir, i.name), group });
        }
      });

      // Recurse
      items.forEach(item => {
        if (item.isDirectory()) {
          results = results.concat(getPipelinesMixed(path.join(dir, item.name)));
        }
      });
      return results;
    };

    const files = getPipelinesMixed(pipelinesDir);

    this.targets = files.map(file => {
      const content = fs.readFileSync(file.configPath, "utf8");
      let parsed: EZPIPELINEYAML;
      try {
        const firstDoc = content.split('\n---')[0];
        parsed = parse(firstDoc) as EZPIPELINEYAML;
      } catch (e: any) {
        return null;
      }

      if (parsed && typeof parsed === "object") normalizePipeline(parsed, { group: file.group, filePath: file.configPath });
      // Loaded anyway, so one bad step does not hide the pipeline from the people
      // who have to fix it; the editor refuses to save it in this state.
      const problems = parsed ? validateSteps(parsed.steps) : [];
      if (problems.length) this.logger.warn(`Pipeline ${parsed.id ?? file.configPath}: ${problems.join('; ')}`);
      return parsed;
    }).filter(p => p !== null && p !== undefined) as EZPIPELINEYAML[];

    this.logger.info(`Loaded ${this.targets.length} pipelines from ${pipelinesDir}`);
  }

  /**
   * What this run contained and what it produced, written down once it is over.
   *
   * REPLACES `VersioningService.archiveBuild`, which ran here and did neither.
   * Measured on this instance: with no Dockerfile at the workspace root it took
   * the zip branch, and `zip` is not installed in the container - so every
   * successful build ended with "Versioning failed", swallowed and logged as
   * non-fatal. Had it worked it would have been worse: a 10-deep, 1GB-capped
   * pile of zipped source checkouts, which is a snapshot you cannot deploy
   * rather than anything you could roll back to.
   *
   * Rolling a container deployment back does not need a COPY of the image -
   * the registry already has it. It needs a RECORD of which tag was deployed.
   * So that is what this keeps.
   *
   * NEVER THROWS INTO THE BUILD. The build has already succeeded by the time
   * this runs, and a note about it failing to be described must not change
   * that - which is the one thing the old code did get right.
   */
  private recordProvenance(
    buildId: string,
    target: string,
    workspaceDir: string,
    buildLogger: { info: (m: string) => void }
  ): void {
    try {
      const prov = ProvenanceService.getInstance();

      const { headSha, commits } = prov.collectCommits(workspaceDir, target, buildId);
      prov.saveCommits(buildId, headSha, commits);
      if (commits.length > 0) {
        buildLogger.info(
          `📝 ${commits.length} commit${commits.length === 1 ? "" : "s"} in this run` +
          (headSha ? ` (at ${headSha.slice(0, 7)})` : "")
        );
      }

      // The build's own log, read back. A step can shell out to anything, and
      // the log is the one place every builder's output already arrives - so
      // this works for a pipeline that was never written with it in mind.
      const lines = (this.buildService.getBuildLogs(buildId) ?? []).map(
        (l: { message?: string } | string) => (typeof l === "string" ? l : l?.message ?? "")
      );
      const artifacts = prov.detectArtifacts(lines);
      prov.saveArtifacts(buildId, target, artifacts);
      if (artifacts.length > 0) {
        buildLogger.info(
          `📦 recorded ${artifacts.length} image${artifacts.length === 1 ? "" : "s"}: ` +
          artifacts.map((a) => a.reference).join(", ")
        );
      }
    } catch (e) {
      this.logger.error("failed to record build provenance", e as Error);
    }
  }

  private interpolateEnv(
    command: string,
    env: NodeJS.ProcessEnv,
    shell: string | undefined = undefined
  ) {
    // First, handle special ${RESOURCES/...} pattern
    let result = command.replace(/\$\{RESOURCES\/([^}]+)\}/g, (match, filename) => {
      const resourcesDir = env['RESOURCES'];
      if (resourcesDir) {
        const fullPath = path.join(resourcesDir, filename);
        // Quote the path if it contains spaces or special shell characters
        if (/[\s()&|;<>]/.test(fullPath)) {
          return `"${fullPath}"`;
        }
        return fullPath;
      }
      return match; // Return original if RESOURCES not set
    });

    // Then interpolate standard ${VAR} patterns
    // A NAME THIS RUNNER DOES NOT KNOW IS LEFT ALONE.
    //
    // This used to substitute "" for any ${name} missing from the
    // environment, which quietly destroyed every SHELL variable written with
    // braces. A step doing
    //
    //   url="postgres://${role}:${pw}@${fqdn}:5432/${db}"
    //
    // never reached bash intact: all four are shell locals, none is in the
    // environment, and the step received
    //
    //   url="postgres://:@:5432/"
    //
    // It cost a deploy and then hid, because the damage was silent and the
    // result still looked like a URL. notch.fm wrote that string into Key
    // Vault as its DATABASE_URL; the guard that refuses to overwrite an
    // existing secret then preserved it on every later run, and the API died
    // with ERR_INVALID_URL several steps and one approval gate away from the
    // step that caused it.
    //
    // Handing the name back lets the shell decide, which is the only thing
    // here that knows whether it is a variable. The ${RESOURCES/...} branch
    // above already does exactly this.
    result = result.replace(/\$\{(\w+)\}/g, (match, key) => {
      if (!(key in env)) return match;
      const value = env[key] ?? "";
      // Quote paths that contain spaces or special shell characters
      // This is especially important for ENV_FILE and similar path variables
      if (value && /[\s()&|;<>]/.test(value)) {
        return `"${value}"`;
      }
      return value;
    });

    return result;
  }

  /**
   * The child process each running build is currently waiting on.
   *
   * Needed because abort() had no way to reach it. The step loop checks
   * build.isAborted BETWEEN steps, so aborting a build whose current step
   * never returns did nothing at all: build #199 was marked aborted and its
   * bash child went on running for over an hour afterwards, still holding a
   * Postgres firewall rule open.
   */
  private activeChildren = new Map<string, import("child_process").ChildProcess>();

  private runCommandLive(
    command: string,
    logger: ILogger,
    cwd: string | undefined,
    env?: NodeJS.ProcessEnv,
    shell?: string | undefined,
    buildId?: string
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const interpolatedCommand = this.interpolateEnv(
        command,
        env ?? {},
        shell
      );

      // Parse command into parts, respecting quotes and escapes
      const parts: string[] = [];
      let current = '';
      let inQuote = false;
      let quoteChar = '';
      let escaped = false;

      for (let i = 0; i < interpolatedCommand.length; i++) {
        const char = interpolatedCommand[i];

        if (escaped) {
          current += char;
          escaped = false;
          continue;
        }

        if (char === '\\') {
          escaped = true;
          continue;
        }

        if ((char === '"' || char === "'") && !inQuote) {
          inQuote = true;
          quoteChar = char;
          continue;
        }

        if (char === quoteChar && inQuote) {
          inQuote = false;
          quoteChar = '';
          continue;
        }

        if (char === ' ' && !inQuote) {
          if (current) {
            parts.push(current);
            current = '';
          }
          continue;
        }

        current += char;
      }

      if (current) {
        parts.push(current);
      }

      const cmd = parts[0];
      const args = parts.slice(1);

      // run() resolves every step's cwd to an absolute path (stepCwd).
      // No echo of the command here: it is the interpolated one, so it would
      // print the values of the variables it names into the build log.
      const resolvedCwd = cwd && path.isAbsolute(cwd) ? cwd : path.resolve(PROJECT_ROOT, cwd || "");

      // Ensure directory exists
      if (!fs.existsSync(resolvedCwd)) {
        logger.warn(`[WARN] CWD does not exist, creating: ${resolvedCwd}`);
        fs.mkdirSync(resolvedCwd, { recursive: true });
      }

      // When using shell, pass the full command as a string to preserve quoting
      // Otherwise, spawn reconstructs it and loses our careful quote handling
      //
      // THE STEP'S OWN SHELL, not just "a shell". `shell: true` means /bin/sh
      // on POSIX, which on Debian is dash - so a step declaring
      // `shell: /bin/bash` and opening with `set -euo pipefail` died on
      // "Illegal option -o pipefail" before running a line. The field was
      // parsed, stored and threaded all the way down to here, and then
      // dropped at the only point that could act on it.
      //
      // Node's spawn takes the shell PATH as a string, so passing it through
      // is the whole fix. Anything that is not an absolute path is treated as
      // a request for the default shell rather than handed to spawn, because
      // spawn would otherwise try to execute it as a program and fail in a way
      // that reads as the step being broken.
      const useShell = shell ?? true;
      const shellPath =
        typeof shell === "string" && shell.startsWith("/") ? shell : true;
      // detached: true GIVES THE CHILD ITS OWN PROCESS GROUP, and that is the
      // whole mechanism behind aborting properly.
      //
      // A step is a shell that runs other programs - bash running az running
      // psql. Killing the shell alone orphans its children, which keep working
      // and keep holding whatever they hold. The only way to stop the tree is
      // to signal the process GROUP, and a group can only be signalled
      // separately if it is not shared with the server.
      //
      // Without this the child sits in the server's own group, so
      // `process.kill(-pid)` would take the server down with it. I did exactly
      // that while investigating and the container restarted.
      const spawnOpts = {
        cwd: resolvedCwd,
        env,
        windowsHide: true,
        // Not on Windows, where detached means "new console" and the negative
        // pid kill does not exist.
        detached: process.platform !== "win32",
      };
      const child = useShell
        ? spawn(interpolatedCommand, [], { ...spawnOpts, shell: shellPath })
        : spawn(cmd, args, { ...spawnOpts, shell: false });

      // Registered so abort() can find it, and cleared on every exit path
      // below so a finished build never leaves a dead handle behind.
      if (buildId) this.activeChildren.set(buildId, child);
      const forget = () => { if (buildId) this.activeChildren.delete(buildId); };

      // Line-buffered, one splitter per stream so stdout and stderr cannot
      // interleave inside a line.
      // The last lines it printed, for the failure summary (redacted: they go into the run's record).
      const tail: string[] = [];
      const started = Date.now();
      const write = (stream: "stdout" | "stderr") => (line: string) => {
        if (line.trim() && !line.startsWith("::ezp")) { tail.push(this.logger.redact(line)); if (tail.length > 8) tail.shift(); }
        if (logger.out) logger.out(line, stream);
        else logger.info(stream === "stderr" ? `[STDERR] ${line}` : line);
      };
      const outLines = new LineSplitter(write("stdout"));
      const errLines = new LineSplitter(write("stderr"));
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d: string) => outLines.push(d));
      child.stderr.on("data", (d: string) => errLines.push(d));
      const flushAll = () => { outLines.flush(); errLines.flush(); };

      const shellName = typeof shellPath === "string" ? shellPath : useShell ? (process.platform === "win32" ? "cmd.exe" : "/bin/sh") : "(none)";
      const failed = (message: string, exitCode: number | null, signal: string | null, meaning: string | null) => {
        const trouble = variablesInTrouble(command, env ?? {});
        return new CommandFailed(message, {
          exitCode, signal, meaning, lastLines: tail.slice(-5), command, cwd: resolvedCwd, shell: shellName,
          durationMs: Date.now() - started, unset: trouble.unset, empty: trouble.empty,
        });
      };

      child.on("error", (err) => {
        flushAll();
        forget();
        reject(failed(`Could not start the step: ${err.message}`, null, null, startMeaning(err, shellName, resolvedCwd)));
      });

      child.on("close", (code, signal) => {
        flushAll();
        forget();
        // A KILLED STEP REPORTS THE SIGNAL, not "exit code null". Node gives a
        // null code when a process died on a signal, and "failed with exit
        // code null" reads as a broken step rather than as the abort somebody
        // just pressed.
        if (signal) {
          reject(failed(`Command was stopped (${signal})`, null, signal, exitMeaning(null, signal)));
          return;
        }
        if (code === 0) resolve(code);
        else reject(failed(`Command failed with exit code ${code}`, code, null, exitMeaning(code, null)));
      });
    });
  }


  public start_build(build: EZPIPELINEYAML): Build {
    const buildId = this.buildService.createBuild(build.id, build.version);

    let new_build: Build = {
      id: buildId,
      target: build?.id as string,
      status: 'running',
      steps: build.steps.map(step => step.name),
      activeStep: build.steps[0].name,
      version: build.version,
      percentage: 0,
      started: new Date(),
      ended: undefined,
      isAborted: false,
      stepTimings: {} // Initialize
    };

    // track this build in memory (optional, or just for active status)
    this.builds.push(new_build);
    return new_build;
  }

  /**
   * A step threw. Record it - WITHOUT overwriting a deliberate abort.
   *
   * ── THE ORDERING BUG THIS EXISTS BECAUSE OF ──────────────────────────────
   *
   * Aborting now actually kills the step's process group, and a killed step
   * rejects. That rejection lands here, and this method used to write
   * status 'failed' unconditionally - a few milliseconds after abort() had
   * written 'aborted'. So dev #202, which Sean stopped on purpose, ended up
   * reading "Failed" with the error "Command was stopped (SIGTERM)".
   *
   * It only became possible once abort started working: before that the step
   * ran to completion and nothing rejected. Fixing one thing made the next
   * thing visible, which is the usual shape.
   *
   * The distinction is worth keeping. "Failed" sends somebody looking for a
   * fault; "aborted" says a person decided. Collapsing them wastes the reader's
   * time in exactly the moment they are trying to work out what happened.
   */
  private build_error(build: Build, error: Error) {
    // Not overwritten if abort() already set one: that is the moment the
    // person pressed the button, and it is earlier and more meaningful than
    // the moment the doomed step noticed.
    build.ended = build.ended ?? new Date();
    build.error = error.message;

    if (build.isAborted) {
      // isAborted travels WITH the update, not just as a status: statusToWrite
      // decides from the fields it is given, and an `error` alone reads as a
      // failure. Passing the flag is what makes the status survive the write.
      this.buildService.updateBuild(build.id, {
        error: error.message,
        ended: build.ended,
        isAborted: true,
        status: 'aborted',
      });
      return;
    }

    this.buildService.updateBuild(build.id, {
      error: error.message,
      ended: build.ended,
      status: 'failed',
    });
  }

  public clear_builds() {
    this.builds = []; // Only clears memory, DB persists
  }


  //#endregion

  //#region public methods
  public static initialize() {
    new EZPipelineController();

    //check for templates in the k8s folder and replace any ${ENV_VARS} with the value
  }

  /**
   * Run a pipeline. Anything that goes wrong before the first step (a pipeline that will
   * not parse, a folder that cannot be made) still ends the run as failed, with the
   * reason in its log: it used to stay "running" with an empty log, the error only in
   * the server's own output.
   */
  public async run(pipelineId: string, existingBuild?: Build, options: RunOptions = {}) {
    const track: { build?: Build } = { build: existingBuild };
    try {
      return await this.runInner(pipelineId, existingBuild, options, track);
    } catch (e) {
      const b = track.build;
      if (b && !b.ended) {
        const err = e as Error;
        const say = (text: string, level: "error" | "info") => {
          const line = this.logger.redact(text);
          this.buildService.log(b.id, line, null, "system", null, level);
          this.logger.buildLine({ buildId: b.id, pipelineId: b.target, stepIndex: null, substep: null, stream: "system", level, text: line });
        };
        say(`✗ The run could not start its steps: ${err?.message ?? String(e)}`, "error");
        if (err?.stack && err.name !== "Error") for (const l of err.stack.split("\n").slice(1, 8)) say(`  ${l.trim()}`, "info");
        this.build_error(b, err instanceof Error ? err : new Error(String(e)));
        this.emit("build_error", b);
      }
      throw e;
    }
  }

  private async runInner(pipelineId: string, existingBuild: Build | undefined, options: RunOptions, track: { build?: Build }) {
    let pipeline = this.targets.find(t => t.id === pipelineId);

    if (options.customYaml) {
      try {
        const parsed = parse(options.customYaml) as EZPIPELINEYAML;
        // If original pipeline exists, inherit location for resource resolution
        pipeline = normalizePipeline(parsed, { group: pipeline?.group, filePath: pipeline?.filePath });
      } catch (e) {
        throw new Error(`Failed to parse custom YAML: ${e}`);
      }
    }

    if (!pipeline) {
      throw new Error(`Pipeline with id '${pipelineId}' not found.`);
    }

    // Determine Mode and Directories
    // Default to Legacy Mode first - Use dedicated folder in PIPELINES_DIR to avoid root clutter
    const baseWorkspaceDir = path.join(PIPELINES_DIR, "_legacy_workspaces");
    let pipelineDir = path.join(baseWorkspaceDir, pipelineId);
    let workspaceDir = path.join(pipelineDir, "workspace");
    let buildsDir = path.join(pipelineDir, "builds");
    let resourceSourceDir: string | undefined;
    let isBundle = false;

    if (pipeline.filePath) {
      const yamlDir = path.dirname(pipeline.filePath);
      // Default legacy resource source
      resourceSourceDir = path.join(yamlDir, 'resources');

      if (fs.existsSync(path.join(yamlDir, '.pipeline'))) {
        isBundle = true;
        pipelineDir = yamlDir;
        workspaceDir = path.join(pipelineDir, 'workspace');
        buildsDir = path.join(pipelineDir, 'build-history');
        resourceSourceDir = path.join(pipelineDir, 'resources');
      }
    }

    // Override workspace if provided
    if (options.customWorkspace) {
      workspaceDir = options.customWorkspace;
    }

    // 1. Prepare Directories
    // We want to Clean the WORKSPACE, but KEEP the BUILDS.
    //
    // A RESUME MUST NOT WIPE THE WORKSPACE.
    //
    // Approval gates re-enter run() to continue a paused build, and this
    // cleaned first and then skipped every completed step - including the ones
    // that had filled the workspace. So the checkout a pipeline made before
    // the gate was deleted at the gate, and the first step after it failed on
    // a missing file. Every approval-gated pipeline was broken this way; it
    // only showed up on one whose post-approval step reads a file, which is to
    // say on the first one that did anything real.
    //
    // A fresh build sets activeStep to steps[0] (see start_build), so index 0
    // means "starting"; anything later means "continuing". existingBuild alone
    // cannot tell them apart, because the run route passes a build for both.
    const resumeIndex = existingBuild?.activeStep
      ? pipeline.steps.findIndex(s => s.name === existingBuild.activeStep)
      : 0;
    const isResume = resumeIndex > 0;

    if (!options.skipClean && !options.fromStep && !isResume && fs.existsSync(workspaceDir)) {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      } catch (e) {
        this.logger.error(`Failed to clean workspace ${workspaceDir}`, e);
      }
    }

    // Ensure parent dirs exist if needed (Legacy needs pipelineDir created, Bundle likely exists)
    if (!isBundle) {
      fs.mkdirSync(pipelineDir, { recursive: true });
    }

    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(buildsDir, { recursive: true });

    // 2. Track Build
    let build = existingBuild || this.start_build(pipeline);
    track.build = build;

    // The commit this run is expected to build, known BEFORE it clones: the
    // watch's sha, or for a manual run the head the pipeline's watch last saw.
    // Recorded now so a queued, running or failed run can show it; provenance
    // replaces it with what was really checked out when the run ends.
    let expectedSha: string | null = null;
    if (!existingBuild) {
      try {
        const watch = DatabaseService.getInstance().getDb()
          .prepare(`SELECT repo_url, last_sha FROM git_watches WHERE pipeline_target IN (?, ?) AND enabled = 1 ORDER BY id LIMIT 1`)
          .get(pipeline.id, pipeline.appName ?? pipeline.id) as { repo_url: string; last_sha: string | null } | undefined;
        expectedSha = options.commitSha ?? watch?.last_sha ?? null;
        if (expectedSha) {
          const known = watch ? CommitService.getInstance().cached(watch.repo_url, expectedSha) : null;
          CommitService.getInstance().attachToBuild(build.id, expectedSha, known ? [known] : []);
        }
      } catch (e) {
        this.logger.warn(`Could not stamp the expected commit on build ${build.id}: ${e}`);
      }
    } else {
      expectedSha = (this.buildService.getBuild(build.id)?.commit_sha as string | null) ?? null;
    }

    // Stamped once, on the build, so it survives approveBuild's resume - which
    // calls run() again with no options. Never cleared here: a resumed build
    // carries the flag it was started with, and a manual run has no option to
    // set it in the first place.
    if (options.autoApprove) {
      build.autoApprove = true;
      this.buildService.setAutoApprove(build.id, true);
    }
    if (options.triggeredBy) {
      build.triggeredBy = options.triggeredBy;
      // The row is already inserted by start_build, so the stamp has to be
      // written through rather than set on the object: the dashboard reads the
      // builds table, not this in-memory copy. That gap is exactly why the
      // badge said 'manual' for a run the poller had started.
      this.buildService.updateBuild(build.id, { triggeredBy: options.triggeredBy } as any);
    }

    // Build specific directory: .../builds/<buildId>
    const buildDir = path.join(buildsDir, build.id);
    fs.mkdirSync(buildDir, { recursive: true });

    const logFilePath = path.join(buildDir, "build.log");
    const metaFilePath = path.join(buildDir, "build.json");

    // Persist initial build metadata
    fs.writeFileSync(metaFilePath, JSON.stringify(build, null, 2));

    // 3. Setup Logging
    const fileLog = (msg: string) => {
      try {
        fs.appendFileSync(logFilePath, msg + '\n');
      } catch (e) {
        console.error("Failed to write to log file", e);
      }
    };

    // The step the loop below is on, so every line can say which step it
    // belongs to. null before the first step and after the last.
    let stepIndex: number | null = null;
    const substeps = new SubstepTracker((sub) => {
      this.buildService.saveSubstep(build.id, sub);
      this.emit("substep", { id: build.id, target: build.target, substep: sub });
    });
    const emitLine = (raw: string, level: "info" | "warn" | "error", stream: "stdout" | "stderr" | "system") => {
      // A marker line moves the substep tree and is not itself output.
      if (stream !== "system" && substeps.line(raw)) return;
      // EZPipeline's own messages carry v1's "\n🔧 Step: …" spacing; in a line view that is an empty line.
      // Command output arrives one line at a time already, and its blank lines are the program's own.
      const text = this.logger.redact(stream === "system" ? raw.replace(/^\s*\n|\n\s*$/g, "") : raw);
      this.buildService.log(build.id, text, stepIndex, stream, substeps.current(), level);
      fileLog(`[${level.toUpperCase()}] ${text}`);
      this.logger.buildLine({ buildId: build.id, pipelineId: build.target, stepIndex, substep: substeps.current(), stream, level, text });
    };
    const buildLogger: ILogger = {
      info: (msg: string) => emitLine(msg, "info", "system"),
      warn: (msg: string) => emitLine(msg, "warn", "system"),
      error: (msg: string, err?: any) => emitLine(err ? `${msg} ${err instanceof Error ? err.message : String(err)}` : msg, "error", "system"),
      out: (text: string, stream: "stdout" | "stderr") => emitLine(text, "info", stream),
    };

    // 4. Resource & Env Setup
    let resourceEnv: Record<string, string> = {};
    resourceEnv['WORKSPACE'] = workspaceDir;
    let envFilePath: string | undefined; // Track env file path for ENV_FILE variable

    // Handle Resources
    if (resourceSourceDir) {
      const targetResourceDir = path.join(workspaceDir, 'resources');

      // LAYERED, the same way the env files are: instance, then each group
      // from the outside in, then the pipeline's own. Copied in that order so
      // the most specific file wins when two layers name the same one.
      //
      // The instance-wide and group directories used to be managed in the UI
      // and never delivered - `${RESOURCES/deploy_key}` resolved to a file
      // that was not there, and the step failed on the key rather than on the
      // upload nobody had noticed doing nothing.
      const resourceLayers: string[] = [
        path.join(path.dirname(PIPELINES_DIR), 'global', 'resources'),
      ];
      if (pipeline.group) {
        const parts = pipeline.group.split(path.sep).filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
          resourceLayers.push(path.join(PIPELINES_DIR, ...parts.slice(0, i), 'resources'));
        }
      }
      resourceLayers.push(resourceSourceDir);

      const present = resourceLayers.filter(d => fs.existsSync(d));

      if (present.length > 0) {
        try {
          for (const dir of present) {
            buildLogger.info(`Copying resources from ${dir} to ${targetResourceDir}`);
            fs.cpSync(dir, targetResourceDir, { recursive: true, force: true });
          }
          resourceEnv['RESOURCES'] = targetResourceDir;

          // Fix permissions for private keys (id_rsa, *.pem, *.key) to be 600
          // otherwise scp/ssh will complain about unprotected private key file
          const fixKeyPermissions = (dir: string) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              const fullPath = path.join(dir, file);
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory()) {
                fixKeyPermissions(fullPath);
              } else if (file.endsWith('.pem') || file.endsWith('.key') || file === 'id_rsa') {
                fs.chmodSync(fullPath, 0o600);
                buildLogger.info(`Fixed permissions for key file: ${file}`);
              }
            }
          };
          fixKeyPermissions(targetResourceDir);

        } catch (e) {
          buildLogger.error("Failed to copy resources", e);
        }
      } else {
        // Nothing at any layer. The directory still exists so a step can write
        // into $RESOURCES without checking first.
        fs.mkdirSync(targetResourceDir, { recursive: true });
        resourceEnv['RESOURCES'] = targetResourceDir;
      }
    }

    // The env layers, composed per run and never written back into the
    // server's own environment. Most specific wins:
    //   process.env  <  .env.global  <  <group>/.env.group  <  pipeline .env
    let globalEnv: Record<string, string> = {};
    let groupEnv: Record<string, string> = {};
    let pipelineEnv: Record<string, string> = {};

    // Handle Env Vars
    if (pipeline.filePath) {
      const yamlDir = path.dirname(pipeline.filePath);
      const envName = pipeline.id;

      // Returns what it read rather than writing it into process.env.
      //
      // It USED to do the latter, and that leaked between pipelines: the
      // server's own environment kept every variable any pipeline had ever
      // loaded, and each step is spawned with `...process.env`. Run notch.fm's
      // provisioning and then a FileFreak pipeline, and FileFreak's steps saw
      // notch.fm's AZURE_CLIENT_SECRET - in one instance, with no warning, and
      // permanently until the server restarted.
      //
      // Layers are composed per run now, so a variable reaches exactly the
      // pipeline it belongs to.
      const loadEnv = (p: string): Record<string, string> | null => {
        if (fs.existsSync(p)) {
          buildLogger.info(`Loading env file: ${p}`);
          envFilePath = p; // Store the path for ENV_FILE variable
          const envConfig = dotenv.parse(fs.readFileSync(p));

          // Redact by what a variable IS, not by how long its value happens
          // to be.
          //
          // This registered every value of three characters or more, so a
          // branch name, a region and a repo URL were all treated as secrets.
          // That is worse than useless in both directions. It protects
          // nothing - none of them are secret - and it destroys the logs: a
          // clone failure came back as "Remote branch [REDACTED] not found",
          // hiding the one fact needed to fix it, and NOTCHFM_BRANCH=develop
          // turned the unrelated words "development subscription" into
          // "[REDACTED]ment subscription", because the match is a plain
          // substring anywhere in any line.
          //
          // A name-based rule covers what actually needs hiding, and the
          // length floor is raised because a short value cannot carry much
          // secret and matches far too much prose.
          const SECRET_KEY = /(SECRET|PASSWORD|PASSWD|TOKEN|_KEY|APIKEY|API_KEY|CREDENTIAL|PRIVATE|SESSION|SALT|CERT|_PAT$|^PAT_)/i;
          // The name rule, plus anything marked `# @secret` in the file (services/EnvLayers.ts).
          const marked = new Set(readEnv(p).filter((v) => v.secret).map((v) => v.key));
          const secrets = Object.entries(envConfig)
            .filter(([k, v]) => (SECRET_KEY.test(k) || marked.has(k)) && v.length >= 8)
            .map(([, v]) => v);
          this.logger.registerSecrets(secrets);

          return envConfig;
        }
        return null;
      };

      // GROUP LEVEL, between the instance-wide globals and the pipeline's own.
      //
      // Every notch.fm pipeline needs the same Azure subscription and the same
      // Postgres password; every FileFreak pipeline needs a different set. Put
      // those in the instance-wide globals and the two projects share
      // credentials they have no business sharing; put them in each pipeline
      // and the copies drift, and the one that drifts is always the one you
      // are not looking at.
      // INSTANCE-WIDE, the outermost layer and the one every pipeline sees.
      globalEnv = loadEnv(path.join(path.dirname(PIPELINES_DIR), '.env.global')) ?? {};

      // Walked from the OUTERMOST group inward, because groups nest and the
      // useful meaning of "a variable for all of Notch.fm" includes the
      // pipelines filed under Notch.fm/Infra.
      //
      // `group` is the pipeline's parent directory relative to the pipelines
      // root, so provision-dev's group is `Notch.fm/Infra`, not `Notch.fm`.
      // Reading only that one directory meant a variable set for all of
      // notch.fm reached deploy-dev and not provisioning, for no reason a
      // person could see from the UI.
      //
      // Inner wins, so a group can override what its parent set.
      if (pipeline.group) {
        const parts = pipeline.group.split(path.sep).filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
          const dir = path.join(PIPELINES_DIR, ...parts.slice(0, i));
          Object.assign(groupEnv, loadEnv(path.join(dir, '.env.group')) ?? {});
        }
      }

      if (isBundle) {
        // Bundle: Check .env then .env.<target>
        // Try strict .env first
        pipelineEnv = loadEnv(path.join(yamlDir, '.env'))
          ?? loadEnv(path.join(yamlDir, `.env.${envName}`))
          ?? {};
      } else {
        // Legacy
        const projectRoot = path.dirname(yamlDir);
        pipelineEnv = loadEnv(path.join(projectRoot, 'env', `.env.${envName}`))
          ?? loadEnv(path.join(yamlDir, `.env.${envName}`))
          ?? {};
      }
    }

    // Add ENV_FILE to resourceEnv if we loaded an env file
    if (envFilePath) {
      resourceEnv['ENV_FILE'] = envFilePath;
    }

    buildLogger.info(
      `\n🚀 Running pipeline: ${pipeline.appName} (${pipeline.version}) - ${pipeline.description}`
    );
    buildLogger.info(`📂 Workspace: ${workspaceDir}`);
    if (resourceEnv['RESOURCES']) {
      buildLogger.info(`📂 Resources: ${resourceEnv['RESOURCES']}`);
    }

    // WHICH KEY GIT READS WITH, worked out once for the run and SAID IN THE LOG.
    //
    // "Not even sure how the git credentials were set for ezpipeline" was the
    // finding of the incident services/gitCredentials.ts opens with: the key
    // was named on no screen. A clone that fails with "Repository not found"
    // is nearly always the wrong key and never says so, so the run says which
    // one it was given, before the first step.
    //
    // Nothing is printed when the group has no reading credential, which is
    // every pipeline that existed before this did: they use the host's key
    // exactly as they always have.
    const gitRead = readAccessForGroup(pipeline.group);
    if (gitRead.command && gitRead.credential) {
      buildLogger.info(`🔑 git in this run reads with "${gitRead.credential.name}", stored on ${gitRead.credential.group}`);
    } else if (gitRead.problem) {
      buildLogger.error(`🔑 ${gitRead.problem}`);
    }


    // Note: We used to create/fetch a BuildHistoryEntry here (in-memory). 
    // Now we rely on BuildService (DB) and the 'build' object state.

    this.emit("build_start", build);


    const fromIdx = options.fromStep && !isResume ? pipeline.steps.findIndex((s) => s.name === options.fromStep) : -1;
    // An absolute cwd is taken as written; joining it onto the workspace made
    // "/srv/app" mean "<workspace>/srv/app", which nobody writing it meant.
    const stepCwd = (cwd: string | undefined, fallback: string) =>
      !cwd ? fallback : cwd === 'root' ? PROJECT_ROOT : path.isAbsolute(cwd) ? cwd : path.join(workspaceDir, cwd);

    // A step made of `steps:` runs its children in order, each in its parent's
    // cwd and env unless it sets its own. A leaf runs its command; markers it
    // prints open substeps under it, and close with it.
    const runTree = async (node: Step, nodePath: string, cwd: string, env: NodeJS.ProcessEnv, shell?: string): Promise<void> => {
      if (!node.steps?.length) {
        let ok = false;
        try {
          await this.runCommandLive(node.run, buildLogger, cwd, env, node.shell ?? shell, build.id);
          ok = true;
        } catch (e) {
          // The details go in the log here, at the level that ran the command, under its output.
          if (e instanceof CommandFailed && !e.logged && !build.isAborted) {
            const sub = nodePath.includes('.');
            if (sub) { e.detail.substep = nodePath; e.detail.substepName = node.name; }
            const { headline, lines } = failureLines(sub ? `Substep ${nodePath} "${node.name}"` : `Step "${node.name}"`, e.detail, String(env.PATH ?? ''));
            buildLogger.error(headline);
            for (const l of lines) buildLogger.info(l);
            e.logged = true;
          }
          throw e;
        } finally {
          substeps.closeMarkers(ok);
        }
        return;
      }
      for (let j = 0; j < node.steps.length; j++) {
        const child = node.steps[j];
        const childPath = `${nodePath}.${j + 1}`;
        if (build.isAborted) throw new Error('Build was aborted');
        substeps.enter(childPath);
        buildLogger.info(`▸ ${childPath} ${child.name}`);
        try {
          await runTree(child, childPath, stepCwd(child.cwd, cwd), { ...env, ...(child.env ?? {}) }, node.shell ?? shell);
          substeps.leave(childPath, true);
        } catch (e) {
          substeps.leave(childPath, false);
          if (!child.continueOnError) throw e;
          buildLogger.warn(`⚠️ ${childPath} ${child.name} failed; carrying on (continueOnError)`);
        }
      }
    };

    // Main Pipeline Magic
    for (let i = 0; i < pipeline.steps.length; i++) {
      const currentStep = pipeline.steps[i];
      stepIndex = i;
      try {
        if (fromIdx > 0 && i < fromIdx) {
          if (!build.stepTimings) build.stepTimings = {};
          build.stepTimings[currentStep.name] = { start: Date.now(), end: Date.now(), duration: 0, status: 'skipped' } as any;
          this.buildService.updateBuild(build.id, { stepTimings: build.stepTimings });
          buildLogger.info(`⏭️ Skipping '${currentStep.name}': this run starts at '${options.fromStep}'`);
          continue;
        }

        // Abort build check
        if (build.isAborted === true) {
          build.ended = new Date();
          // Record abort
          this.buildService.updateBuild(build.id, { isAborted: true, ended: build.ended, status: 'aborted' });

          buildLogger.info(`❌ Build Was Aborted`);
          this.emit("build_aborted", build); // ensure event is emitted if not already
          break;
        }

        // Check if step completed (Resume logic)
        const activeStepIndex = build.activeStep ? pipeline.steps.findIndex(s => s.name === build.activeStep) : -1;
        const currentStepIdx = i;

        if (activeStepIndex !== -1 && currentStepIdx < activeStepIndex) {
          buildLogger.info(`⏭️ Skipping completed step: ${currentStep.name}`);
          continue;
        }

        // Determine CWD for step
        const currentCwd = stepCwd(currentStep.cwd, workspaceDir);

        // Update build info
        build.activeStep = currentStep.name;
        build.percentage = Math.round(((i + 1) / pipeline.steps.length) * 100);

        // Start Timing
        if (!build.stepTimings) build.stepTimings = {};
        build.stepTimings[currentStep.name] = {
          start: new Date().getTime(),
          status: 'running'
        };

        // Update DB
        this.buildService.updateBuild(build.id, {
          activeStep: build.activeStep,
          percentage: build.percentage,
          stepTimings: build.stepTimings
        });
        // Update Metadata File
        fs.writeFileSync(metaFilePath, JSON.stringify(build, null, 2));

        this.emit("progress", build);

        buildLogger.info(
          currentStep.steps?.length
            ? `\n🔧 Step: ${currentStep.name} -> ${currentCwd}> ${currentStep.steps.length} substeps`
            : `\n🔧 Step: ${currentStep.name} -> ${currentCwd}> cmd: "${currentStep.run}"`
        );

        // Prepare environment variables for the step
        const pluginPaths = PluginManager.getInstance().getPluginBinPaths();
        const currentPath = process.env.PATH || '';
        const newPath = [...pluginPaths, currentPath].join(path.delimiter);

        const envVars = {
          ...process.env,
          PATH: newPath, // Override PATH
          // Below every file and every step, so a scope or a step that sets
          // its own GIT_SSH_COMMAND still wins: this is a default for the
          // group, not a rule about what a step may do.
          ...(gitRead.command ? { GIT_SSH_COMMAND: gitRead.command } : {}),
          // The layers loaded above, most specific last.
          //
          // These were composed and then not applied: the refactor that
          // stopped loadEnv writing into process.env removed the only path by
          // which they reached a step, and nothing replaced it. Every pipeline
          // ran with no configuration at all, which reads as "MISSING:
          // AZURE_TENANT_ID" and looks like an unset variable rather than a
          // variable that was read from disk and dropped on the floor.
          ...globalEnv,
          ...groupEnv,
          ...pipelineEnv,
          ...resourceEnv, // Inject RESOURCES
          // ABOVE every file, because a rollback is a more specific
          // instruction than any scope: deploy this exact tag whatever the
          // pipeline would otherwise have built. Per-run and never written
          // back, so the next ordinary run is unaffected.
          ...(options.envOverrides ?? {}),
          ...currentStep.env,
          // Inject Standard Pipeline Variables
          PIPELINE_ID: pipeline.id,
          PIPELINE_NAME: pipeline.appName,
          TARGET_NAME: pipeline.id, // Legacy support, aliased to ID
          BUILD_ID: build.id.toString(),
          ...(expectedSha ? { EZP_COMMIT_SHA: expectedSha } : {}),
          // Force headless/non-interactive mode for all commands
          GIT_TERMINAL_PROMPT: '0',           // Disable Git interactive prompts
          GIT_ASKPASS: 'echo',                // Prevent Git credential helper dialogs
          GCM_INTERACTIVE: 'never',           // Disable Git Credential Manager UI
          DEBIAN_FRONTEND: 'noninteractive',  // Disable apt-get prompts
          CI: 'true',                         // Many tools check this for headless mode
          TERM: 'dumb',                       // Disable fancy terminal features
        };

        // ANYTIME ACTIONS ARE NOT PART OF THE RUN.
        //
        // An `action` step is a button that sits on the build and waits to be
        // pressed, usually long after the pipeline has finished. Running it
        // here would defeat the entire point, and PAUSING here would be worse:
        // the run would stop at a step nobody intended as a gate.
        //
        // So it is stepped over, and the timing row is marked skipped rather
        // than left pending, because a step that shows "pending" on a finished
        // build reads as one that never got its turn.
        if (currentStep.type === 'action') {
          buildLogger.info(`⏭️ '${currentStep.name}' is an anytime action; it runs when somebody presses it`);
          if (build.stepTimings && build.stepTimings[currentStep.name]) {
            build.stepTimings[currentStep.name].status = 'skipped';
            this.buildService.updateBuild(build.id, { stepTimings: build.stepTimings });
          }
          continue;
        }

        // Check for special step types
        if (currentStep.type === 'approval') {
          buildLogger.info(`\n🔔 Step '${currentStep.name}' is an Approval Gate.`);
          buildLogger.info(`⏸️ Waiting for user approval...`);

          // Mark step as pending approval
          if (build.stepTimings && build.stepTimings[currentStep.name]) {
            build.stepTimings[currentStep.name].status = 'pending';
            this.buildService.updateBuild(build.id, { stepTimings: build.stepTimings, status: 'paused' });
          }
          fs.writeFileSync(metaFilePath, JSON.stringify(build, null, 2));
          this.emit("build_paused", build);

          // AUTO-APPROVAL RESUMES THROUGH THE NORMAL PATH, ON PURPOSE.
          //
          // It would be shorter to skip the pause and fall through, and that
          // would mean a second implementation of "mark the gate passed and
          // carry on" living next to approveBuild and drifting from it. So the
          // build pauses exactly as it always did and is then resumed by the
          // same call a human's click makes. The gate is still recorded as a
          // gate; what changed is who opened it.
          //
          // Only ever set by a git watch whose auto-approve is on. A manual run
          // of the same pipeline still waits.
          if (build.autoApprove) {
            buildLogger.warn(
              `⏭️ Auto-approving '${currentStep.name}': this run was triggered by a git watch with auto-approve enabled.`
            );
            setImmediate(() => {
              void this.approveBuild(build.id, { username: 'auto-approve (git watch)', userId: null, auto: true }).catch((e) =>
                buildLogger.error(`Auto-approval failed: ${e}`)
              );
            });
          }
          return; // Pause execution, controller will resume via approveBuild
        }

        // Execute Step (and its substeps, if it has any)
        substeps.beginStep(i, currentStep);
        try {
          await runTree(currentStep, String(i + 1), currentCwd, envVars, currentStep.shell);
          substeps.endStep(true);
        } catch (e) {
          substeps.endStep(false);
          throw e;
        }

        // End Timing Success
        if (build.stepTimings && build.stepTimings[currentStep.name]) {
          const end = new Date().getTime();
          build.stepTimings[currentStep.name].end = end;
          build.stepTimings[currentStep.name].duration = end - build.stepTimings[currentStep.name].start;
          build.stepTimings[currentStep.name].status = 'success';
          this.buildService.updateBuild(build.id, { stepTimings: build.stepTimings });
        }

        // If this was the last step, finalize the build
        if (i === pipeline.steps.length - 1) {
          build.ended = new Date();
          build.activeStep = undefined;
          this.buildService.updateBuild(build.id, { percentage: 100, ended: build.ended, activeStep: undefined, status: 'success' });
          fs.writeFileSync(metaFilePath, JSON.stringify(build, null, 2));

          this.recordProvenance(build.id, build.target, workspaceDir, buildLogger);
          this.emit("build_complete", build);
        }

      } catch (error) {
        // End Timing Failed
        if (build.stepTimings && build.stepTimings[currentStep.name]) {
          const end = new Date().getTime();
          build.stepTimings[currentStep.name].end = end;
          build.stepTimings[currentStep.name].duration = end - build.stepTimings[currentStep.name].start;
          build.stepTimings[currentStep.name].status = 'failed';
          build.stepTimings[currentStep.name].continueOnError = currentStep.continueOnError || false;
          this.buildService.updateBuild(build.id, { stepTimings: build.stepTimings });
        }

        const failure = error instanceof CommandFailed ? error.detail : null;
        if (failure && build.stepTimings?.[currentStep.name]) {
          // On the step, so the run page can say why without reading the log.
          (build.stepTimings[currentStep.name] as any).failure = {
            exitCode: failure.exitCode, signal: failure.signal, meaning: failure.meaning, substep: failure.substep, substepName: failure.substepName,
            lastLines: failure.lastLines, unset: failure.unset, empty: failure.empty,
            cwd: failure.cwd, shell: failure.shell, durationMs: failure.durationMs,
            // As the pipeline wrote it (names, not values); a long script is cut, the log has it whole.
            command: failure.command.trim().split('\n').slice(0, 3).join('\n').slice(0, 400),
            commandLines: failure.command.trim().split('\n').length,
          };
          this.buildService.updateBuild(build.id, { stepTimings: build.stepTimings });
        }
        const err = error as Error;
        this.build_error(build, failure && !build.isAborted ? Object.assign(new Error(failureSummary(currentStep.name, failure)), { stack: err.stack }) : err);
        fs.writeFileSync(metaFilePath, JSON.stringify(build, null, 2)); // Persist error state
        this.emit("build_error", build);
        if (build.isAborted) {
          buildLogger.warn(`Stopped: the run was cancelled during "${currentStep.name}".`);
        } else if (!(error instanceof CommandFailed && error.logged)) {
          // Not a command's exit (that block is already above): a gate, an action, a file the
          // runner could not read, or a fault in EZPipeline itself. Its own words, and for a
          // fault the stack, which is what a bug report needs.
          buildLogger.error(`✗ Step "${currentStep.name}" failed: ${err?.message ?? String(error)}`);
          if (err?.stack && err.name !== 'Error' && !(error instanceof CommandFailed)) {
            for (const l of err.stack.split('\n').slice(1, 8)) buildLogger.info(`  ${l.trim()}`);
          }
        }
        const runFor = Math.round((Date.now() - new Date(build.started).getTime()) / 1000);
        if (!build.isAborted) {
          buildLogger.info(currentStep.continueOnError
            ? `"${currentStep.name}" may fail (continueOnError), so the run carries on.`
            : `The run stopped at step ${i + 1} of ${pipeline.steps.length} after ${runFor}s.`);
        }
        if (!currentStep.continueOnError) {
          // A failed run records what it was made of too: "which commit broke
          // it" is the first question about a failure.
          this.recordProvenance(build.id, build.target, workspaceDir, buildLogger);
          return; // Stop execution if continueOnError is not true
        }
      }
    }

    // Final check if build completed successfully (e.g., if all steps were skipped due to resume)
    if (!build.ended && !build.isAborted && !build.error) {
      build.ended = new Date();
      build.activeStep = undefined;
      this.buildService.updateBuild(build.id, { percentage: 100, ended: build.ended, activeStep: undefined, status: 'success' });
      fs.writeFileSync(metaFilePath, JSON.stringify(build, null, 2));

      this.recordProvenance(build.id, build.target, workspaceDir, buildLogger);

      this.emit("build_complete", build);
    }
  }


  /**
   * Stop a build: set the flag, STOP THE WORK, and close the clock.
   *
   * ── WHAT THIS USED TO DO, AND WHY THAT WAS NOT ABORTING ──────────────────
   *
   * It set isAborted and wrote status 'aborted'. The step loop checks that
   * flag BETWEEN steps, so a build whose current step never returns was never
   * actually stopped - build #199 was marked aborted at 18:09 and its bash
   * child was still running at 18:22, still holding a Postgres firewall rule
   * open for an address nobody was using any more.
   *
   * It also never stamped `ended`, so ended_at stayed NULL. A build with a
   * start and no end is one the dashboard keeps timing: #199 read "Aborted"
   * in its header while its step counted past forty-five minutes underneath.
   *
   * ── SIGTERM FIRST, AND THAT IS NOT POLITENESS ────────────────────────────
   *
   * The steps here are shell scripts with EXIT traps that undo what they did -
   * ci-cd/scripts/with-postgres.sh opens a Postgres firewall rule and removes
   * it on any exit. SIGTERM lets bash run that trap; SIGKILL does not, and the
   * rule is left behind. So: SIGTERM the group, give it a few seconds to clean
   * up after itself, and only then insist.
   *
   * The NEGATIVE pid signals the whole process group rather than the shell
   * alone - bash running az running psql - which is the only way to stop the
   * tree. It works because runCommandLive spawns detached; without that the
   * child shares the server's group and this would kill the server.
   */
  public async abort(id: number | string) { // Updated type
    const buildId = String(id);
    const child = this.activeChildren.get(buildId);
    if (child?.pid) {
      const pid = child.pid;
      try {
        process.kill(-pid, "SIGTERM");
        this.logger.info(`Abort: asked build ${buildId} to stop (SIGTERM to group ${pid})`);
      } catch {
        // Already gone between the lookup and the signal, which is fine.
      }
      // Escalate only if it is still there. Unref'd so a pending timer can
      // never hold the process open on shutdown.
      const hard = setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
          this.logger.warn(`Abort: build ${buildId} ignored SIGTERM, sent SIGKILL`);
        } catch {
          // Exited during the grace period, which is the good outcome.
        }
        this.activeChildren.delete(buildId);
      }, 5000);
      hard.unref?.();
    }

    const build = this.builds.find(x => x.id === id);
    const ended = new Date();
    if (build) {
      build.isAborted = true;
      build.ended = ended;
      this.buildService.updateBuild(build.id, { isAborted: true, status: 'aborted', ended });
      this.emit("build_aborted", build);
    } else {
      // NOT IN MEMORY IS NOT NOTHING. `builds` is this process's own array, so
      // a build started before the last server restart is absent from it and
      // abort silently did nothing - the case where somebody is most likely to
      // be pressing the button. The row is the truth; write to it directly.
      this.buildService.updateBuild(buildId, { isAborted: true, status: 'aborted', ended } as any);
    }
  }

  public async rollback(pipelineId: string, version: string, smartRollbackYaml?: string) {
    this.logger.info(`\n⏪ Rollback/Restore requested for ${pipelineId} v${version}`);

    // Resolve Pipeline & Paths
    // We need to resolve pipelineDir same as run() does.
    // Ideally refactor resolution logic, but for now duplicate/adapt slightly or assume similar structure.
    // Or better, use existing pipeline object to find filePath.

    const pipeline = this.targets.find(t => t.id === pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    // Determine Paths (Simplified Logic based on known structure)
    let pipelineDir: string;
    if (pipeline.filePath) {
      const yamlDir = path.dirname(pipeline.filePath);
      if (fs.existsSync(path.join(yamlDir, '.pipeline'))) {
        pipelineDir = yamlDir;
      } else {
        const baseWorkspaceDir = path.join(PIPELINES_DIR, "_legacy_workspaces");
        pipelineDir = path.join(baseWorkspaceDir, pipelineId);
      }
    } else {
      // Fallback
      const baseWorkspaceDir = path.join(PIPELINES_DIR, "_legacy_workspaces");
      pipelineDir = path.join(baseWorkspaceDir, pipelineId);
    }

    const versionsDir = path.join(pipelineDir, "versions");
    const restoreWorkspace = path.join(versionsDir, "rollback_workspace");
    const artifactPath = path.join(versionsDir, `${version}.zip`);

    if (!fs.existsSync(artifactPath)) {
      // Check for Docker?
      // If docker, we might not have a local artifact file to unzip, just an image tag.
      // But users want to "download artifacts manually" too.
      // Assuming Zip for restore flow for now as per "unzip" requirement.
      // If it's a docker image, smartRollbackYaml should probably just reference the image tag.
      // BUT if we need workspace assets (k8s yamls, etc), we need the zip.
      // VersioningService currently does ONE or OTHER. 
      // If Docker, we don't have a zip. This is a limitation.
      // For now, fail if no zip.
      throw new Error(`Artifact not found at ${artifactPath}. Docker-only/missing builds cannot be file-restored yet.`);
    }

    // Prepare Restore Workspace
    if (fs.existsSync(restoreWorkspace)) {
      fs.rmSync(restoreWorkspace, { recursive: true, force: true });
    }
    fs.mkdirSync(restoreWorkspace, { recursive: true });

    // Unzip
    this.logger.info(`📦 Extracting artifact to ${restoreWorkspace}...`);
    try {
      execSync(`unzip -o "${artifactPath}" -d "${restoreWorkspace}"`, { stdio: 'inherit' });
    } catch (e) {
      throw new Error(`Failed to unzip artifact: ${e}`);
    }

    // Handle Smart Rollback YAML
    let runYaml = smartRollbackYaml;
    if (smartRollbackYaml) {
      const rollbackYamlPath = path.join(restoreWorkspace, '.rollback.yaml');
      fs.writeFileSync(rollbackYamlPath, smartRollbackYaml);
      this.logger.info(`📝 Written smart rollback YAML to ${rollbackYamlPath}`);
    } else {
      // Full manual redeploy? Use original pipeline.yaml or pipeline object?
      // If we want to run the *original* steps from that version, we hopefully have the yaml in the zip?
      // Or we use the *current* pipeline definition but apply it to the old code?
      // Usually "Redeploy" means "Run current pipeline on old code" or "Run old pipeline on old code".
      // The user said "create a temporary rollback yaml file that will skip all the parts that arent necessary".
      // If no smart yaml provided, maybe just warn or run standard?
      // Let's assume passed yaml is required for "rollback", or if null, run full pipeline (Redeploy).
    }

    // Execute
    // We use 'run' with custom options
    this.logger.info(`🚀 Executing Rollback/Redeploy...`);
    await this.run(pipelineId, undefined, {
      customYaml: smartRollbackYaml, // If null, uses standard pipeline
      customWorkspace: restoreWorkspace,
      skipClean: true // Don't wipe what we just unzipped
    });
  }

  public resolvePipelineDir(pipelineId: string): string {
    const pipeline = this.targets.find(t => t.id === pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    if (pipeline.filePath) {
      const yamlDir = path.dirname(pipeline.filePath);
      if (fs.existsSync(path.join(yamlDir, '.pipeline'))) {
        return yamlDir;
      } else {
        const baseWorkspaceDir = path.join(PIPELINES_DIR, "_legacy_workspaces");
        return path.join(baseWorkspaceDir, pipelineId);
      }
    } else {
      const baseWorkspaceDir = path.join(PIPELINES_DIR, "_legacy_workspaces");
      return path.join(baseWorkspaceDir, pipelineId);
    }
  }

  public generateRollbackPlan(pipelineId: string): any {
    const pipeline = this.targets.find(t => t.id === pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    // Heuristic: Keep only deployment steps
    const stepsToKeep = pipeline.steps.filter(step => {
      const n = step.name.toLowerCase();
      const r = step.run.toLowerCase();
      const isBuild = n.includes('build') || n.includes('compile') || n.includes('test') || r.includes('npm run build') || r.includes('docker build');
      const isDeploy = n.includes('deploy') || n.includes('release') || n.includes('publish') || r.includes('kubectl') || r.includes('helm') || r.includes('scp');
      return !isBuild;
    });

    const rollbackPipeline = { ...pipeline };
    rollbackPipeline.steps = stepsToKeep;
    return rollbackPipeline;
  }

  /**
   * Pass the approval gate a paused build is waiting at, and carry on.
   *
   * Refuses (ApprovalError) unless the build is paused AT AN APPROVAL STEP:
   * this used to resume whatever it was given, so approving a running or
   * finished build re-ran the rest of it from its active step.
   */
  public async approveBuild(buildId: string, by: { username: string; userId: number | null; auto?: boolean } = { username: 'unknown', userId: null }) {
    const buildData = this.buildService.getBuild(buildId);
    if (!buildData) throw new ApprovalError("not_found", "No such build.");

    const pipeline = this.targets.find(t => t.id === buildData.target);
    if (!pipeline) throw new ApprovalError("not_found", "That build's pipeline no longer exists.");

    const gate = pipeline.steps.find(s => s.name === buildData.active_step);
    if (buildData.status !== 'paused' || !gate || gate.type !== 'approval') {
      throw new ApprovalError("not_paused", "This build is not waiting for approval.");
    }
    if (!this.buildService.claimPaused(buildId)) {
      throw new ApprovalError("not_paused", "This build was already approved.");
    }
    const approval = { step: gate.name, by: by.username, userId: by.userId, at: new Date().toISOString(), auto: !!by.auto };
    this.buildService.addApproval(buildId, approval);

    // Construct Build Object
    const build: Build = {
      id: buildData.id,
      target: buildData.target,
      status: buildData.status,
      activeStep: buildData.active_step,
      percentage: buildData.percentage,
      version: buildData.version,
      started: new Date(buildData.started_at),
      ended: buildData.ended_at ? new Date(buildData.ended_at) : undefined,
      steps: pipeline.steps.map(s => s.name),
      isAborted: buildData.status === 'aborted',
      stepTimings: buildData.step_timings ? JSON.parse(buildData.step_timings) : {},
      autoApprove: buildData.auto_approve === 1,
      triggeredBy: buildData.triggered_by ?? undefined,
    };
    this.emit("build_approved", { ...build, status: 'running', approval });

    // Find active step index
    const activeIndex = pipeline.steps.findIndex(s => s.name === build.activeStep);
    if (activeIndex === -1) {
      // Should not happen if build is paused at approval
      // If completed, do nothing
      return;
    }

    // Mark the approval step as successful
    if (build.stepTimings && build.stepTimings[pipeline.steps[activeIndex].name]) {
      const end = new Date().getTime();
      build.stepTimings[pipeline.steps[activeIndex].name].end = end;
      build.stepTimings[pipeline.steps[activeIndex].name].duration = end - build.stepTimings[pipeline.steps[activeIndex].name].start;
      build.stepTimings[pipeline.steps[activeIndex].name].status = 'success';
      this.buildService.updateBuild(build.id, { stepTimings: build.stepTimings } as Partial<Build>);
    }

    // Resume from the next step
    if (activeIndex < pipeline.steps.length - 1) {
      const nextStep = pipeline.steps[activeIndex + 1];
      build.activeStep = nextStep.name;
      build.percentage = Math.round(((activeIndex + 2) / pipeline.steps.length) * 100);

      this.buildService.updateBuild(build.id, {
        activeStep: build.activeStep,
        percentage: build.percentage,
        status: 'running' // Change status back to running
      });

      // Resume
      this.run(build.target, build);
    } else {
      // Was the last step, so pipeline is complete
      build.percentage = 100;
      build.ended = new Date();
      build.activeStep = undefined;
      this.buildService.updateBuild(build.id, {
        percentage: 100,
        ended: build.ended,
        status: 'success'
      } as Partial<Build>);
      this.emit("build_complete", build);
    }
  }

  //#endregion
}
