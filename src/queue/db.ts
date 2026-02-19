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
