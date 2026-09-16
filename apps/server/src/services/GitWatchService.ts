import { execFile } from "child_process";
import { promisify } from "util";
import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";
import EZPipelineController from "../controllers/EZPipelineController.js";

const execFileAsync = promisify(execFile);

export interface GitWatch {
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

/** How often the loop wakes. Individual watches are due on their own interval. */
const TICK_MS = 15_000;

/** `git ls-remote` against an unreachable host otherwise hangs the tick. */
const LS_REMOTE_TIMEOUT_MS = 20_000;

const MIN_POLL_SECONDS = 15;

/**
 * Runs a pipeline when a watched branch moves.
 *
 * ONE `git ls-remote` PER CHECK. No clone, no fetch, no working copy - it
 * returns the head sha and exits, so a 60-second poll against a large
 * repository costs the same as against an empty one. The pipeline does its own
 * clone when it actually runs.
 *
 * Deliberately not webhooks: this server usually has no inbound route from the
 * internet, so the forge cannot reach it. See migrations/008_git_watches.ts.
 */
/**
 * Which build statuses mean "this commit is already handled".
 *
 * Pulled out and exported so the RULE can be tested without opening the real
 * builds table - the same reason statusToWrite lives outside updateBuild, and
 * for the same reason: a test that can corrupt live build history is worse
 * than no test.
 *
 * THE OMISSIONS ARE THE POINT. `failed` and `aborted` are deliberately absent.
 * A failed build is an attempt, not an outcome, and counting it as done would
 * mean a watch could never retry a commit after somebody fixed whatever broke
 * it - which is precisely when a retry is wanted. `paused` counts because a
 * build waiting at an approval gate is work in progress that somebody is about
 * to decide on, and starting a second one beside it helps nobody.
 */
export const BUILT_STATUSES = ["running", "paused", "success"] as const;

/** Does a build in this status mean the commit needs no further run? */
export function shaCountsAsBuilt(status: string): boolean {
    return (BUILT_STATUSES as readonly string[]).includes(status);
}

export class GitWatchService {
    private static _instance: GitWatchService | null = null;
    private timer: NodeJS.Timeout | null = null;
    private logger = Logger.getInstance();
    private db = DatabaseService.getInstance();
    /** Guards against a slow tick overlapping the next one. */
    private ticking = false;

    static getInstance(): GitWatchService {
        if (!this._instance) this._instance = new GitWatchService();
        return this._instance;
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => void this.tick(), TICK_MS);
        // `unref` so the timer never keeps the process alive on shutdown.
        this.timer.unref?.();
        this.logger.info(`Git watch poller started (tick ${TICK_MS / 1000}s)`);
        void this.tick();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    private due(w: GitWatch): boolean {
        if (!w.last_checked_at) return true;
        const last = Date.parse(w.last_checked_at);
        if (Number.isNaN(last)) return true;
        const every = Math.max(MIN_POLL_SECONDS, w.poll_seconds) * 1000;
        return Date.now() - last >= every;
    }

    private async tick() {
        if (this.ticking) return;
        this.ticking = true;
        try {
            const db = this.db.getDb();
            const watches = db
                .prepare(`SELECT * FROM git_watches WHERE enabled = 1`)
                .all() as GitWatch[];

            for (const w of watches) {
                if (!this.due(w)) continue;
                // Sequential on purpose. These are network calls on somebody's
                // home connection, and a dozen at once to the same forge is how
                // you get rate limited for no gain - the whole point is that
                // each one is cheap.
                await this.check(w);
            }
        } catch (e) {
            this.logger.error(`Git watch tick failed: ${e}`);
        } finally {
            this.ticking = false;
        }
    }

    /** The head sha of one branch, or null if the remote could not be read. */
    private async headSha(repoUrl: string, branch: string): Promise<string> {
        // execFile, never a shell string: repo_url and branch come from a form,
        // and `git ls-remote "$(rm -rf ~)"` is not a risk worth taking for the
        // convenience of string interpolation.
        const { stdout } = await execFileAsync(
            "git",
            ["ls-remote", "--heads", repoUrl, branch],
            {
                timeout: LS_REMOTE_TIMEOUT_MS,
                // Never let git stop and ask for a password on a private repo:
                // an interactive prompt in a background poller hangs forever.
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
            }
        );
        const line = stdout.split("\n").find((l) => l.trim());
        if (!line) throw new Error(`branch '${branch}' not found on remote`);
        const sha = line.split(/\s+/)[0];
        if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`unexpected ls-remote output`);
        return sha;
    }

