import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Logger from '../controllers/Logger.js';

import { DATA_DIR, SANDBOX_DIR } from '../config/index.js';

export interface Plugin {
    id: string;
    name: string;
    description: string;
    isInstalled: boolean;
    version?: string;
    installCommand?: string; // If auto-installable
    checkCommand?: string;
}

export class PluginManager {
    private static instance: PluginManager;
    private pluginsDir: string;
    private availablePlugins: Plugin[] = [
        // Cloud Provider CLIs
        {
            id: 'aws-cli',
            name: 'AWS CLI',
            description: 'Command line interface for Amazon Web Services',
            isInstalled: false,
            installCommand: 'curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg" && sudo installer -pkg AWSCLIV2.pkg -target /',
            checkCommand: 'aws --version'
        },
        {
            id: 'azure-cli',
            name: 'Azure CLI',
            description: 'Command line interface for Microsoft Azure',
            isInstalled: false,
            checkCommand: 'az --version'
        },
        {
            id: 'azcopy',
            name: 'AzCopy',
            description: 'Command-line utility for copying data to/from Azure Storage',
            isInstalled: false,
            checkCommand: 'azcopy --version'
        },
        // Container & Orchestration
        {
            id: 'docker',
            name: 'Docker',
            description: 'Platform for developing, shipping, and running applications in containers',
            isInstalled: false,
            checkCommand: 'docker --version'
        },
        {
            id: 'kubectl',
            name: 'kubectl',
            description: 'Kubernetes command-line tool for cluster management',
            isInstalled: false,
            checkCommand: 'kubectl version --client'
        },
        {
            id: 'helm',
            name: 'Helm',
            description: 'Kubernetes package manager for deploying applications',
            isInstalled: false,
            checkCommand: 'helm version'
        },
        // Infrastructure as Code
        {
            id: 'terraform',
            name: 'Terraform',
            description: 'Infrastructure as Code tool by HashiCorp',
            isInstalled: false,
            checkCommand: 'terraform version'
        },
        // Development Tools
        {
            id: 'git',
            name: 'Git',
            description: 'Distributed version control system',
            isInstalled: false,
            checkCommand: 'git --version'
        },
        {
            id: 'node',
            name: 'Node.js',
            description: 'JavaScript runtime environment',
            isInstalled: false,
            checkCommand: 'node --version'
        },
        {
            id: 'python3',
            name: 'Python 3',
            description: 'Python programming language',
            isInstalled: false,
            checkCommand: 'python3 --version'
        },
        // Utilities
        {
            id: 'jq',
            name: 'jq',
            description: 'Command-line JSON processor',
            isInstalled: false,
            checkCommand: 'jq --version'
        },
        {
            id: 'yq',
            name: 'yq',
            description: 'Command-line YAML processor',
            isInstalled: false,
            checkCommand: 'yq --version'
        },
        {
            id: 'curl',
            name: 'curl',
            description: 'Command-line HTTP client for data transfer',
            isInstalled: false,
            checkCommand: 'curl --version'
        },
        {
            id: 'openssl',
            name: 'OpenSSL',
            description: 'Cryptography and SSL/TLS toolkit',
            isInstalled: false,
            checkCommand: 'openssl version'
        },
        {
            id: 'ssh',
            name: 'SSH',
            description: 'Secure Shell client for remote access',
            isInstalled: false,
            checkCommand: 'ssh -V'
        },
        // AI Assistant
        {
            id: 'claude-code',
            name: 'Claude Code',
            description: 'AI coding assistant by Anthropic',
            isInstalled: false,
            checkCommand: 'claude --version'
        }
    ];

