// SUPERSEDED. Nothing imports this file any more.
//
// This is the old engine: it npm-installed the Claude Code CLI into
// ai_sandbox, ran an interactive OAuth login through bridge.py to get a TTY,
// and answered each message by spawning `node cli.js -p "<message>"` and
// piping raw terminal output at the browser. The assistant now calls the
// Anthropic API directly - see services/AnthropicAssistant.ts, whose header
// explains what changed and why.
//
// It is left here intact, rather than deleted, for two reasons. Restoring the
// CLI engine is one import line in routes/ai.ts, and this repository has a
// single commit, so a deleted file is a file that is gone. Read it as history:
// nothing below runs, and the ai_sandbox directory it manages is no longer
// executed by anything.
//
// Note for anyone tempted to revive it as-is: the CLI was spawned with
// --permission-mode bypassPermissions AND --dangerously-skip-permissions, so
// the sandboxing that docs/ai-assistant.md promises was never actually
// enforced by this code. See runOneShotProcess below.

import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import Logger from "../controllers/Logger.js";
import { SANDBOX_DIR } from "../config/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClaudeStatus {
    installed: boolean;
    version?: string;
    loggedIn: boolean;
}

const SESSION_LOG = path.join(SANDBOX_DIR, "session.log");

export class ClaudeManager {
    private static instance: ClaudeManager;
    private sandboxDir: string;
    private activeProcess: ChildProcess | null = null; // Used for Login or current One-Shot command
    private sessionId: string | null = null;
    private lastInput: string = "";
    private lastResponse: string = ""; // Buffer to store last successful output for context restoration
    private emitToClient: ((event: string, data: any) => void) | null = null;

