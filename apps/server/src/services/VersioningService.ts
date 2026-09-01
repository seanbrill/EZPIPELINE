import * as fs from "fs";
import path from "path";
import { execSync } from "child_process";
import Logger from "../controllers/Logger.js";

export class VersioningService {
    private static instance: VersioningService;
    private logger = Logger.getInstance();

    constructor() { }

    public static getInstance(): VersioningService {
        if (!VersioningService.instance) {
            VersioningService.instance = new VersioningService();
        }
        return VersioningService.instance;
    }

    public archiveBuild(pipelineDir: string, appName: string, version: string, sourcePath: string) {
        const versionsDir = path.join(pipelineDir, "versions");
        const appVersionDir = versionsDir; // or path.join(versionsDir, appName) if we want structure, but per-pipeline dir is already isolated.
        // Actually, if we are in data/pipelines/MyPipeline, then 'versions' folder is enough. 
        // We don't need another 'appName' subfolder unless we support multiple apps per pipeline (unlikely).
        // The user wants "per pipeline versions tab".

        if (!fs.existsSync(appVersionDir)) {
            fs.mkdirSync(appVersionDir, { recursive: true });
        }

        // Check Limits
        this.checkLimits(appVersionDir);

        // Check for Dockerfile in source
        const dockerfilePath = path.join(sourcePath, "Dockerfile");
        if (fs.existsSync(dockerfilePath)) {
            this.handleDockerVersioning(appName, version, sourcePath);
        } else {
            this.handleZipVersioning(appName, version, sourcePath, appVersionDir);
        }
    }

    private checkLimits(versionsDir: string) {
        try {
            const MAX_COUNT = 10;
            const MAX_SIZE_MB = 1024; // 1GB

            const files = fs.readdirSync(versionsDir)
                .map(f => path.join(versionsDir, f))
                .filter(f => fs.statSync(f).isFile() && f.endsWith('.zip'));

            if (files.length === 0) return;

            // Get stats
            const fileStats = files.map(f => ({
                path: f,
                stats: fs.statSync(f)
            })).sort((a, b) => a.stats.mtime.getTime() - b.stats.mtime.getTime()); // Oldest first

            // Check Count
            while (fileStats.length >= MAX_COUNT) {
                const toDelete = fileStats.shift();
                if (toDelete) {
                    this.logger.info(`🗑️ Cleanup: Deleting old version ${path.basename(toDelete.path)} (Limit reached)`);
                    fs.unlinkSync(toDelete.path);
                }
            }

            // Check Size
            let totalSize = fileStats.reduce((sum, f) => sum + f.stats.size, 0);
            const maxSizeBytes = MAX_SIZE_MB * 1024 * 1024;

            while (totalSize > maxSizeBytes && fileStats.length > 0) {
                const toDelete = fileStats.shift();
                if (toDelete) {
                    this.logger.info(`🗑️ Cleanup: Deleting old version ${path.basename(toDelete.path)} (Size limit reached)`);
                    fs.unlinkSync(toDelete.path);
                    totalSize -= toDelete.stats.size;
                }
            }

        } catch (error) {
            this.logger.error("Failed to check version limits", error);
        }
    }

    private handleDockerVersioning(appName: string, version: string, cwd: string) {
        try {
            const tagName = `${appName.toLowerCase()}:${version}`;
            this.logger.info(`🐳 Dockerfile found. Building and tagging image: ${tagName}`);

            // Simple build command - in a real CI this might push to a registry
            execSync(`docker build -t ${tagName} .`, { cwd, stdio: "inherit" });

            this.logger.info(`✅ Docker image ${tagName} created successfully.`);
        } catch (error) {
            this.logger.error(`❌ Docker build failed for ${appName} v${version}`, error);
            throw error;
        }
    }

    private handleZipVersioning(appName: string, version: string, sourcePath: string, outputDir: string) {
        try {
            const zipName = `${version}.zip`;
            const outputPath = path.join(outputDir, zipName);

            this.logger.info(`📦 No Dockerfile. keying zip archive: ${outputPath}`);

            // Using tar/zip command via exec to avoid adding another dependency like archiver for now
            // Exclude node_modules to keep it clean
            execSync(`zip -r "${outputPath}" . -x "node_modules/*" ".git/*"`, {
                cwd: sourcePath,
                stdio: "inherit"
            });

            this.logger.info(`✅ Zip archive created at ${outputPath}`);
        } catch (error) {
            this.logger.error(`❌ Zip archiving failed for ${appName} v${version}`, error);
            // Fallback or non-critical error? Let's throw for visibility
            throw error;
        }
    }
}
