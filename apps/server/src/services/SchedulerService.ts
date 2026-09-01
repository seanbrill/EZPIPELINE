import cron from 'node-cron';
import { DatabaseService } from './Database.js';
import Logger from '../controllers/Logger.js';
import EZPipelineController from '../controllers/EZPipelineController.js';

interface Schedule {
    id: number;
    pipeline_target: string;
    cron_expression: string;
    enabled: number;
    created_by: number | null;
    created_at: string;
    last_run: string | null;
    next_run: string | null;
}

export class SchedulerService {
    private static instance: SchedulerService;
    private tasks: Map<number, any> = new Map();
    private db = DatabaseService.getInstance();
    private logger = Logger.getInstance();

    private constructor() {
        // Private constructor for singleton
    }

    public static getInstance(): SchedulerService {
        if (!SchedulerService.instance) {
            SchedulerService.instance = new SchedulerService();
        }
        return SchedulerService.instance;
    }

    /**
     * Load all enabled schedules from database and register cron tasks
     */
    public loadSchedules() {
        this.logger.info("Loading pipeline schedules...");

        try {
            const db = this.db.getDb();
            const schedules = db.prepare(`
                SELECT * FROM schedules WHERE enabled = 1
            `).all() as Schedule[];

            this.logger.info(`Found ${schedules.length} enabled schedules`);

            for (const schedule of schedules) {
                this.registerSchedule(schedule);
            }
        } catch (e) {
            this.logger.error(`Failed to load schedules: ${e}`);
        }
    }

    /**
     * Register a cron task for a schedule
     */
    private registerSchedule(schedule: Schedule) {
        try {
            // Validate cron expression
            if (!cron.validate(schedule.cron_expression)) {
                this.logger.warn(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cron_expression}`);
                return;
            }

            // Stop existing task if any
            if (this.tasks.has(schedule.id)) {
                this.tasks.get(schedule.id)?.stop();
                this.tasks.delete(schedule.id);
            }

            // Create new cron task
            const task = cron.schedule(schedule.cron_expression, () => {
                this.executePipeline(schedule);
            });

            this.tasks.set(schedule.id, task);

            // Calculate next run time
            this.updateNextRun(schedule.id);

            this.logger.info(`Registered schedule ${schedule.id} for pipeline ${schedule.pipeline_target} with cron: ${schedule.cron_expression}`);
        } catch (e) {
            this.logger.error(`Failed to register schedule ${schedule.id}: ${e}`);
        }
    }

    /**
     * Execute a pipeline from a schedule
     */
    private async executePipeline(schedule: Schedule) {
        this.logger.info(`Executing scheduled pipeline: ${schedule.pipeline_target}`);

        try {
            // Update last run time
            const db = this.db.getDb();
            db.prepare(`
                UPDATE schedules 
                SET last_run = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run(schedule.id);

            // Trigger pipeline build
            const controller = EZPipelineController.instance;
            controller.run(schedule.pipeline_target);

            this.logger.info(`Scheduled pipeline ${schedule.pipeline_target} started successfully`);

            // Update next run time
            this.updateNextRun(schedule.id);
        } catch (e) {
            this.logger.error(`Failed to execute scheduled pipeline ${schedule.pipeline_target}: ${e}`);
        }
    }

    /**
     * Calculate and update next run time for a schedule
     */
    private updateNextRun(scheduleId: number) {
        try {
            const db = this.db.getDb();
            const schedule = db.prepare("SELECT cron_expression FROM schedules WHERE id = ?").get(scheduleId) as Schedule;

            if (!schedule) return;

            // For simplicity, we'll just set it to current time + 1 minute
            // In a real implementation, you'd parse the cron expression to calculate exact next run
            const nextRun = new Date(Date.now() + 60000).toISOString();

            db.prepare(`
                UPDATE schedules 
                SET next_run = ? 
                WHERE id = ?
            `).run(nextRun, scheduleId);
        } catch (e) {
            this.logger.warn(`Failed to update next run time for schedule ${scheduleId}: ${e}`);
        }
    }

    /**
     * Add a new schedule
     */
    public addSchedule(pipelineTarget: string, cronExpression: string, userId: number): number {
        // Validate cron expression
        if (!cron.validate(cronExpression)) {
            throw new Error("Invalid cron expression");
        }

        try {
            const db = this.db.getDb();
            const result = db.prepare(`
                INSERT INTO schedules (pipeline_target, cron_expression, enabled, created_by)
                VALUES (?, ?, 1, ?)
            `).run(pipelineTarget, cronExpression, userId);

            const scheduleId = result.lastInsertRowid as number;

            // Load and register the new schedule
            const schedule = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as Schedule;
            this.registerSchedule(schedule);

            this.logger.info(`Created schedule ${scheduleId} for pipeline ${pipelineTarget}`);
            return scheduleId;
        } catch (e) {
            this.logger.error(`Failed to add schedule: ${e}`);
            throw e;
        }
    }

    /**
     * Remove a schedule
     */
    public removeSchedule(scheduleId: number) {
        try {
            // Stop the cron task
            if (this.tasks.has(scheduleId)) {
                this.tasks.get(scheduleId)?.stop();
                this.tasks.delete(scheduleId);
            }

            // Delete from database
            const db = this.db.getDb();
            db.prepare("DELETE FROM schedules WHERE id = ?").run(scheduleId);

            this.logger.info(`Removed schedule ${scheduleId}`);
        } catch (e) {
            this.logger.error(`Failed to remove schedule ${scheduleId}: ${e}`);
            throw e;
        }
    }

    /**
     * Enable/disable a schedule
     */
    public toggleSchedule(scheduleId: number, enabled: boolean) {
        try {
            const db = this.db.getDb();
            db.prepare("UPDATE schedules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, scheduleId);

            if (enabled) {
                // Re-register the schedule
                const schedule = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as Schedule;
                this.registerSchedule(schedule);
            } else {
                // Stop the task
                if (this.tasks.has(scheduleId)) {
                    this.tasks.get(scheduleId)?.stop();
                    this.tasks.delete(scheduleId);
                }
            }

            this.logger.info(`Schedule ${scheduleId} ${enabled ? 'enabled' : 'disabled'}`);
        } catch (e) {
            this.logger.error(`Failed to toggle schedule ${scheduleId}: ${e}`);
            throw e;
        }
    }

    /**
     * Get all schedules for a pipeline
     */
    public getSchedulesForPipeline(pipelineTarget: string): Schedule[] {
        try {
            const db = this.db.getDb();
            return db.prepare("SELECT * FROM schedules WHERE pipeline_target = ?").all(pipelineTarget) as Schedule[];
        } catch (e) {
            this.logger.error(`Failed to get schedules for pipeline ${pipelineTarget}: ${e}`);
            return [];
        }
    }

    /**
     * Get all schedules
     */
    public getAllSchedules(): Schedule[] {
        try {
            const db = this.db.getDb();
            return db.prepare("SELECT * FROM schedules ORDER BY created_at DESC").all() as Schedule[];
        } catch (e) {
            this.logger.error(`Failed to get all schedules: ${e}`);
            return [];
        }
    }
}