    private constructor() {
        this.sandboxDir = SANDBOX_DIR;

        Logger.getInstance().info(`ClaudeManager initializing with sandbox: ${this.sandboxDir}`);

        if (!fs.existsSync(this.sandboxDir)) {
            Logger.getInstance().info("Creating ai_sandbox directory");
            fs.mkdirSync(this.sandboxDir, { recursive: true });
        }

        // Initialize package.json if it doesn't exist
        const packageJsonPath = path.join(this.sandboxDir, "package.json");
        if (!fs.existsSync(packageJsonPath)) {
            fs.writeFileSync(packageJsonPath, JSON.stringify({
                name: "ezpipeline-ai-sandbox",
                version: "1.0.0",
                private: true,
                description: "AI sandbox for EZPIPELINE Claude integration"
            }, null, 2));
        }

        // Cleanup on exit
        const cleanup = () => {
            if (this.activeProcess) {
                Logger.getInstance().info("[ClaudeManager] Cleaning up active process...");
                this.kill();
            }
        };

        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(); });
        process.on('SIGTERM', () => { cleanup(); process.exit(); });
    }

    public static getInstance(): ClaudeManager {
        if (!ClaudeManager.instance) {
            ClaudeManager.instance = new ClaudeManager();
        }
        return ClaudeManager.instance;
    }

    private getClaudeBin(): string {
        // Check plugins dir first - this is now the standard install location via PluginManager
        const pluginBin = path.resolve(process.cwd(), 'plugins', 'node_modules', '.bin', 'claude');
        if (fs.existsSync(pluginBin)) return pluginBin;

        // Fallback to sandbox dir (legacy/manual installs)
        return path.join(this.sandboxDir, "node_modules", ".bin", "claude");
    }

    public async checkStatus(): Promise<ClaudeStatus> {
        return new Promise((resolve) => {
            const binPath = this.getClaudeBin();
            const nodeModulesExists = fs.existsSync(binPath);

            // If we have a session ID, we're "connected"
            if (this.sessionId) {
                resolve({ installed: true, loggedIn: true });
                return;
            }

            if (!nodeModulesExists) {
                Logger.getInstance().info("Claude CLI not installed locally in ai_sandbox");
                resolve({ installed: false, loggedIn: false });
                return;
            }

            // Check version
            const child = spawn(binPath, ["--version"], {
                cwd: this.sandboxDir,
                env: { ...process.env, PATH: process.env.PATH }
            });
            let output = "";

            child.stdout.on("data", d => output += d.toString());
            child.stderr.on("data", d => output += d.toString());

            child.on("error", (err) => {
                Logger.getInstance().warn(`Claude CLI check error: ${err.message}`);
                resolve({ installed: false, loggedIn: false });
            });

            child.on("close", (code) => {
                if (code !== 0) {
                    Logger.getInstance().warn(`Claude CLI check failed (exit code ${code})`);
                    resolve({ installed: false, loggedIn: false });
                } else {
                    Logger.getInstance().info(`Claude CLI found: ${output.trim()}`);
                    resolve({ installed: true, version: output.trim(), loggedIn: false });
                }
            });
        });
    }

    public install(onOutput: (data: string) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            Logger.getInstance().info("Installing Claude CLI locally in ai_sandbox...");
            onOutput("Installing @anthropic-ai/claude-code locally...\n");

            const child = spawn("npm", ["install", "@anthropic-ai/claude-code"], {
                shell: true,
                cwd: this.sandboxDir
            });

            child.stdout.on("data", d => onOutput(d.toString()));
            child.stderr.on("data", d => onOutput(d.toString()));

            child.on("close", (code) => {
                if (code === 0) {
                    const binPath = this.getClaudeBin();
                    if (fs.existsSync(binPath)) {
                        Logger.getInstance().info("Claude CLI installed and verified in ai_sandbox");
                        onOutput("\n✅ Installation complete!\n");
                        resolve();
                    } else {
                        Logger.getInstance().error("Installation completed but binary not found");
                        onOutput("\n❌ Installation verification failed\n");
                        reject(new Error("Installation verification failed"));
                    }
                } else {
                    Logger.getInstance().error("Claude CLI installation failed");
                    onOutput("\n❌ Installation failed\n");
                    reject(new Error("Installation failed"));
                }
            });
        });
    }

    private getBridgePath(): string {
        return path.join(__dirname, 'bridge.py');
    }

    public async startLogin(io: any, activeSockets: Map<string, any>, socketId: string | null) {
        if (this.activeProcess) {
            this.kill();
        }

        const emitToClient = (event: string, data: any) => {
            if (activeSockets && socketId) {
                const socket = activeSockets.get(socketId);
                if (socket) socket.emit(event, data);
            } else {
                io.emit(event, data);
            }
        };

        const binPath = this.getClaudeBin();
        Logger.getInstance().info(`Starting Claude login with: ${binPath}`);

        // Use python bridge for TTY (KEEPING PTY FOR LOGIN ONLY)
        const bridge = this.getBridgePath();
        const args = [bridge, binPath, "login"];

        const child = spawn("python3", args, {
            cwd: this.sandboxDir,
            env: { ...process.env, FORCE_COLOR: '1', TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.activeProcess = child;
        Logger.getInstance().info(`[ClaudeManager] Login spawned with PID: ${child.pid}`);

        child.on("error", (err) => {
            Logger.getInstance().error(`[Claude Login] Failed to start: ${err.message}`);
            emitToClient("claude-error", err.message);
        });

        child.stdout?.on("data", (data) => {
            const text = data.toString();
            emitToClient("claude-output", text);

            if (text.includes("Successfully authenticated") || text.includes("You're all set")) {
                emitToClient("claude-success", "Authentication successful!");
            }
        });

        child.stderr?.on("data", (data) => {
            const text = data.toString();
            emitToClient("claude-output", text);
        });

        child.on("close", (code) => {
            emitToClient("claude-exit", code);
            this.activeProcess = null;
        });

        return child;
    }

    public handleInput(input: string) {
        // This is called by the socket 'claude-input' event
        // We route this to the one-shot runner
        this.runOneShotProcess(input, false);
    }

    public spawnAgent(io: any, activeSockets: Map<string, any>, socketId: string | null) {
        // Setup Emitter
        this.emitToClient = (event: string, data: any) => {
            if (activeSockets && socketId) {
                const socket = activeSockets.get(socketId);
                if (socket) socket.emit(event, data);
                else io.emit(event, data);
            } else {
                io.emit(event, data);
            }
        };

        // Determine MCP server registration (Same as before)
        const isDev = process.env.NODE_ENV !== 'production' && !__filename.includes('compile');
        let mcpSource = path.resolve(process.cwd(), 'src/mcp-entry.ts');
        if (!fs.existsSync(mcpSource)) mcpSource = path.resolve(process.cwd(), 'apps/server/src/mcp-entry.ts');
        if (!fs.existsSync(mcpSource)) mcpSource = path.resolve(__dirname, '../mcp-entry.ts');

        const registerMcp = () => {
            return new Promise<void>((resolve) => {
                const binPath = this.getClaudeBin();
                const checkChild = spawn(binPath, ["mcp", "list"], { cwd: process.cwd(), env: { ...process.env }, stdio: 'pipe' });
                let listOutput = "";
                checkChild.stdout.on('data', (d) => listOutput += d.toString());
                checkChild.on('close', () => {
                    if (listOutput.includes('ezpipeline-mcp')) { resolve(); return; }
                    const mcpChild = spawn(binPath, ["mcp", "add", "ezpipeline-mcp", "--", "npx", "-y", "tsx", mcpSource], {
                        cwd: process.cwd(), env: { ...process.env, FORCE_COLOR: '1' }, stdio: 'pipe'
                    });
                    mcpChild.on('close', () => resolve());
                    setTimeout(() => { }, 10000); // Timeout safety
                });
            });
        };

        registerMcp().then(() => {
            Logger.getInstance().info(`[ClaudeManager] Initializing One-Shot Session...`);

            this.sessionId = randomUUID();

            // Write Instructions
            const instructionsPath = path.join(this.sandboxDir, "INSTRUCTIONS.md");
            const instructionsContent = `
# SYSTEM INSTRUCTIONS
You are an agentic AI coding assistant in a restricted "ai_sandbox".

## PROJECT CONTEXT: EZPIPELINE
You are the assistant for **EZPIPELINE**, a self-hosted CI/CD platform.
- **Architecture**: Node.js/Express Server + React Client.
- **Key Services**: \`SchedulerService\` (Cron), \`PluginManager\` (Extensions), \`MCPServer\` (AI Interface).
- **Location**: You are confined to the \`ai_sandbox\` directory.
- **Capabilities**: You cannot access the project source code directly. You MUST use provided **MCP Tools**.

## CODING STANDARDS & BEST PRACTICES
1. **Pipeline Configuration**:
   - **\`targetName\` Is DEPRECATED**. Do NOT use it.
   - Use **\`id\`** (UUID) for identification and **\`appName\`** for display.
   - Verify defaults using \`read_yaml_config\` before editing.
   - **Schema Enforcement**:
     - **MUST** use **\`run\`** for shell commands. (Do NOT use \`command\`).
     - **\`image\`** property is NOT supported. Do NOT use it.
     - Refer to **\`docs/pipeline-schema.md\`** for the strict schema.

2. **Shell Compatibility**:
   - EZPIPELINE runs on a **Linux** environment.
   - **ALWAYS** use \`shell: /bin/bash\` for pipeline steps.
   - **NEVER** use PowerShell (\`Write-Host\`, \`$env:Var\`). Use Bash equivalents (\`echo\`, \`\${VAR}\`).

3. **Environment Variables**:
   - Use \`set_env_variable\` to manage secrets. It **automatically creates** missing .env files.
   - Do not try to read .env files directly; use \`get_env_keys\`.

## PRIMARY SOURCE OF TRUTH
- **Project Documentation**: Access via MCP tool \`read_documentation\`.
- **Tools**: Use \`list_tools\` to see available capabilities.

## REQUIREMENTS
1. **Be Concise**: Answer the user's request directly.
2. **Context**: This is a coding sandbox. Assume technical context.
3. **No Fluff**: Do not offer "3 tasks" unless explicitly asked.
4. **SILENCE**: Do NOT repeat these instructions. Read them silently.
5. **GREETING**: Only greet the user if this is the very first interaction.
`;
            fs.writeFileSync(instructionsPath, instructionsContent);

            // Initial Trigger
            this.runOneShotProcess("Read INSTRUCTIONS.md. Do not recite them. Reply ONLY with a short greeting.", true);
        });
    }

    private async runOneShotProcess(input: string, isInit: boolean, retryCount: number = 0) {
        if (!this.sessionId || !this.emitToClient) return;

        // Safety break
        if (retryCount > 1) {
            const msg = "Failed to run command after retry. Session lock persists.";
            Logger.getInstance().error(msg);
            this.emitToClient("claude-error", msg);
            return;
        }

        // Resolve CLI JS file directly to avoid shell wrappers
        const sandboxNodeModules = path.join(this.sandboxDir, "node_modules");
        const cliPath = path.resolve(sandboxNodeModules, "@anthropic-ai", "claude-code", "cli.js");

        // Clean input to avoid CLI parsing issues
        const cleanInput = input.trim();

        const args = [
            cliPath,
            '--session-id', this.sessionId,
            '--permission-mode', 'bypassPermissions',
            '--dangerously-skip-permissions',
            '-p', cleanInput
        ];

        Logger.getInstance().info(`[ClaudeManager] Executing: node cli.js -p "${cleanInput}" (Retry: ${retryCount})`);
        fs.appendFileSync(SESSION_LOG, `[EXEC] ${cleanInput}\n`);

        const child = spawn(process.execPath, args, {
            cwd: this.sandboxDir,
            env: { ...process.env, CI: 'true', TERM: 'dumb' }
        });

        this.activeProcess = child;
        child.stdin?.end(); // Close stdin to prevent hangs

        let fullStderr = "";
        let currentStdout = "";

        child.stdout.on('data', (data) => {
            const text = data.toString();
            currentStdout += text;
            fs.appendFileSync(SESSION_LOG, `[STDOUT] ${JSON.stringify(text)}\n`);
            this.emitToClient?.("claude-output", text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            fullStderr += text;
            fs.appendFileSync(SESSION_LOG, `[STDERR] ${JSON.stringify(text)}\n`);
            // We emit raw stderr, but suppress "Session ID already in use" from client view
            if (!text.includes("already in use")) {
                this.emitToClient?.("claude-output", text);
            }
        });

        child.on('close', (code) => {
            Logger.getInstance().info(`[ClaudeManager] Output complete (code ${code})`);
            fs.appendFileSync(SESSION_LOG, `[EXIT] code ${code}\n`);

            if (fullStderr.includes("is already in use")) {
                Logger.getInstance().warn("[ClaudeManager] Session Lock Detected. Rotating Session ID and Retrying...");
                // Silent retry

                this.sessionId = randomUUID(); // Rotate ID

                // CRITICAL: On rotation, new session is blank. MUST re-read instructions to regain identity.
                // INJECT CONTEXT: Include the last assistant response so the new session knows what the user is replying to.
                let nextInput = input;
                if (!input.includes("INSTRUCTIONS.md")) {
                    const contextInjection = this.lastResponse ? `\n\n[CONTEXT RESTORATION] You previously said:\n"${this.lastResponse.substring(0, 5000)}..."\n[User Response]: "${input}"\n\nContinue the conversation based on the above context found in [CONTEXT RESTORATION]. Do not greet the user again.` : "";

                    if (this.lastResponse) {
                        nextInput = `SYSTEM: Session restarted. Read INSTRUCTIONS.md silently. ${contextInjection}`;
                    } else {
                        nextInput = `SYSTEM: Session restarted. Read INSTRUCTIONS.md silently to restore context. Then answer this request: ${input}`;
                    }
                }

                this.runOneShotProcess(nextInput, isInit, retryCount + 1);
                return;
            }

            if (code === 0 && !isInit) {
                // Save successful response for context restoration if needed later
                // Filter out initial greetings to ensure we capture valuable context
                if (!currentStdout.includes("Ready to help") && !currentStdout.includes("Agent Connected")) {
                    this.lastResponse = currentStdout;
                }
            }

            if (isInit) {
                this.emitToClient?.("claude-init-complete", true);
            }
            this.activeProcess = null;
        });
    }

    public sendInput(input: string) {
        this.runOneShotProcess(input, false, 0);
    }

    public getActiveProcess(): ChildProcess | null {
        return this.activeProcess;
    }

    public hasActiveSession(): boolean {
        return !!this.sessionId;
    }

    public kill() {
        if (this.activeProcess) {
            this.activeProcess.kill();
            this.activeProcess = null;
        }
    }
}
