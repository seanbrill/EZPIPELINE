// Steps that are not part of the run: buttons you can press whenever.
//
// WHAT THIS IS FOR. A pipeline finishes and then somebody does the next thing
// by hand - merges a branch, starts the production deploy, tells the team. The
// doing is mechanical, the DECIDING is not, and the gap between them is where
// people paste the wrong sha into the wrong terminal at midnight.
//
// An `action` step is that next thing, written down in the pipeline and
// triggered with one press. It never runs as part of the sequence. It sits on
// a finished build and waits, which is why it is called an ANYTIME action
// rather than a manual step: the point is not that a person starts it, it is
// that its timing is not tied to the run at all.
//
// WHY A CHAIN AND NOT ONE ACTION. The real thing somebody wants is rarely one
// verb. "Promote to production" is merge develop into main, then start the
// production deploy. Two buttons in the right order is a procedure somebody
// can get half-way through; one button that does both is the thing they meant.
//
// STOPS AT THE FIRST FAILURE, always. A chain that merged a branch and then
// failed to start the deploy must not report success, and must not carry on to
// a third action written on the assumption the second one worked.

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import Logger from "../controllers/Logger.js";

const run = promisify(execFile);
import { credentialForGroup, gitWith } from "./gitCredentials.js";

/** One link in the chain. `do` names the verb; the rest is that verb's own. */
export interface PipelineAction {
    do: string;
    [key: string]: unknown;
}

export interface ActionOutcome {
    /** Which action this was, for a UI that lists them as they happen. */
    index: number;
    action: string;
    ok: boolean;
    message: string;
}

export interface ActionContext {
    /** The build the button was pressed on. Actions may use its commit. */
    buildId: string;
    pipelineTarget: string;
    /** Who pressed it, for the log. */
    actor: string;
    /**
     * The repository this pipeline watches, if it watches one. Used as the
     * default for a merge, so the common case needs no repo written twice.
     */
    defaultRepoUrl?: string;
    /** Start another pipeline. Injected so this file does not import the controller. */
    startPipeline: (target: string, triggeredBy: string, autoApprove: boolean) => void;
    /** Does a pipeline with this id exist? Checked before anything is changed. */
    pipelineExists: (target: string) => boolean;
    /**
     * The group this pipeline belongs to, so a git write can find the
     * credential configured for it.
     *
     * WITHOUT THIS, a merge authenticates with whatever the SERVER HOST has -
     * unnamed, unreadable from the interface, and its permissions living on
     * the forge. That is how a read-only deploy key went unnoticed until the
     * first time anybody pressed a button that needed to write.
     */
    group?: string;
}

const logger = Logger.getInstance();

/** Every verb this understands, and a sentence about each for the UI. */
export const ACTION_KINDS: { value: string; label: string; hint: string }[] = [
    {
        value: "run-pipeline",
        label: "Start another pipeline",
        hint: "Runs a pipeline by id. Its own approval gates still apply unless you tick auto-approve.",
    },
    {
        value: "merge-branch",
        label: "Merge one branch into another",
        hint: "Fast-forward only, so it can never invent a merge commit or overwrite work.",
    },
    {
        value: "shell",
        label: "Run a command",
        hint: "Anything else. Runs on the EZPIPELINE host, not in a pipeline workspace.",
    },
    {
        value: "notify",
        label: "Write a notice",
        hint: "Puts a line in the log and on the dashboard. Says something happened; does nothing.",
    },
];

