import winston from "winston";
import path from "path";
import { Response } from "express";

import { LOGS_DIR } from "../config/index.js";

const logDir = LOGS_DIR;

// Create Winston Logger
const winstonLogger = winston.createLogger({
  level: "info",
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

export default class Logger {
  private static instance: Logger;
  private clients: Response[] = [];
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
    this.broadcastLog("info", safeMsg);
  }

  public warn(message: string) {
    const safeMsg = this.redactor.redact(message);
    winstonLogger.warn(safeMsg);
    this.broadcastLog("warn", safeMsg);
  }

  public error(message: string, error?: any) {
    const msg = `${message} ${error ? "- " + error.toString() : ""}`;
    const safeMsg = this.redactor.redact(msg);
    winstonLogger.error(safeMsg);
    this.broadcastLog("error", safeMsg);
  }

  private broadcastLog(level: string, message: string) {
    // Message is already redacted by caller
    // Format matches what winston outputs for consistency in UI if we parse it
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const formattedDate = timestamp;

    // Send object for React to parse
    const entry = {
      timestamp: formattedDate,
      level,
      message: `[${formattedDate}] [${level.toUpperCase()}]: ${message}`
    };

    const data = `data: ${JSON.stringify(entry)}\n\n`;
    this.clients.forEach(client => client.write(data));
  }

  public addClient(res: Response) {
    this.clients.push(res);
    res.on("close", () => {
      this.clients = this.clients.filter(client => client !== res);
    });
  }
}
