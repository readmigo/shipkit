/**
 * SQLite database for job persistence.
 *
 * DB path: SHIPKIT_DB_PATH env or ~/.shipkit/jobs.db
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

let _db: Database.Database | null = null;

function dbPath(): string {
  return process.env.SHIPKIT_DB_PATH ?? join(homedir(), '.shipkit', 'jobs.db');
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const p = dbPath();
  mkdirSync(dirname(p), { recursive: true });

  _db = new Database(p);
  _db.pragma('journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      payload     TEXT NOT NULL DEFAULT '{}',
      result      TEXT,
      error       TEXT,
      retries     INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poll_tasks (
      id          TEXT PRIMARY KEY,
      app_id      TEXT NOT NULL,
      store_id    TEXT NOT NULL,
      interval_ms INTEGER NOT NULL,
      last_poll   TEXT,
      active      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id                    TEXT PRIMARY KEY,
      key_hash              TEXT UNIQUE NOT NULL,
      plan                  TEXT NOT NULL DEFAULT 'free',
      user_id               TEXT,
      email                 TEXT,
      monthly_publish_count INTEGER DEFAULT 0,
      monthly_call_count    INTEGER DEFAULT 0,
      quota_resets_at       TEXT NOT NULL,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at          TEXT,
      is_active             INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id               TEXT PRIMARY KEY,
      api_key_id       TEXT,
      tool_name        TEXT NOT NULL,
      store_id         TEXT,
      app_id           TEXT,
      status           TEXT NOT NULL DEFAULT 'success',
      duration_ms      INTEGER,
      file_size_bytes  INTEGER,
      error_message    TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_daily_agg (
      date             TEXT NOT NULL,
      tool_name        TEXT NOT NULL,
      store_id         TEXT NOT NULL DEFAULT '',
      total_calls      INTEGER DEFAULT 0,
      success_calls    INTEGER DEFAULT 0,
      failed_calls     INTEGER DEFAULT 0,
      avg_duration_ms  INTEGER DEFAULT 0,
      total_file_bytes INTEGER DEFAULT 0,
      unique_api_keys  INTEGER DEFAULT 0,
      PRIMARY KEY (date, tool_name, store_id)
    );
  `);

  return _db;
}

/** Close the database (for testing/cleanup). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
