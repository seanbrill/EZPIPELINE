import fs from 'fs';
import path from 'path';
import { DATA_DIR, SANDBOX_DIR } from '../config/index.js';
import Logger from '../controllers/Logger.js';

export class ResetService {
    private static instance: ResetService;

    private constructor() { }

    public static getInstance(): ResetService {
        if (!ResetService.instance) {
            ResetService.instance = new ResetService();
        }
        return ResetService.instance;
    }

    private getPaths() {
        return {
            pipelines: path.join(DATA_DIR, 'pipelines'),
            plugins: path.join(DATA_DIR, 'plugins'),
            logs: path.resolve(DATA_DIR, '..', 'logs'), // Assuming logs are in apps/server/logs
            sandbox: SANDBOX_DIR,
            db: path.join(DATA_DIR, 'app.db')
        };
    }

    public async resetPipelines(factoryReset: boolean = false) {
        const paths = this.getPaths();
        if (!fs.existsSync(paths.pipelines)) return;

        if (factoryReset) {
            Logger.getInstance().info("Performing Factory Reset on Pipelines...");
            fs.rmSync(paths.pipelines, { recursive: true, force: true });
            fs.mkdirSync(path.join(paths.pipelines, 'General'), { recursive: true });
        } else {
            Logger.getInstance().info("Performing Smart Reset on Pipelines (History only)...");
            // Smart Reset logic: clear builds, build-history, versions
            const processPipelineDir = (pDir: string) => {
                const builds = path.join(pDir, 'builds');
                const history = path.join(pDir, 'build-history');
                const versions = path.join(pDir, 'versions');
                [builds, history, versions].forEach(d => {
                    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
                });
            };

            const groups = fs.readdirSync(paths.pipelines);
            for (const group of groups) {
                const groupPath = path.join(paths.pipelines, group);
                if (fs.statSync(groupPath).isDirectory()) {
                    processPipelineDir(groupPath); // Direct pipeline check
                    // Check children (Groups)
                    const children = fs.readdirSync(groupPath);
                    for (const child of children) {
                        const childPath = path.join(groupPath, child);
                        if (fs.statSync(childPath).isDirectory()) {
                            processPipelineDir(childPath);
                        }
                    }
                }
            }
        }
    }

    public async resetPlugins() {
        const paths = this.getPaths();
        if (fs.existsSync(paths.plugins)) {
            Logger.getInstance().info("Resetting Plugins...");
            fs.rmSync(paths.plugins, { recursive: true, force: true });
            fs.mkdirSync(paths.plugins, { recursive: true });
        }
    }

    public async resetLogs() {
        const paths = this.getPaths();
        if (fs.existsSync(paths.logs)) {
            Logger.getInstance().info("Resetting Logs...");
            const files = fs.readdirSync(paths.logs);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    fs.unlinkSync(path.join(paths.logs, file));
                }
            }
        }
    }

    public async resetClaude() {
        const paths = this.getPaths();
        if (fs.existsSync(paths.sandbox)) {
            Logger.getInstance().info("Resetting Claude Sandbox...");
            fs.rmSync(paths.sandbox, { recursive: true, force: true });
            fs.mkdirSync(paths.sandbox);
        }
    }

    public async resetUsers() {
        const paths = this.getPaths();
        if (fs.existsSync(paths.db)) {
            Logger.getInstance().info("Resetting Database...");
            fs.unlinkSync(paths.db);
            // Database service will need to reconnect or app restart
        }
    }
}