    private constructor() {
        // We will use a dedicated directory for local plugins if possible, 
        // but for system tools (aws, docker) we usually verify system installation.
        // For 'claude-code', we might install locally.
        this.pluginsDir = path.resolve(DATA_DIR, 'plugins');
        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
        }
    }

    public static getInstance(): PluginManager {
        if (!PluginManager.instance) {
            PluginManager.instance = new PluginManager();
        }
        return PluginManager.instance;
    }

    public async performHealthCheck() {
        // Prepare the environment with local paths
        const binPaths = this.getPluginBinPaths();
        const localPath = binPaths.join(path.delimiter) + path.delimiter + (process.env.PATH || '');
        const env = { ...process.env, PATH: localPath };

        for (const plugin of this.availablePlugins) {
            try {
                // Special check for claude-code which lives in sandbox
                let checkCmd = plugin.checkCommand || `${plugin.id} --version`;

                // For claude-code, we check the sandbox node_modules explicitly or rely on HEAD of PATH
                if (plugin.id === 'claude-code') {
                    const binPath = path.resolve(SANDBOX_DIR, 'node_modules', '.bin', 'claude');
                    if (fs.existsSync(binPath)) {
                        checkCmd = `"${binPath}" --version`;
                    }
                }

                // Pass the modified env to checkVersion
                const version = await this.checkVersion(checkCmd, env);
                plugin.isInstalled = true;
                plugin.version = version;
            } catch (e) {
                plugin.isInstalled = false;
                plugin.version = undefined;
            }
        }
    }

    private checkVersion(command: string, env: NodeJS.ProcessEnv): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, { shell: true, env });
            let output = '';

            child.stdout.on('data', d => output += d.toString());
            child.stderr.on('data', d => output += d.toString());

            child.on('close', code => {
                if (code === 0) resolve(output.trim().split('\n')[0]);
                else reject(new Error(`Exit code ${code}`));
            });
            child.on('error', err => reject(err));
        });
    }

    public getPlugins(): Plugin[] {
        return this.availablePlugins;
    }

    public async refreshPlugins(): Promise<Plugin[]> {
        await this.performHealthCheck();
        return this.availablePlugins;
    }

    public getPluginBinPaths(): string[] {
        const paths: string[] = [];

        // 1. Sandbox bin (for claude-code and potentially others)
        paths.push(path.join(SANDBOX_DIR, 'node_modules', '.bin'));

        // 2. Installed plugins
        this.availablePlugins.forEach(p => {
            const pluginDir = path.join(this.pluginsDir, p.id);
            if (fs.existsSync(pluginDir)) {
                // AWS CLI (Linux) uses ./bin
                paths.push(path.join(pluginDir, 'bin'));
                // Python venv installs use ./venv/bin
                paths.push(path.join(pluginDir, 'venv', 'bin'));
                // Root for some others?
                paths.push(pluginDir);
            }
        });

        return paths;
    }

    private detectOS(): 'darwin' | 'linux' | 'win32' | 'unknown' {
        const platform = process.platform;
        if (platform === 'darwin') return 'darwin';
        if (platform === 'linux') return 'linux';
        if (platform === 'win32') return 'win32';
        return 'unknown';
    }

    private detectArch(): 'x86_64' | 'aarch64' {
        const arch = process.arch;
        if (arch === 'arm64') return 'aarch64';
        return 'x86_64';
    }

    private getInstallCommand(id: string): string | null {
        const os = this.detectOS();
        const arch = this.detectArch();

        const commands: Record<string, Record<string, string>> = {
            'aws-cli': {
                'darwin': 'python3 -m venv venv && ./venv/bin/pip install awscli', // V1 via pip (No sudo)
                'linux': 'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && unzip -o awscliv2.zip && ./aws/install -i ./install -b ./bin' // Local install
            },
            'azure-cli': {
                'darwin': 'python3 -m venv venv && ./venv/bin/pip install azure-cli',
                // ensurepip is not in Debian's base python3, so `python3 -m venv`
                // fails with "ensurepip is not available" and leaves a half made
                // venv behind. The server image is Debian bookworm, so the venv
                // package is installed first when it is missing.
                //
                // apt installs outside the data volume and is lost on a container
                // recreate; the VENV is inside it and survives, and a recreated
                // container has the same system python at the same path, so the
                // venv keeps working. Only a re-install would need apt again.
                'linux': 'if ! python3 -c "import ensurepip" 2>/dev/null; then apt-get update -qq && apt-get install -y -qq python3-venv; fi && rm -rf venv && python3 -m venv venv && ./venv/bin/pip install --quiet --upgrade pip && ./venv/bin/pip install azure-cli'
            },
            'azcopy': {
                'darwin': 'curl -L "https://aka.ms/downloadazcopy-v10-mac" -o azcopy.zip && unzip -o azcopy.zip && mkdir -p bin && cp azcopy_darwin_amd64_*/azcopy ./bin/ && chmod +x ./bin/azcopy',
                'linux': 'curl -L "https://aka.ms/downloadazcopy-v10-linux" -o azcopy.tar.gz && tar -xf azcopy.tar.gz && mkdir -p bin && cp azcopy_linux_amd64_*/azcopy ./bin/ && chmod +x ./bin/azcopy'
            },
            'docker': {
                'darwin': `curl -L "https://download.docker.com/mac/static/stable/${arch}/docker-20.10.9.tgz" -o docker.tgz && tar -xf docker.tgz && mkdir -p bin && cp docker/docker ./bin/ && chmod +x ./bin/docker`,
                'linux': `curl -L "https://download.docker.com/linux/static/stable/${arch}/docker-20.10.9.tgz" -o docker.tgz && tar -xf docker.tgz && mkdir -p bin && cp docker/docker ./bin/ && chmod +x ./bin/docker`
            },
            'kubectl': {
                'darwin': arch === 'aarch64'
                    ? 'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/darwin/arm64/kubectl" && chmod +x kubectl && mkdir -p bin && mv kubectl bin/'
                    : 'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/darwin/amd64/kubectl" && chmod +x kubectl && mkdir -p bin && mv kubectl bin/',
                'linux': 'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && chmod +x kubectl && mkdir -p bin && mv kubectl bin/'
            },
            'helm': {
                'darwin': 'curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash && mkdir -p bin && mv /usr/local/bin/helm ./bin/ 2>/dev/null || true',
                'linux': 'curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash && mkdir -p bin && mv /usr/local/bin/helm ./bin/ 2>/dev/null || true'
            },
            'terraform': {
                'darwin': arch === 'aarch64'
                    ? 'curl -LO https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_darwin_arm64.zip && unzip -o terraform_1.6.0_darwin_arm64.zip && mkdir -p bin && mv terraform bin/ && chmod +x bin/terraform'
                    : 'curl -LO https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_darwin_amd64.zip && unzip -o terraform_1.6.0_darwin_amd64.zip && mkdir -p bin && mv terraform bin/ && chmod +x bin/terraform',
                'linux': 'curl -LO https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip && unzip -o terraform_1.6.0_linux_amd64.zip && mkdir -p bin && mv terraform bin/ && chmod +x bin/terraform'
            },
            'jq': {
                'darwin': arch === 'aarch64'
                    ? 'curl -L https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-macos-arm64 -o jq && chmod +x jq && mkdir -p bin && mv jq bin/'
                    : 'curl -L https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-macos-amd64 -o jq && chmod +x jq && mkdir -p bin && mv jq bin/',
                'linux': 'curl -L https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64 -o jq && chmod +x jq && mkdir -p bin && mv jq bin/'
            },
            'yq': {
                'darwin': arch === 'aarch64'
                    ? 'curl -L https://github.com/mikefarah/yq/releases/latest/download/yq_darwin_arm64 -o yq && chmod +x yq && mkdir -p bin && mv yq bin/'
                    : 'curl -L https://github.com/mikefarah/yq/releases/latest/download/yq_darwin_amd64 -o yq && chmod +x yq && mkdir -p bin && mv yq bin/',
                'linux': 'curl -L https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -o yq && chmod +x yq && mkdir -p bin && mv yq bin/'
            },
            'git': {
                'darwin': 'brew install git',
                'linux': 'sudo apt-get update && sudo apt-get install -y git'
            }
        };

        return commands[id]?.[os] || null;
    }

    public async installPlugin(id: string, onProgress: (log: string) => void): Promise<void> {
        const plugin = this.availablePlugins.find(p => p.id === id);
        if (!plugin) throw new Error("Plugin not found");

        // Special handling for Claude Code (Install in AI SANDBOX)
        if (id === 'claude-code') {
            await this.installNpmPackage('@anthropic-ai/claude-code', SANDBOX_DIR, onProgress);
            return;
        }

        const command = this.getInstallCommand(id);
        if (command) {
            // Create plugin-specific directory
            const pluginDir = path.join(this.pluginsDir, id);
            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
            }

            onProgress(`Detected OS: ${this.detectOS()}\n`);
            onProgress(`Installing in: ${pluginDir}\n`);
            onProgress(`Executing: ${command}\n`);

            if (command.includes('sudo')) {
                onProgress(`NOTE: This command requires sudo privileges. If the server user is not in sudoers with NOPASSWD, this will fail.\n`);
            }

            return new Promise((resolve, reject) => {
                const child = spawn(command, {
                    shell: true,
                    cwd: pluginDir // Execute in plugin directory
                });

                child.stdout.on('data', d => onProgress(d.toString()));
                child.stderr.on('data', d => onProgress(d.toString()));

                child.on('close', code => {
                    if (code === 0) {
                        onProgress(`\nSuccessfully installed ${plugin.name}\n`);
                        resolve();
                    } else {
                        reject(new Error(`Installation failed with code ${code}`));
                    }
                });
                child.on('error', err => reject(err));
            });
        }

        throw new Error(`Automated installation for ${plugin.name} is not supported on this OS (${this.detectOS()}).`);
    }

    private installNpmPackage(pkg: string, targetDir: string, onProgress: (log: string) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            // Check for package.json in targetDir
            if (!fs.existsSync(path.join(targetDir, 'package.json'))) {
                // Should be created by ClaudeManager or we create simple one
                fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'ai-sandbox-env', version: '1.0.0', private: true }));
            }

            onProgress(`Installing ${pkg} in ${targetDir}...\n`);

            const child = spawn('npm', ['install', pkg], { cwd: targetDir, shell: true });

            child.stdout.on('data', d => onProgress(d.toString()));
            child.stderr.on('data', d => onProgress(d.toString()));

            child.on('close', code => {
                if (code === 0) {
                    onProgress(`\nSuccessfully installed ${pkg}\n`);
                    resolve();
                } else {
                    reject(new Error(`npm install failed with code ${code}`));
                }
            });
        });
    }
}
