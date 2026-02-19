/**
 * JobQueue - Persistent job queue backed by SQLite with retry and exponential backoff
 *
 * Job state machine: PENDING -> RUNNING -> COMPLETED | FAILED
 * Jobs survive process restarts; running jobs are marked failed on init.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

// ─── Types ───────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  result?: unknown;
  error?: string;
  retries: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  payload: string;
  result: string | null;
  error: string | null;
  retries: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    status: row.status as JobStatus,
    payload: JSON.parse(row.payload),
    result: row.result != null ? JSON.parse(row.result) : undefined,
    error: row.error ?? undefined,
    retries: row.retries,
    maxRetries: row.max_retries,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ─── JobQueue ────────────────────────────────────────────────────────

export class JobQueue {
  constructor() {
    // Mark any jobs left in 'running' state as failed (stale from prior crash)
    const db = getDb();
    db.prepare(
      `UPDATE jobs SET status = 'failed', error = 'Process restarted unexpectedly', updated_at = ? WHERE status = 'running'`,
    ).run(new Date().toISOString());
  }

  /**
   * Enqueue a new job. Returns the generated jobId.
   */
  enqueue<T>(type: string, payload: T, maxRetries = 3): string {
    const id = `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO jobs (id, type, status, payload, retries, max_retries, created_at, updated_at) VALUES (?, ?, 'pending', ?, 0, ?, ?, ?)`,
    ).run(id, type, JSON.stringify(payload), maxRetries, now, now);
    return id;
  }

  /**
   * Get a job by ID.
   */
  getJob(jobId: string): Job | undefined {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  /**
   * List all jobs, optionally filtered by status.
   */
  listJobs(status?: JobStatus): Job[] {
    const db = getDb();
    const rows = status
      ? (db.prepare(`SELECT * FROM jobs WHERE status = ?`).all(status) as JobRow[])
      : (db.prepare(`SELECT * FROM jobs`).all() as JobRow[]);
    return rows.map(rowToJob);
  }

  /**
   * Process a job with the given handler.
   * Implements exponential backoff retry: 1s, 2s, 4s...
   */
  async process(jobId: string, handler: (payload: unknown) => Promise<unknown>): Promise<void> {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status !== 'pending') throw new Error(`Job ${jobId} is not pending (status: ${job.status})`);

    const db = getDb();
    db.prepare(`UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      jobId,
    );

    let retries = 0;
    const maxRetries = job.maxRetries;

    while (retries <= maxRetries) {
      try {
        const result = await handler(job.payload);
        db.prepare(`UPDATE jobs SET status = 'completed', result = ?, updated_at = ? WHERE id = ?`).run(
          JSON.stringify(result),
          new Date().toISOString(),
          jobId,
        );
        return;
      } catch (err) {
        retries++;
        const now = new Date().toISOString();

        if (retries > maxRetries) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          db.prepare(`UPDATE jobs SET status = 'failed', error = ?, retries = ?, updated_at = ? WHERE id = ?`).run(
            errorMsg,
            retries,
            now,
            jobId,
          );
          return;
        }

        db.prepare(`UPDATE jobs SET retries = ?, updated_at = ? WHERE id = ?`).run(retries, now, jobId);

        // Exponential backoff: 1s, 2s, 4s...
        const delay = 1000 * Math.pow(2, retries - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

export const globalQueue = new JobQueue();
