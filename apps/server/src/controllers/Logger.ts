import winston from "winston";
import path from "path";
import { Response } from "express";

import { LOGS_DIR } from "../config/index.js";

const logDir = LOGS_DIR;

// LOG_LEVEL filters the console and app.log only: build output still streams
// to the people watching the run whatever it is set to.
const LEVELS = ["error", "warn", "info", "debug"];
const wanted = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
const level = LEVELS.includes(wanted) ? wanted : "info";

const winstonLogger = winston.createLogger({
  level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logDir, "app.log") }),
  ],
});

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

// Helper for Redaction
class Redactor {
  private secrets: Set<string> = new Set();

  public add(secret: string) {
    if (!secret || secret.length < 3) return; // Ignore short secrets to avoid noise
    this.secrets.add(secret);
  }

  public redact(message: string): string {
    if (!message) return message;
    let redacted = message;
    for (const secret of this.secrets) {
      // Simple replaceAll equivalent (global replace)
      // Escaping implementation for regex might be safer but slow for many secrets.
      // Using split/join for simple replacement
      if (redacted.includes(secret)) {
        redacted = redacted.split(secret).join('[REDACTED]');
      }
    }
    return redacted;
  }
}

/** What a stream client is shown. `build` is null for the server's own log. */
export interface StreamScope {
  build: { buildId: string; pipelineId: string } | null;
}
type StreamFilter = (scope: StreamScope) => boolean;

/** One line a step printed, as the stream and the database carry it. */
export interface BuildLine {
  buildId: string;
  pipelineId: string;
  stepIndex: number | null;
  /** The substep path the line belongs to ("11.2.1"), or null for the step itself. */
  substep?: string | null;
  stream: "stdout" | "stderr" | "system";
  level: "info" | "warn" | "error";
  text: string;
}

export default class Logger {
  private static instance: Logger;
  private clients: { res: Response; filter: StreamFilter }[] = [];
  private redactor = new Redactor();

  private constructor() { }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public registerSecret(secret: string) {
    this.redactor.add(secret);
  }

  public registerSecrets(secrets: string[]) {
    secrets.forEach(s => this.redactor.add(s));
  }

  public redact(message: string): string {
    return this.redactor.redact(message);
  }

  public info(message: string) {
    const safeMsg = this.redactor.redact(message);
    winstonLogger.info(safeMsg);
    this.broadcastLog("info", safeMsg, null);
  }

  public warn(message: string) {
    const safeMsg = this.redactor.redact(message);
    winstonLogger.warn(safeMsg);
    this.broadcastLog("warn", safeMsg, null);
  }

  public error(message: string, error?: any) {
    const msg = `${message} ${error ? "- " + error.toString() : ""}`;
    const safeMsg = this.redactor.redact(msg);
    winstonLogger.error(safeMsg);
    this.broadcastLog("error", safeMsg, null);
  }

  /**
   * A line from a build. Goes to the server log and ONLY to stream clients
   * allowed to see that pipeline. It used to go through info(), which sent
   * every build's output to every signed-in user, whatever they could view.
   * `text` must already be redacted.
   */
  public buildLine(line: BuildLine) {
    winstonLogger.log(line.level, line.text);
    this.broadcastLog(line.level, line.text, line);
  }

  private broadcastLog(level: string, message: string, line: BuildLine | null) {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    // `message` keeps the v1 shape ("[ts] [LEVEL]: text") for the old
    // dashboard; v2 reads `text` and the build fields.
    const entry = {
      type: 'log',
      timestamp,
      level,
      message: `[${timestamp}] [${level.toUpperCase()}]: ${message}`,
      text: message,
      ...(line ? { buildId: line.buildId, pipelineId: line.pipelineId, stepIndex: line.stepIndex, substep: line.substep ?? null, stream: line.stream } : {}),
    };
    const data = `data: ${JSON.stringify(entry)}\n\n`;
    const scope: StreamScope = { build: line ? { buildId: line.buildId, pipelineId: line.pipelineId } : null };
    for (const c of this.clients) {
      if (c.filter(scope)) c.res.write(data);
    }
  }

  /** `filter` decides, per line, whether this client sees it. */
  public addClient(res: Response, filter: StreamFilter) {
    const client = { res, filter };
    this.clients.push(client);
    res.on("close", () => {
      this.clients = this.clients.filter(c => c !== client);
    });
  }
}
