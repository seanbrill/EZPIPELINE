import * as fs from "fs";
import path from "path";
import Logger from "./Logger.js";
import { parse } from 'yaml';
import { VersioningService } from "../services/VersioningService.js";
import { v4 as uuidv4 } from 'uuid';

import { PIPELINES_DIR } from "../config/index.js";

export class ConfigController {
    private static instance: ConfigController;
    private logger = Logger.getInstance();
    private rootDir = PIPELINES_DIR;

    private constructor() {
        if (!fs.existsSync(this.rootDir)) {
            fs.mkdirSync(this.rootDir, { recursive: true });
        }
    }

    public static getInstance(): ConfigController {
        if (!ConfigController.instance) {
            ConfigController.instance = new ConfigController();
        }
        return ConfigController.instance;
    }

    public getFiles() {
        // Recursive function to build file tree
        const getFileTree = (dir: string, baseDir: string): any[] => {
            if (!fs.existsSync(dir)) return [];
            const items = fs.readdirSync(dir, { withFileTypes: true });

            return items
                .filter(item => item.name !== 'yaml' && item.name !== 'env')
                .map(item => {
                    const fullPath = path.join(dir, item.name);
                    const relativePath = path.relative(baseDir, fullPath);

                    if (item.isDirectory()) {
                        // Check if this directory is a Pipeline Bundle
                        const hasPipelineMarker = fs.existsSync(path.join(fullPath, '.pipeline'));
                        const hasConfigYaml = fs.existsSync(path.join(fullPath, 'config.ezpipeline.yaml'));
                        const hasPipelineYaml = fs.existsSync(path.join(fullPath, 'pipeline.yaml'));

                        if (hasPipelineMarker || hasConfigYaml || hasPipelineYaml) {
                            let displayName = item.name;
                            let environment: string | undefined;
                            let pipelineId: string | undefined;
                            // Two known names first, then ANY yaml in a
                            // .pipeline-marked directory.
                            //
                            // A bundle qualifies on the .pipeline marker alone,
                            // but the id was only ever parsed out of these two
                            // filenames, so a bundle whose file is named
                            // anything else (the shipped Demo uses
                            // demo-pipeline.yaml) got id: undefined. The
                            // permission filter in routes/index.ts then drops
                            // every node without an id, so it was created,
                            // listed by /api/targets, and invisible in the file
                            // tree.
                            let configFile: string | null = hasPipelineYaml
                                ? 'pipeline.yaml'
                                : (hasConfigYaml ? 'config.ezpipeline.yaml' : null);
                            if (!configFile && hasPipelineMarker) {
                                configFile =
                                    fs.readdirSync(fullPath)
                                        .find((f) => /\.ya?ml$/i.test(f) && !f.startsWith('.')) ?? null;
                            }

                            if (configFile) {
                                try {
                                    const configContent = fs.readFileSync(path.join(fullPath, configFile), 'utf-8');
                                    const config = parse(configContent);
                                    if (config) {
                                        if (config.appName) displayName = config.appName;
                                        if (config.environment) environment = config.environment;
                                        if (config.id) pipelineId = config.id;
                                    }
                                } catch (e: any) {
                                    this.logger.error(`Failed to parse config for ${fullPath}: ${e.message}`);
                                    // Fallback to directory name if parsing fails
                                }
                            }

                            return {
                                id: pipelineId,
                                name: displayName,
                                originalName: item.name, // Keep original folder name for reference if needed
                                type: "pipeline",
                                path: relativePath,
                                filePath: path.join(relativePath, configFile || ''),
                                environment // Pass environment to frontend
                                // Treated as a leaf node
                            };
                        }

                        return {
                            name: item.name,
                            type: "directory",
                            path: relativePath,
                            children: getFileTree(fullPath, baseDir)
                        };
                    } else {
                        return {
                            name: item.name,
                            type: "file",
                            path: relativePath
                        };
                    }
                });
        };

        return {
            yaml: getFileTree(this.rootDir, this.rootDir),
            env: [] // Deprecated but kept for type compatibility if needed
        };
    }

