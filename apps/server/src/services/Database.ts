import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcrypt";
import Logger from "../controllers/Logger.js";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, "../../data/app.db");

export class DatabaseService {
  private static instance: DatabaseService;
  private db: Database.Database;

  private constructor() {
    console.log("Using Database Path: ", dbPath);
    this.db = new Database(dbPath);
    this.initialize();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private initialize() {
    // Create Users Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        mfa_enabled INTEGER DEFAULT 0,
        mfa_secret TEXT,
        mfa_code TEXT,
        mfa_expires DATETIME,
        is_admin INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Settings Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Migration for existing databases to add is_admin
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
    } catch (e) { }

    // Migration for email/mfa
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    } catch (e) { }
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN mfa_enabled INTEGER DEFAULT 0");
    } catch (e) { }
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN mfa_secret TEXT");
    } catch (e) { }
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN mfa_code TEXT");
    } catch (e) { }
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN mfa_expires DATETIME");
    } catch (e) { }

    // Create Builds Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS builds (
        id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        active_step TEXT,
        percentage INTEGER,
        error TEXT,
        version TEXT,
        started_at DATETIME,
        ended_at DATETIME,
        build_number INTEGER DEFAULT 0,
        step_timings TEXT
      )
    `);

    // Migration for build_number
    try {
      this.db.exec("ALTER TABLE builds ADD COLUMN build_number INTEGER DEFAULT 0");
    } catch (e) {
      // Column likely exists
    }

    // Migration for step_timings
    try {
      this.db.exec("ALTER TABLE builds ADD COLUMN step_timings TEXT");
    } catch (e) { }


    // Create Build Logs Table (basic)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS build_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        build_id TEXT NOT NULL,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(build_id) REFERENCES builds(id) ON DELETE CASCADE
      )
    `);

    // Create Agent Tokens Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scopes TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME
      )
    `);

  }

  public hasUsers(): boolean {
    const stmt = this.db.prepare("SELECT count(*) as count FROM users");
    const result = stmt.get() as { count: number };
    return result.count > 0;
  }

  public getDb(): Database.Database {
    return this.db;
  }
}
