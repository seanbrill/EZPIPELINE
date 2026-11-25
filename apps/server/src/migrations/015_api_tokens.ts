/**
 * Personal API tokens (v2 Phase 7, design sheet f147): a token acts as the
 * person who made it, at one of three levels, and is stored only as a hash.
 */
import { DatabaseService } from "../services/Database.js";

export function migrateApiTokens(): void {
  DatabaseService.getInstance().getDb().exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      token_hash   TEXT NOT NULL UNIQUE,
      last4        TEXT NOT NULL,
      level        TEXT NOT NULL CHECK (level IN ('read', 'run', 'full')),
      created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      expires_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
  `);
}
