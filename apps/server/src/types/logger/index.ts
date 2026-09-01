// types.ts

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
}
