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
