import { DatabaseService } from "./Database.js";
import { Build } from "../types/other/index.js";
import { v4 as uuidv4 } from 'uuid';

/**
 * Which status a write should land, given what the caller passed.
 *
 * Pulled out of updateBuild so the rule can be tested. The database path is
 * resolved at import time in DatabaseService, so exercising updateBuild itself
 * means opening the REAL builds table, and a test that can corrupt live build
 * history is worse than no test.
 *
 * THE RULE. Outcomes beat states. `error` and `isAborted` describe how a build
 * ENDED, and a status passed on the same call cannot argue with that. Anything
 * else defers to what the caller actually said, and only then falls back to
 * inferring success from a completed percentage.
 *
 * ── WHY isAborted IS CHECKED BEFORE error ────────────────────────────────
 *
 * Because an aborted build ALWAYS carries an error too. Abort kills the step's
 * process group, the step rejects with "Command was stopped (SIGTERM)", and
 * build_error reports it. So the two outcomes are not alternatives to choose
 * between - on every real abort BOTH are set, and the error is a consequence
 * of the abort rather than an independent fact about it.
 *
 * With `error` first, every deliberate abort was recorded as 'failed'. That
 * defeated the guard in build_error, which goes to the trouble of detecting
 * the abort and passing status 'aborted' - and then loses to this function one
 * layer down. Two correct-looking halves, the wrong answer between them.
 *
 * The old tests missed it by checking each flag ALONE: `{error}` -> failed and
 * `{isAborted, status}` -> aborted both passed, and the pair that actually
 * occurs was never asked about.
 *
 * Returning undefined means "do not write a status", which is not the same as
 * writing one and is why this returns a value rather than a string.
 */
export function statusToWrite(updates: Record<string, any>): string | undefined {
    if (updates.isAborted) return 'aborted';
    if (updates.error) return 'failed';
    if (updates.status !== undefined) return updates.status;
    if (updates.percentage && updates.percentage >= 100) return 'success';
    return undefined;
}

export class BuildService {
    private static instance: BuildService;
    private db = DatabaseService.getInstance();

    private constructor() { }

    public static getInstance(): BuildService {
        if (!BuildService.instance) {
            BuildService.instance = new BuildService();
        }
        return BuildService.instance;
    }

