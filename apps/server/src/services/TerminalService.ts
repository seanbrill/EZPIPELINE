import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import Logger from "../controllers/Logger.js";
import os from "os";

interface TerminalSession {
    id: string;
    userId: number;
    process: ChildProcess;
    cwd: string;
    createdAt: Date;
}

export class TerminalService {
    private static instance: TerminalService;
    private sessions: Map<string, TerminalSession> = new Map();
    private logger = Logger.getInstance();

    private constructor() {
        // Cleanup on exit
        process.on('exit', () => this.cleanup());
        process.on('SIGINT', () => { this.cleanup(); process.exit(); });
        process.on('SIGTERM', () => { this.cleanup(); process.exit(); });
    }

    public static getInstance(): TerminalService {
        if (!TerminalService.instance) {
            TerminalService.instance = new TerminalService();
        }
        return TerminalService.instance;
    }

    public createSession(userId: number, emitFn: (event: string, data: any) => void): string {
        const sessionId = randomUUID();
        const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';
        const cwd = process.cwd();

        this.logger.info(`[TerminalService] Creating session ${sessionId} for user ${userId}`);

        const child = spawn(shell, [], {
            cwd,
            env: { ...process.env, TERM: 'xterm-256color', PS1: '\\u@\\h:\\w\\$ ' },
            shell: false
        });

        // Handle output
        child.stdout?.on('data', (data) => {
            emitFn('terminal-output', { sessionId, data: data.toString() });
        });

        child.stderr?.on('data', (data) => {
            emitFn('terminal-output', { sessionId, data: data.toString() });
        });

        child.on('exit', (code) => {
            this.logger.info(`[TerminalService] Session ${sessionId} exited with code ${code}`);
            emitFn('terminal-exit', { sessionId, code });
            this.sessions.delete(sessionId);
        });

        child.on('error', (err) => {
            this.logger.error(`[TerminalService] Session ${sessionId} error: ${err.message}`);
            emitFn('terminal-error', { sessionId, error: err.message });
        });

        this.sessions.set(sessionId, {
            id: sessionId,
            userId,
            process: child,
            cwd,
            createdAt: new Date()
        });

        return sessionId;
    }

    public sendInput(sessionId: string, input: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.warn(`[TerminalService] Session ${sessionId} not found`);
            return false;
        }

        session.process.stdin?.write(input);
        return true;
    }

    public killSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        session.process.kill();
        this.sessions.delete(sessionId);
        this.logger.info(`[TerminalService] Session ${sessionId} killed`);
        return true;
    }

    public getSession(sessionId: string): TerminalSession | undefined {
        return this.sessions.get(sessionId);
    }

    public getUserSessions(userId: number): TerminalSession[] {
        return Array.from(this.sessions.values()).filter(s => s.userId === userId);
    }

    private cleanup() {
        this.logger.info("[TerminalService] Cleaning up all sessions");
        for (const session of this.sessions.values()) {
            session.process.kill();
        }
        this.sessions.clear();
    }
}