    private async check(w: GitWatch) {
        const db = this.db.getDb();
        const now = new Date().toISOString();

        let sha: string;
        try {
            sha = await this.headSha(w.repo_url, w.branch);
        } catch (e: any) {
            const msg = String(e?.message ?? e).slice(0, 500);
            db.prepare(
                `UPDATE git_watches SET last_checked_at = ?, last_error = ? WHERE id = ?`
            ).run(now, msg, w.id);
            this.logger.warn(`Git watch ${w.id} (${w.repo_url}#${w.branch}) failed: ${msg}`);
            return;
        }

        // FIRST SIGHTING ADOPTS, IT DOES NOT TRIGGER.
        //
        // A new watch has no previous sha, and treating "unknown" as "changed"
        // would deploy the currently-live commit the moment somebody saved the
        // form - and again after every restart if the sha were not persisted.
        // Enabling a watch is a statement about future pushes.
        if (!w.last_sha) {
            db.prepare(
                `UPDATE git_watches SET last_sha = ?, last_checked_at = ?, last_error = NULL WHERE id = ?`
            ).run(sha, now, w.id);
            this.logger.info(
                `Git watch ${w.id} adopted ${sha.slice(0, 12)} for ${w.repo_url}#${w.branch} (no run: first check)`
            );
            return;
        }

        if (sha === w.last_sha) {
            db.prepare(
                `UPDATE git_watches SET last_checked_at = ?, last_error = NULL WHERE id = ?`
            ).run(now, w.id);
            return;
        }

        // ONE RUN AT A TIME PER PIPELINE.
        //
        // Every build of a pipeline shares one workspace directory, and the
        // fetch step deletes and recreates it. So a second run starting while
        // the first is mid-build pulls the source out from under it: observed
        // as "The working directory has been deleted or recreated" followed by
        // "Unable to find 'web/Dockerfile'" - a failure whose message points at
        // a file that is present in the repository and absent from disk.
        //
        // Pushing several commits in a few minutes is enough to cause it, which
        // is exactly what a watch on a busy branch does.
        //
        // Checked BEFORE the sha is recorded, so a skipped tick is not a lost
        // commit: last_sha stays where it was and the next tick sees the head
        // as new again. It will then deploy whatever is newest, which is what
        // somebody pushing three times in a row wanted anyway.
        // A PAUSED BUILD IS SUPERSEDED, NOT RESPECTED.
        //
        // A build sitting at an approval gate is waiting for somebody to
        // release a commit the branch has already moved past. Nobody wants to
        // approve it: doing so deploys code that is no longer current.
        //
        // And because "paused" counts as in flight below, leaving it there does
        // not merely delay this push. It blocks EVERY later one, silently,
        // until a person notices the gate - so one unapproved run quietly turns
        // an auto-deploy off.
        //
        // The newer commit therefore wins. Aborting the stale run frees the
        // workspace and this tick carries on. A build that is genuinely RUNNING
        // is left alone: that is work in progress, not a decision nobody made.
        const superseded = this.abortSupersededPaused(w.pipeline_target, sha);
        if (superseded > 0) {
            this.logger.info(
                `Git watch ${w.id}: aborted ${superseded} paused build(s) of ${w.pipeline_target}, ` +
                `superseded by ${sha.slice(0, 12)}.`
            );
        }

        // ── THIS COMMIT MAY ALREADY HAVE BEEN DEPLOYED ON PURPOSE ────────
        //
        // The promote action does two things in order: merge develop into main,
        // then run the production pipeline. The merge MOVES THE BRANCH THIS
        // WATCH IS WATCHING, so one press produces two deploys of the same
        // commit - the one somebody asked for, and one this poller adds a few
        // seconds later.
        //
        // The existing isBuilding() guard does not prevent it, it only delays
        // it: the tick returns without recording the sha, so the next tick
        // starts the duplicate once the first run finishes. Every promote has
        // been costing a second full deployment of an identical sha.
        //
        // Asking whether this pipeline has ALREADY built this commit is the
        // honest test. It is not "was a build started recently" - a rebuild of
        // a different commit is exactly what a watch is for - it is "is there
        // nothing here to do", and when the answer is yes the sha is adopted so
        // the next tick does not ask again.
        //
        // A FAILED build of this sha does NOT count. Somebody pushing the same
        // commit again, or a watch re-checking after a fix elsewhere, is asking
        // for a retry, and refusing it because the last attempt failed would be
        // the worst possible reading of "already done".
        if (this.hasBuiltSha(w.pipeline_target, sha)) {
            this.logger.info(
                `Git watch ${w.id}: ${w.branch} is at ${sha.slice(0, 12)}, which ` +
                `${w.pipeline_target} has already built. Adopting the sha without running.`
            );
            db.prepare(
                `UPDATE git_watches
                 SET last_sha = ?, last_checked_at = ?, last_error = NULL
                 WHERE id = ?`
            ).run(sha, now, w.id);
            return;
        }

        if (this.isBuilding(w.pipeline_target)) {
            this.logger.info(
                `Git watch ${w.id}: ${w.branch} moved to ${sha.slice(0, 12)}, but a build of ` +
                `${w.pipeline_target} is already running. Leaving it for the next tick.`
            );
            db.prepare(`UPDATE git_watches SET last_checked_at = ? WHERE id = ?`).run(now, w.id);
            return;
        }

        // The sha is recorded BEFORE the run is started. If starting throws, or
        // the process dies mid-start, the alternative is a watch that retries
        // the same commit every tick forever.
        db.prepare(
            `UPDATE git_watches
             SET last_sha = ?, last_checked_at = ?, last_triggered_at = ?,
                 last_triggered_sha = ?, last_error = NULL
             WHERE id = ?`
        ).run(sha, now, now, sha, w.id);

        this.logger.info(
            `Git watch ${w.id}: ${w.repo_url}#${w.branch} moved to ${sha.slice(0, 12)}, running ${w.pipeline_target}`
        );

        try {
            const controller = EZPipelineController.instance;
            // Same reason as the scheduler and POST /run-pipeline: `targets` is
            // read at boot, so a pipeline.yaml edited any other way leaves this
            // process running the version it started with. A push-triggered run
            // is one nobody is watching, which is the worst place to execute a
            // stale definition.
            controller.refreshTargets();
            controller.run(w.pipeline_target, undefined, {
                autoApprove: w.auto_approve === 1,
                // The commit, not just "automatic": the first question about a
                // deploy nobody started is which push caused it.
                triggeredBy: `git watch ${w.branch}@${sha.slice(0, 7)}`,
            });
        } catch (e) {
            const msg = String(e).slice(0, 500);
            db.prepare(`UPDATE git_watches SET last_error = ? WHERE id = ?`).run(
                `triggered but failed to start: ${msg}`,
                w.id
            );
            this.logger.error(`Git watch ${w.id} failed to start pipeline: ${msg}`);
        }
    }

