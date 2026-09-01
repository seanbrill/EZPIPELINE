import { Request, Response } from 'express';
import { ResetService } from '../services/ResetService.js';
import Logger from './Logger.js';

export class SystemController {
    private static instance: SystemController;
    private resetService: ResetService;

    private constructor() {
        this.resetService = ResetService.getInstance();
    }

    public static getInstance(): SystemController {
        if (!SystemController.instance) SystemController.instance = new SystemController();
        return SystemController.instance;
    }

    public reset = async (req: Request, res: Response) => {
        const { mode } = req.body;

        try {
            Logger.getInstance().info(`System reset requested. Mode: ${mode}`);

            if (mode === 'smart') {
                await this.resetService.resetUsers(); // Alias for DB
                await this.resetService.resetPlugins();
                await this.resetService.resetClaude();
                await this.resetService.resetLogs();
                await this.resetService.resetPipelines(false); // Smart reset pipelines
            } else if (mode === 'factory') { // Everything / "Nuke"
                await this.resetService.resetUsers();
                await this.resetService.resetPlugins();
                await this.resetService.resetClaude();
                await this.resetService.resetLogs();
                await this.resetService.resetPipelines(true); // Full pipeline wipe
            } else {
                // Granular
                if (mode === 'pipelines') await this.resetService.resetPipelines(true);
                if (mode === 'logs') await this.resetService.resetLogs();
                if (mode === 'users') await this.resetService.resetUsers();
                if (mode === 'plugins') await this.resetService.resetPlugins();
                if (mode === 'claude') await this.resetService.resetClaude();
            }

            res.json({ success: true, message: "Reset action completed" });
        } catch (error) {
            Logger.getInstance().error(`Reset failed: ${error}`);
            res.status(500).json({ error: "Reset failed", details: String(error) });
        }
    }
}