    public createBuild(target: string, version: string, triggeredBy?: string): string {
        const id = uuidv4();
        const db = this.db.getDb();

        // Calculate next build number for this target
        const row = db.prepare("SELECT MAX(build_number) as maxNum FROM builds WHERE target = ?").get(target) as { maxNum: number };
        const nextBuildNumber = (row?.maxNum || 0) + 1;

        const stmt = db.prepare("INSERT INTO builds (id, target, status, active_step, percentage, version, started_at, build_number, triggered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        stmt.run(id, target, 'running', 'Initializing', 0, version, new Date().toISOString(), nextBuildNumber, triggeredBy ?? null);
        return id;
    }

    /**
     * A build that was running when this process stopped is not running now.
     *
     * WHY THIS EXISTS. A build's status lives in sqlite and its EXECUTION lives
     * in this process. Stop the server mid-build - a restart, a crash, a
     * container replaced under a deploy, a file saved while tsx is watching -
     * and the row goes on saying `running` forever. Nothing ever revisits it,
     * because the thing that would have written the ending died with the
     * child process.
     *
     * That is not only an untidy row. GitWatchService refuses to start a build
     * for a target that already has one running, deliberately, so ONE orphan
     * silently stops every future automatic deploy of that pipeline - and the
     * symptom is "the watch stopped working", days later, with nothing in the
     * logs to connect it to a restart nobody remembers.
     *
     * So it is settled at boot, once, before anything else can read the table.
     * Marked `failed` rather than `aborted`: nobody chose this, and the error
     * says exactly what happened so the row does not have to be guessed at.
     *
     * What this CANNOT do is stop the work. A step that shelled out to a
     * server-side build - `az acr build`, a remote job - is still going on
     * somewhere, and its result will simply never be collected. The message
     * says so, because "failed" on its own would be read as "nothing ran".
     */
    public failOrphanedBuilds(): number {
        const db = this.db.getDb();
        const orphans = db
            .prepare("SELECT id, target, active_step FROM builds WHERE status = 'running'")
            .all() as { id: string; target: string; active_step: string | null }[];
        if (orphans.length === 0) return 0;

        const now = new Date().toISOString();
        const update = db.prepare(
            "UPDATE builds SET status = 'failed', error = ?, ended_at = ? WHERE id = ?"
        );
        const note = db.prepare("INSERT INTO build_logs (build_id, message) VALUES (?, ?)");
        db.transaction(() => {
            for (const o of orphans) {
                const where = o.active_step ? ` during "${o.active_step}"` : "";
                update.run(
                    `The server stopped while this build was running${where}, so it was never finished. Anything it had already handed to a remote builder may still have completed - this only means nothing collected the result.`,
                    now,
                    o.id
                );
                note.run(
                    o.id,
                    `[EZPIPELINE] Marked failed at startup: the server restarted while this build was running${where}.`
                );
            }
        })();
        return orphans.length;
    }

    public updateBuild(id: string, updates: Partial<Build>) {
        const db = this.db.getDb();

        const fields: string[] = [];
        const values: any[] = [];

        if ((updates as any).triggeredBy !== undefined) { fields.push("triggered_by = ?"); values.push((updates as any).triggeredBy); }
        if (updates.activeStep !== undefined) { fields.push("active_step = ?"); values.push(updates.activeStep); }
        if (updates.percentage !== undefined) { fields.push("percentage = ?"); values.push(updates.percentage); }
        if (updates.ended !== undefined) { fields.push("ended_at = ?"); values.push(updates.ended.toISOString()); }
        if ((updates as any).error !== undefined) { fields.push("error = ?"); values.push((updates as any).error); }
        if ((updates as any).stepTimings !== undefined) {
            fields.push("step_timings = ?");
            values.push(JSON.stringify((updates as any).stepTimings));
        }

        // Status: STATED BEATS INFERRED. See statusToWrite above.
        //
        // This used to infer the status and nothing else, so a caller passing
        // one explicitly had it silently dropped. The approval gate does
        // exactly that:
        //
        //     updateBuild(id, { stepTimings, status: 'paused' })
        //
        // and the row stayed 'running'. The runner had genuinely parked and
        // said so in its log, while every reader of the database - the
        // dashboard included - was told the build was still working.
        const status = statusToWrite(updates as Record<string, any>);
        if (status !== undefined) { fields.push("status = ?"); values.push(status); }

        if (fields.length === 0) return;

        values.push(id);
        const sql = `UPDATE builds SET ${fields.join(", ")} WHERE id = ?`;
        db.prepare(sql).run(...values);
    }

    /**
     * Append a line to a build's log. NEVER THROWS.
     *
     * ── THE CRASH THIS EXISTS FOR ──────────────────────────────────────────
     *
     * Sean cleared the build history for a group while a deploy was still
     * running. The DELETE removed the `builds` row; the runner carried on and
     * called this a moment later; `build_logs.build_id` is a foreign key to a
     * row that no longer existed, so the INSERT threw SQLITE_CONSTRAINT_-
     * FOREIGNKEY from inside a socket data handler - where nothing was
     * catching it. An unhandled throw on that path takes the whole process
     * down, and it did: the container stayed up because the server runs under
     * a watcher, so it looked alive while answering nothing.
     *
     * ── WHY SWALLOWING IS RIGHT HERE, SPECIFICALLY ────────────────────────
     *
     * A log line is the one thing in this service that must never be more
     * important than the thing it is describing. Every other method writes
     * state somebody acts on; this one writes commentary. A build whose row
     * has been deleted has nowhere to log and nothing that would read it - so
     * the correct response to "that build is gone" is to stop writing, not to
     * take down the server that is running four other pipelines.
     *
     * The failure is reported to stderr rather than silently dropped, because
     * a log method that hides its own failure is how a whole run turns up
     * empty and nobody can say why.
     */
    public log(buildId: string, message: string) {
        try {
            const db = this.db.getDb();
            db.prepare("INSERT INTO build_logs (build_id, message) VALUES (?, ?)").run(buildId, message);
        } catch (e) {
            const why = e instanceof Error ? e.message : String(e);
            console.warn(`[BuildService] dropped a log line for build ${buildId}: ${why}`);
        }
    }

    public getRecentBuilds(limit = 50): any[] {
        const db = this.db.getDb();
        return db.prepare("SELECT * FROM builds ORDER BY started_at DESC LIMIT ?").all(limit);
    }

    /**
     * The newest builds PER PIPELINE, rather than the newest builds overall.
     *
     * ── WHY THIS EXISTS ────────────────────────────────────────────────────
     *
     * getRecentBuilds takes the newest N across the whole table, and the
     * dashboard then filters that down to the pipeline you are looking at. So
     * pipelines COMPETE for the same N slots: with the limit at 100, a project
     * with 197 builds of its own showed 79 of them, because the other 21 slots
     * had gone to three unrelated pipelines. The history looked truncated for
     * reasons that had nothing to do with that pipeline.
     *
     * Partitioning by target fixes the competition. Each pipeline gets its own
     * window, so adding a new pipeline can never shorten an existing one's
     * history.
     *
     * ── WHY IT IS STILL BOUNDED ────────────────────────────────────────────
     *
     * The cap is per pipeline and high enough to be invisible in practice -
     * the busiest pipeline here reached 200 builds over several months. It is
     * not removed altogether because this list is serialised into one HTTP
     * response and rendered as one list: unbounded means the dashboard gets
     * slower every week forever, which is a worse bug than the one being
     * fixed and arrives too gradually to notice.
     *
     * Newest first, which is what stepEstimates documents that it needs.
     */
    public getRecentBuildsPerPipeline(perPipeline = 500): any[] {
        const db = this.db.getDb();
        return db.prepare(`
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY target ORDER BY started_at DESC
                ) AS rn
                FROM builds
            )
            WHERE rn <= ?
            ORDER BY started_at DESC
        `).all(perPipeline);
    }

    public getBuild(id: string): any {
        const db = this.db.getDb();
        return db.prepare("SELECT * FROM builds WHERE id = ?").get(id);
    }

    public getBuildLogs(buildId: string): any[] {
        const db = this.db.getDb();
        return db.prepare("SELECT message, timestamp FROM build_logs WHERE build_id = ? ORDER BY id ASC").all(buildId);
    }

    public deleteBuild(id: string) {
        const db = this.db.getDb();
        // Logs should cascade if foreign keys are set up, but let's be safe or assume FK handle it. 
        // If not using foreign keys with cascade delete, we might need to delete logs first.
        // Assuming simple sqlite setup, let's explicit delete logs first to be safe.
        db.prepare("DELETE FROM build_logs WHERE build_id = ?").run(id);
        db.prepare("DELETE FROM builds WHERE id = ?").run(id);
    }

    /**
     * Same rule as clearBuildsByTargets: history is what has finished.
     *
     * Both branches used to take running builds with them - the per-pipeline
     * one by deleting on `target`, and the clear-ALL one by deleting the whole
     * table. See clearBuildsByTargets for the crash that came of it.
     */
    public clearBuildHistory(target?: string) {
        const db = this.db.getDb();
        const finished = target
            ? db.prepare(
                  "SELECT id FROM builds WHERE target = ? AND status NOT IN ('running', 'paused')"
              ).all(target)
            : db.prepare(
                  "SELECT id FROM builds WHERE status NOT IN ('running', 'paused')"
              ).all();
        const ids = (finished as { id: string }[]).map(b => b.id);

        if (ids.length === 0) return;

        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM build_logs WHERE build_id IN (${placeholders})`).run(...ids);
        // BY ID in both branches. Deleting by target, or truncating the table,
        // is what took the in-flight rows the SELECT above just spared.
        db.prepare(`DELETE FROM builds WHERE id IN (${placeholders})`).run(...ids);
    }

    /**
     * Clear a group's HISTORY, which does not include what is still happening.
     *
     * ── THE CRASH THIS EXISTS FOR ──────────────────────────────────────────
     *
     * This deleted every build for the group, running ones included. Sean
     * cleared the Notch.fm history while a deploy-prod was mid-run: the row
     * went, the runner carried on and called BuildService.log a second later,
     * and the foreign key from build_logs to a build that no longer existed
     * threw from inside a socket handler with nothing catching it. The server
     * process died. The container stayed up - it runs under a watcher - so it
     * looked healthy while answering nothing on 5001.
     *
     * `log()` no longer throws, which stops that from being fatal. This is the
     * other half, and it is the one that makes the button mean what it says: a
     * build that is RUNNING is not history. Deleting its row while its runner
     * is still writing to it loses the log of the thing you are currently
     * watching, and leaves a live process with nowhere to report.
     *
     * Paused counts as in-flight for the same reason: it is waiting for
     * somebody, and it resumes into a row that has to still be there.
     */
    public clearBuildsByTargets(targets: string[]) {
        if (targets.length === 0) return;
        const db = this.db.getDb();
        const targetPlaceholders = targets.map(() => '?').join(',');

        // Finished builds only. The status list is the in-flight one, negated,
        // so a status added later is treated as history rather than silently
        // becoming undeletable.
        const builds = db.prepare(
            `SELECT id FROM builds
              WHERE target IN (${targetPlaceholders})
                AND status NOT IN ('running', 'paused')`
        ).all(...targets) as { id: string }[];
        const ids = builds.map(b => b.id);

        if (ids.length === 0) return;

        const idPlaceholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM build_logs WHERE build_id IN (${idPlaceholders})`).run(...ids);
        // BY ID, not by target: deleting by target again would take the
        // running rows the SELECT above deliberately spared.
        db.prepare(`DELETE FROM builds WHERE id IN (${idPlaceholders})`).run(...ids);
    }
}
