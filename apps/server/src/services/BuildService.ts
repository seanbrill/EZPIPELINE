import { DatabaseService } from "./Database.js";
import { Build } from "../types/other/index.js";
import { v4 as uuidv4 } from 'uuid';

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

        // Infer status
        if ((updates as any).error) {
            fields.push("status = ?"); values.push('failed');
        } else if (updates.isAborted) {
            fields.push("status = ?"); values.push('aborted');
        } else if (updates.percentage && updates.percentage >= 100) {
            fields.push("status = ?"); values.push('success');
        }

        if (fields.length === 0) return;

        values.push(id);
        const sql = `UPDATE builds SET ${fields.join(", ")} WHERE id = ?`;
        db.prepare(sql).run(...values);
    }

    public log(buildId: string, message: string) {
        const db = this.db.getDb();
        db.prepare("INSERT INTO build_logs (build_id, message) VALUES (?, ?)").run(buildId, message);
    }

    public getRecentBuilds(limit = 50): any[] {
        const db = this.db.getDb();
        return db.prepare("SELECT * FROM builds ORDER BY started_at DESC LIMIT ?").all(limit);
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

    public clearBuildHistory(target?: string) {
        const db = this.db.getDb();
        if (target) {
            // Get all build IDs for this target
            const builds = db.prepare("SELECT id FROM builds WHERE target = ?").all(target) as { id: string }[];
            const ids = builds.map(b => b.id);

            if (ids.length === 0) return;

            const placeholders = ids.map(() => '?').join(',');
            db.prepare(`DELETE FROM build_logs WHERE build_id IN (${placeholders})`).run(...ids);
            db.prepare("DELETE FROM builds WHERE target = ?").run(target);
        } else {
            // Clear ALL
            db.prepare("DELETE FROM build_logs").run();
            db.prepare("DELETE FROM builds").run();
        }
    }

    public clearBuildsByTargets(targets: string[]) {
        if (targets.length === 0) return;
        const db = this.db.getDb();
        const targetPlaceholders = targets.map(() => '?').join(',');

        // Get IDs
        const builds = db.prepare(`SELECT id FROM builds WHERE target IN (${targetPlaceholders})`).all(...targets) as { id: string }[];
        const ids = builds.map(b => b.id);

        if (ids.length === 0) return;

        const idPlaceholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM build_logs WHERE build_id IN (${idPlaceholders})`).run(...ids);
        db.prepare(`DELETE FROM builds WHERE target IN (${targetPlaceholders})`).run(...targets);
    }
}