    public getFileContent(type: "yaml" | "env", filePath: string): string {
        // Ignore type, use rootDir
        const fullPath = path.resolve(this.rootDir, filePath);
        // `startsWith(rootDir)` alone is true for a SIBLING directory: a root
        // of /data/pipelines also admitted /data/pipelines-secrets. Comparing
        // against rootDir + separator is what actually confines it.
        const root = path.resolve(this.rootDir);
        if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
            throw new Error("Invalid file path");
        }

        if (!fs.existsSync(fullPath)) {
            throw new Error("File not found");
        }

        return fs.readFileSync(fullPath, "utf-8");
    }

    public saveFileContent(type: "yaml" | "env", filePath: string, content: string) {
        const fullPath = path.resolve(this.rootDir, filePath);

        // `startsWith(rootDir)` alone is true for a SIBLING directory: a root
        // of /data/pipelines also admitted /data/pipelines-secrets. Comparing
        // against rootDir + separator is what actually confines it.
        const root = path.resolve(this.rootDir);
        if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
            throw new Error("Invalid file path");
        }

        // Create directory if it doesn't exist (handle uploads to new folders)
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Versioning: Backup existing file before overwrite
        if (fs.existsSync(fullPath)) {
            this.createBackup(fullPath);
        }

        fs.writeFileSync(fullPath, content, "utf-8");
        this.logger.info(`💾 Configuration saved: ${fullPath}`);
    }

    private createBackup(filePath: string) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            // Store versions in the same directory as the file, under a 'versions' folder
            const versionDir = path.join(path.dirname(filePath), "versions");
            const fileName = path.basename(filePath);
            const backupName = `${fileName}.${timestamp}.bak`;

            if (!fs.existsSync(versionDir)) {
                fs.mkdirSync(versionDir, { recursive: true });
            }

            fs.copyFileSync(filePath, path.join(versionDir, backupName));
            this.logger.info(`📦 Config backup created: ${path.join(versionDir, backupName)}`);
        } catch (error) {
            this.logger.error("Failed to create config backup", error);
        }
    }

    public createFolder(type: "yaml" | "env", folderPath: string) {
        const fullPath = path.resolve(this.rootDir, folderPath);

        // Separator-aware, like getFileContent and saveFileContent.
        //
        // `startsWith(rootDir)` alone is true for a SIBLING directory: a root
        // of /data/pipelines also admitted /data/pipelines-secrets. The other
        // three call sites were corrected earlier and this one was missed,
        // which matters more now that the name validation upstream allows a
        // dot and therefore no longer refuses "..' by character class alone.
        const root = path.resolve(this.rootDir);
        if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
            throw new Error("Invalid folder path");
        }

        if (fs.existsSync(fullPath)) {
            throw new Error("Folder already exists");
        }

        fs.mkdirSync(fullPath, { recursive: true });
        this.logger.info(`📂 Folder created: ${fullPath}`);
    }

    public moveFile(type: "yaml" | "env", currentPath: string, newPath: string) {
        const fullCurrentPath = path.resolve(this.rootDir, currentPath);
        const fullNewPath = path.resolve(this.rootDir, newPath);

        if (!fullCurrentPath.startsWith(this.rootDir) || !fullNewPath.startsWith(this.rootDir)) {
            throw new Error("Invalid path");
        }

        if (!fs.existsSync(fullCurrentPath)) {
            throw new Error(`Source file not found: ${fullCurrentPath}`);
        }

        const newDir = path.dirname(fullNewPath);
        if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
        }

        fs.renameSync(fullCurrentPath, fullNewPath);
        this.logger.info(`🚚 File moved: ${currentPath} -> ${newPath}`);
    }
    public deleteFolder(type: "yaml" | "env", folderPath: string) {
        const fullPath = path.resolve(this.rootDir, folderPath);

        if (!fullPath.startsWith(this.rootDir)) {
            throw new Error("Invalid folder path");
        }

        if (!fs.existsSync(fullPath)) {
            throw new Error("Folder not found");
        }

        // Safety: Don't delete root
        if (fullPath === this.rootDir) {
            throw new Error("Cannot delete root directory");
        }

        fs.rmSync(fullPath, { recursive: true, force: true });
        this.logger.info(`🗑️ Folder deleted: ${fullPath}`);
    }

    public deleteFile(type: "yaml" | "env", filePath: string) {
        const fullPath = path.resolve(this.rootDir, filePath);

        // `startsWith(rootDir)` alone is true for a SIBLING directory: a root
        // of /data/pipelines also admitted /data/pipelines-secrets. Comparing
        // against rootDir + separator is what actually confines it.
        const root = path.resolve(this.rootDir);
        if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
            throw new Error("Invalid file path");
        }

        if (!fs.existsSync(fullPath)) {
            throw new Error("File not found");
        }

        if (fs.lstatSync(fullPath).isDirectory()) {
            throw new Error("Path is a directory, use deleteFolder instead");
        }

        fs.unlinkSync(fullPath);
        this.logger.info(`🗑️ File deleted: ${fullPath}`);
    }

    public createPipelineBundle(group: string, name: string, author: string): void {
        const id = uuidv4();
        // Sanitize group path to prevent traversal, but allow multiple levels
        // Remove .. and leading/trailing slashes
        const safeGroup = group ? group.replace(/\.\./g, '').replace(/^\/+|\/+$/g, '') : '';

        // Bundle Directory: data/pipelines/<Group>/<Name>
        const bundleDir = path.join(this.rootDir, safeGroup, name);

        if (fs.existsSync(bundleDir)) {
            throw new Error(`Pipeline '${name}' already exists in group '${group}'`);
        }

        // Create Structure
        fs.mkdirSync(bundleDir, { recursive: true });
        fs.mkdirSync(path.join(bundleDir, 'resources'), { recursive: true });

        // Marker
        fs.writeFileSync(path.join(bundleDir, '.pipeline'), '', 'utf-8');

        // Config
        const yamlContent = `
id: ${id}
appName: ${name}
version: 1.0.0
description: Created via UI
author: ${author}

steps:
  - name: Start
    run: echo "Pipeline started"
`.trim();
        fs.writeFileSync(path.join(bundleDir, 'pipeline.yaml'), yamlContent, 'utf-8');

        // Env
        const envContent = `# Environment variables for ${name}\nAPP_ENV=production`;
        fs.writeFileSync(path.join(bundleDir, '.env'), envContent, 'utf-8');

        this.logger.info(`✨ Created pipeline bundle: ${bundleDir}`);
    }

    public copyPipelineBundle(sourceId: string, targetGroup: string, newName: string, author: string): void {
        // 1. Find Source Pipeline Path
        // We need to search for the directory containing the pipeline.yaml with the matching ID
        // Or finding the path from the ID using a helper (EZPipelineController might know, or we traverse).
        // Since ConfigController is file-system based and doesn't keep a memory map (EZPipelineController does), 
        // we might rely on the frontend passing the 'sourcePath' is safer/faster if available.
        // BUT, the request might only have ID.
        // Let's assume frontend passes 'sourcePath' or we integrate with EZPipelineController logic.
        // However, this class shouldn't depend on EZPipelineController (circular dependency?).
        // Actually, routes/index.ts can fetch the pipeline object from EZPipelineController to get the path!

        // Wait, for this method signature, I'll take 'sourcePath'.
        // The API handler will resolve ID -> Path.
        // So change signature to take sourcePath.
        throw new Error("Use copyPipelineBundleFromPath instead");
    }

    public copyPipelineBundleFromPath(sourcePath: string, targetGroup: string, newName: string, author: string): void {
        const fullSourcePath = path.resolve(this.rootDir, sourcePath);
        if (!fs.existsSync(fullSourcePath)) {
            throw new Error(`Source pipeline not found: ${sourcePath}`);
        }

        const safeGroup = targetGroup ? targetGroup.replace(/\.\./g, '').replace(/^\/+|\/+$/g, '') : '';
        const targetDir = path.join(this.rootDir, safeGroup, newName);

        if (fs.existsSync(targetDir)) {
            throw new Error(`Pipeline '${newName}' already exists in group '${targetGroup}'`);
        }

        // Recursive Copy Helper
        const copyRecursive = (src: string, dest: string) => {
            if (fs.lstatSync(src).isDirectory()) {
                fs.mkdirSync(dest, { recursive: true });
                fs.readdirSync(src).forEach(child => {
                    copyRecursive(path.join(src, child), path.join(dest, child));
                });
            } else {
                // Special handling for YAML to regenerate ID and AppName
                const filename = path.basename(src);
                if (filename === 'pipeline.yaml' || filename === 'config.ezpipeline.yaml') {
                    let content = fs.readFileSync(src, 'utf-8');
                    const newId = uuidv4();

                    // Simple Regex replacement for robustness vs parsing logic to preserve formatting
                    // Replace id: ... with new id
                    // Replace appName: ... with new name

                    // ID
                    if (content.match(/^id:\s*.*$/m)) {
                        content = content.replace(/^id:\s*.*$/m, `id: ${newId}`);
                    } else {
                        content = `id: ${newId}\n` + content;
                    }

                    // AppName
                    if (content.match(/^appName:\s*.*$/m)) {
                        content = content.replace(/^appName:\s*.*$/m, `appName: ${newName}`);
                    } else {
                        // Add appName if missing?
                        content = `appName: ${newName}\n` + content;
                    }

                    fs.writeFileSync(dest, content, 'utf-8');
                } else {
                    fs.copyFileSync(src, dest);
                }
            }
        };

        try {
            copyRecursive(fullSourcePath, targetDir);
            this.logger.info(`📋 Copied pipeline: ${sourcePath} -> ${targetDir}`);
        } catch (e: any) {
            // Cleanup on failure?
            this.logger.error(`Failed to copy pipeline`, e);
            throw new Error(`Copy failed: ${e.message}`);
        }
    }

    public listFiles(type: "yaml" | "env", subDir: string) {
        const fullPath = path.resolve(this.rootDir, subDir);

        if (!fullPath.startsWith(this.rootDir)) {
            throw new Error("Invalid path");
        }

        if (!fs.existsSync(fullPath)) {
            return [];
        }

        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        return items.map(item => ({
            name: item.name,
            type: item.isDirectory() ? "directory" : "file",
            path: path.relative(this.rootDir, path.join(fullPath, item.name)),
            size: item.isFile() ? fs.statSync(path.join(fullPath, item.name)).size : 0,
            updatedAt: fs.statSync(path.join(fullPath, item.name)).mtime
        }));
    }
    public getEnvKeys(filePath: string): string[] {
        const fullPath = path.resolve(this.rootDir, filePath);
        // `startsWith(rootDir)` alone is true for a SIBLING directory: a root
        // of /data/pipelines also admitted /data/pipelines-secrets. Comparing
        // against rootDir + separator is what actually confines it.
        const root = path.resolve(this.rootDir);
        if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
            throw new Error("Invalid file path");
        }

        if (!fs.existsSync(fullPath)) {
            throw new Error("File not found");
        }

        const content = fs.readFileSync(fullPath, "utf-8");
        const keys: string[] = [];

        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            // Match KEY=... or export KEY=...
            if (!trimmed || trimmed.startsWith('#')) return;

            const match = trimmed.match(/^(?:export\s+)?([a-zA-Z_][a-zA-Z0-9_]*)=/);
            if (match) {
                keys.push(match[1]);
            }
        });

        return keys;
    }

    // Global Environment Variables Management
    private getGlobalEnvPath(): string {
        return path.join(path.dirname(this.rootDir), '.env.global');
    }

    public getGlobalEnvKeys(): string[] {
        const globalEnvPath = this.getGlobalEnvPath();

        if (!fs.existsSync(globalEnvPath)) {
            return [];
        }

        const content = fs.readFileSync(globalEnvPath, "utf-8");
        const keys: string[] = [];

        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;

            const match = trimmed.match(/^(?:export\s+)?([a-zA-Z_][a-zA-Z0-9_]*)=/);
            if (match) {
                keys.push(match[1]);
            }
        });

        return keys;
    }

    public getGlobalEnvKeysWithValues(): Array<{ key: string; value: string }> {
        const globalEnvPath = this.getGlobalEnvPath();

        if (!fs.existsSync(globalEnvPath)) {
            return [];
        }

        const content = fs.readFileSync(globalEnvPath, "utf-8");
        const vars: Array<{ key: string; value: string }> = [];

        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;

            const match = trimmed.match(/^(?:export\s+)?([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
            if (match) {
                vars.push({ key: match[1], value: match[2] });
            }
        });

        return vars;
    }

    public setGlobalEnvVariable(key: string, value: string): void {
        const globalEnvPath = this.getGlobalEnvPath();
        let content = '';

        if (fs.existsSync(globalEnvPath)) {
            content = fs.readFileSync(globalEnvPath, "utf-8");
        }

        const lines = content.split('\n');
        let found = false;

        const newLines = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith(`${key}=`) || trimmed.startsWith(`export ${key}=`)) {
                found = true;
                return `${key}=${value}`;
            }
            return line;
        });

        if (!found) {
            newLines.push(`${key}=${value}`);
        }

        fs.writeFileSync(globalEnvPath, newLines.join('\n'), "utf-8");
        process.env[key] = value;
        this.logger.info(`🌍 Global env variable set: ${key}`);
    }

    public deleteGlobalEnvVariable(key: string): void {
        const globalEnvPath = this.getGlobalEnvPath();

        if (!fs.existsSync(globalEnvPath)) {
            return;
        }

        const content = fs.readFileSync(globalEnvPath, "utf-8");
        const lines = content.split('\n');

        const newLines = lines.filter(line => {
            const trimmed = line.trim();
            return !trimmed.startsWith(`${key}=`) && !trimmed.startsWith(`export ${key}=`);
        });

        fs.writeFileSync(globalEnvPath, newLines.join('\n'), "utf-8");
        delete process.env[key];
        this.logger.info(`🗑️ Global env variable deleted: ${key}`);
    }

    public loadGlobalEnv(): void {
        const globalEnvPath = this.getGlobalEnvPath();
        if (!fs.existsSync(globalEnvPath)) return;

        const content = fs.readFileSync(globalEnvPath, "utf-8");
        const lines = content.split('\n');

        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                if (parts.length >= 2) {
                    let key = parts[0].trim();
                    if (key.startsWith('export ')) {
                        key = key.substring(7).trim();
                    }
                    // Handle quoted values? minimal support for now.
                    // Join back incase value had =
                    const value = parts.slice(1).join('=').trim();
                    process.env[key] = value;
                }
            }
        });
        this.logger.info(`🌍 Loaded global environment variables from ${globalEnvPath}`);
    }

    public getGlobalEnvContent(): string {
        const globalEnvPath = this.getGlobalEnvPath();

        if (!fs.existsSync(globalEnvPath)) {
            return '';
        }

        return fs.readFileSync(globalEnvPath, "utf-8");
    }

    // Global Resources Management
    private getGlobalResourcesDir(): string {
        const dir = path.join(path.dirname(this.rootDir), 'global/resources');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    public getGlobalResources(): any[] {
        const dir = this.getGlobalResourcesDir();
        const items = fs.readdirSync(dir, { withFileTypes: true });
        return items
            .filter(item => item.isFile())
            .map(item => ({
                name: item.name,
                path: `global/resources/${item.name}`,
                size: fs.statSync(path.join(dir, item.name)).size,
                updatedAt: fs.statSync(path.join(dir, item.name)).mtime
            }));
    }

    public deleteGlobalResource(fileName: string): void {
        const dir = this.getGlobalResourcesDir();
        const fullPath = path.join(dir, fileName);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            this.logger.info(`🗑️ Global resource deleted: ${fileName}`);
        } else {
            throw new Error("Resource not found");
        }
    }

    public saveGlobalResource(tempPath: string, originalName: string): string {
        const dir = this.getGlobalResourcesDir();
        const targetPath = path.join(dir, originalName);

        // Rename (move)
        fs.renameSync(tempPath, targetPath);
        this.logger.info(`💾 Global resource saved: ${targetPath}`);
        return targetPath;
    }
}