    /**
     * Is a build of this pipeline already in flight?
     *
     * "paused" counts. A build waiting at an approval gate still owns the
     * workspace, and starting a second one would delete the tree the first is
     * going to come back to.
     */
    /**
     * Abort paused builds of this pipeline that a newer commit has overtaken.
     *
     * ONLY 'paused', never 'running'. A paused build is parked at an approval
     * gate, so nothing is in flight and nothing is lost by ending it - the
     * commit it was waiting to release has been replaced. A running build is
     * doing work somebody is waiting on, and killing that to start again would
     * make a busy branch never finish a deploy at all.
     *
     * Marked aborted directly rather than through the controller, because the
     * runner is not executing anything for a paused build: it returned at the
     * gate and is waiting to be resumed by approveBuild. There is no child
     * process to signal, only a row that will otherwise sit there forever.
     *
     * Returns how many were ended, so the caller can say so. Failures are
     * logged and swallowed: this is housekeeping in front of a deploy, and a
     * housekeeping fault must not stop the deploy.
     */
    private abortSupersededPaused(pipelineTarget: string, bySha: string): number {
        try {
            const info = this.db
                .getDb()
                .prepare(
                    `UPDATE builds
                        SET status = 'aborted',
                            ended_at = ?,
                            error = ?
                      WHERE target = ? AND status = 'paused'`
                )
                .run(
                    new Date().toISOString(),
                    `superseded: ${bySha.slice(0, 12)} was pushed while this build waited for approval`,
                    pipelineTarget
                );
            return info.changes ?? 0;
        } catch (e) {
            this.logger.warn(`Git watch could not abort superseded paused builds: ${e}`);
            return 0;
        }
    }

    /**
     * Has this pipeline already built this exact commit?
     *
     * Running or succeeded counts; failed and aborted do not. A failed build is
     * an attempt, not an outcome, and treating it as "done" would mean a watch
     * could never retry a commit after somebody fixed whatever broke it.
     */
    private hasBuiltSha(target: string, sha: string): boolean {
        const db = this.db.getDb();
        const placeholders = BUILT_STATUSES.map(() => "?").join(", ");
        const row = db
            .prepare(
                `SELECT count(*) AS c FROM builds
                  WHERE target = ? AND commit_sha = ?
                    AND status IN (${placeholders})`
            )
            .get(target, sha, ...BUILT_STATUSES) as { c: number };
        return row.c > 0;
    }

    private isBuilding(pipelineTarget: string): boolean {
        try {
            const row = this.db
                .getDb()
                .prepare(
                    `SELECT 1 FROM builds
                      WHERE target = ? AND status IN ('running', 'paused')
                      LIMIT 1`
                )
                .get(pipelineTarget);
            return !!row;
        } catch (e) {
            // Unreadable means unknown, and unknown must not become "go ahead":
            // the whole point is to avoid a second run, so the safe answer when
            // we cannot tell is that there is one.
            this.logger.warn(`Git watch could not check for running builds: ${e}`);
            return true;
        }
    }

    /** Used by the routes to validate a repo/branch before saving a watch. */
    async probe(repoUrl: string, branch: string): Promise<{ ok: boolean; sha?: string; error?: string }> {
        try {
            const sha = await this.headSha(repoUrl, branch);
            return { ok: true, sha };
        } catch (e: any) {
            return { ok: false, error: String(e?.message ?? e).slice(0, 500) };
        }
    }
}