function asString(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

/**
 * Merge one branch into another, FAST-FORWARD ONLY.
 *
 * Implemented as a push of one ref onto another, which is exactly
 * `git push origin develop:main` and has the property that matters: git
 * refuses it unless the target is an ancestor of the source. So this can move
 * main forward onto develop and can never invent a merge commit, never
 * overwrite somebody's work, and never produce a conflict to resolve on a
 * server with nobody watching.
 *
 * No working tree is checked out. It fetches the one ref it needs and pushes
 * it, which is faster and leaves nothing on disk to go stale.
 */
async function mergeBranch(action: PipelineAction, ctx: ActionContext): Promise<string> {
    const from = asString(action.from);
    const into = asString(action.into);
    const repo = asString(action.repo) || ctx.defaultRepoUrl || "";

    if (!from || !into) throw new Error("merge-branch needs `from` and `into`");
    if (!repo) {
        throw new Error(
            "merge-branch has no repository: set `repo` on the action, or add a git watch to this pipeline"
        );
    }
    if (from === into) throw new Error(`merge-branch: \`from\` and \`into\` are both ${from}`);

    // The credential configured for this group, or none - in which case git
    // falls back to the host's own configuration, exactly as before. Passing
    // null is a supported state rather than an error: an instance that has
    // always worked keeps working, and the screen is how you improve on it.
    const cred = ctx.group ? credentialForGroup(ctx.group) : null;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ezp-merge-"));
    try {
        await gitWith(cred, ["init", "--quiet", dir]);
        await gitWith(cred, ["-C", dir, "remote", "add", "origin", repo]);
        await gitWith(cred, ["-C", dir, "fetch", "--quiet", "--depth", "1", "origin", from]);
        // FETCH_HEAD is the tip of `from`. Pushing it at `into` without --force
        // is the fast-forward check.
        const { stdout } = await gitWith(cred, [
            "-C", dir, "push", "origin", `FETCH_HEAD:refs/heads/${into}`,
        ]);
        const sha = (await gitWith(cred, ["-C", dir, "rev-parse", "--short=12", "FETCH_HEAD"])).stdout.trim();
        const said = stdout.trim() || "up to date";
        return `${from} -> ${into} at ${sha} (${said})`;
    } catch (e: unknown) {
        const err = e as { stderr?: string; message?: string };
        const detail = (err.stderr || err.message || String(e)).trim().slice(0, 400);
        // THE REFUSAL THAT ACTUALLY HAPPENED, and it said none of this. The
        // button reported git's sentence and left the operator with "not even
        // sure how the git credentials were set". Name the credential, say
        // where to fix it, and say what to do - GitHub deploy keys cannot be
        // edited after they are added, which is the part nobody guesses.
        if (/read only|denied to|permission/i.test(detail)) {
            const who = cred
                ? `The credential "${cred.name}" on the ${cred.group_path} group`
                : `The server host's own git configuration (this group has no credential set)`;
            throw new Error(
                `${who} cannot write to ${repo}. Git said: ${detail}\n` +
                `If this is a GitHub deploy key, it cannot be changed after it is added: ` +
                `delete it and add it again with "Allow write access" ticked. ` +
                `Then press Test on the group's Credentials tab, which asks this exact ` +
                `question without needing a deploy to find out.`
            );
        }
        // The failure worth naming, because it is the one that will happen.
        if (/non-fast-forward|rejected/i.test(detail)) {
            throw new Error(
                `${into} has commits that ${from} does not, so this cannot fast-forward. ` +
                `Merge them the other way first. Git said: ${detail}`
            );
        }
        throw new Error(detail);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function runPipeline(action: PipelineAction, ctx: ActionContext): Promise<string> {
    const target = asString(action.pipeline);
    if (!target) throw new Error("run-pipeline needs `pipeline` (a pipeline id)");
    if (!ctx.pipelineExists(target)) {
        throw new Error(
            `no pipeline with id ${target}. If it was renamed the id is unchanged; if it was ` +
            `deleted and recreated, the id is not.`
        );
    }
    // GATES STAY ON UNLESS THE ACTION SAYS OTHERWISE.
    //
    // Starting a production deploy and RELEASING one are different decisions,
    // so by default whatever gates that pipeline has still apply and somebody
    // still presses them. `autoApprove: true` folds the two together, which is
    // the right call when the button itself is the decision - "promote to
    // production" already means release it, and stopping at a second gate one
    // second later is ceremony rather than safety.
    //
    // Opt-in, and written in the pipeline where it can be read, rather than a
    // default that quietly removes a gate somebody put there.
    const autoApprove = action.autoApprove === true;
    ctx.startPipeline(target, `action by ${ctx.actor}`, autoApprove);
    return autoApprove ? `started ${target}, gates auto-approved` : `started ${target}`;
}

async function shell(action: PipelineAction): Promise<string> {
    const cmd = asString(action.run);
    if (!cmd) throw new Error("shell needs `run`");
    const { stdout, stderr } = await run(asString(action.shell) || "/bin/bash", ["-c", cmd], {
        maxBuffer: 1024 * 1024 * 8,
    });
    return (stdout || stderr || "done").trim().slice(0, 800);
}

async function notify(action: PipelineAction, ctx: ActionContext): Promise<string> {
    const message = asString(action.message) || "(no message)";
    logger.info(`[action] ${ctx.actor}: ${message}`);
    return message;
}

/**
 * Run a chain in order, stopping at the first failure.
 *
 * Returns what happened to every action that was attempted, so a caller can
 * show "merged, then failed to start the deploy" rather than one word.
 */
export async function runActionChain(
    actions: PipelineAction[],
    ctx: ActionContext
): Promise<{ ok: boolean; outcomes: ActionOutcome[] }> {
    const outcomes: ActionOutcome[] = [];

    for (const [index, action] of actions.entries()) {
        const kind = asString(action.do);
        try {
            let message: string;
            switch (kind) {
                case "merge-branch": message = await mergeBranch(action, ctx); break;
                case "run-pipeline": message = await runPipeline(action, ctx); break;
                case "shell": message = await shell(action); break;
                case "notify": message = await notify(action, ctx); break;
                default:
                    throw new Error(
                        `unknown action "${kind || "(none)"}". Known: ` +
                        ACTION_KINDS.map((k) => k.value).join(", ")
                    );
            }
            outcomes.push({ index, action: kind, ok: true, message });
            logger.info(`[action ${index + 1}/${actions.length}] ${kind}: ${message}`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            outcomes.push({ index, action: kind, ok: false, message });
            logger.error(`[action ${index + 1}/${actions.length}] ${kind} failed: ${message}`);
            // STOP. A later action was written assuming this one worked.
            return { ok: false, outcomes };
        }
    }

    return { ok: true, outcomes };
}
