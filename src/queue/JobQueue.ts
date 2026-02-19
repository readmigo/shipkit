/**
 * JobQueue - Simple in-memory job queue with retry and exponential backoff
 *
 * Job state machine: PENDING -> RUNNING -> COMPLETED | FAILED
 */

import { randomUUID } from 'node:crypto';

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

// ─── JobQueue ────────────────────────────────────────────────────────

export class JobQueue {
  private jobs = new Map<string, Job>();

  /**
   * Enqueue a new job. Returns the generated jobId.
   */
  enqueue<T>(type: string, payload: T, maxRetries = 3): string {
    const id = `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    const job: Job<T> = {
      id,
      type,
      payload,
      status: 'pending',
      retries: 0,
      maxRetries,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job as Job);
    return id;
  }

  /**
   * Get a job by ID.
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs, optionally filtered by status.
   */
  listJobs(status?: JobStatus): Job[] {
    const all = Array.from(this.jobs.values());
    return status ? all.filter(j => j.status === status) : all;
  }

  /**
   * Process a job with the given handler.
   * Implements exponential backoff retry: 1s, 2s, 4s...
   */
  async process(jobId: string, handler: (payload: unknown) => Promise<unknown>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status !== 'pending') throw new Error(`Job ${jobId} is not pending (status: ${job.status})`);

    job.status = 'running';
    job.updatedAt = new Date();

    while (job.retries <= job.maxRetries) {
      try {
        job.result = await handler(job.payload);
        job.status = 'completed';
        job.updatedAt = new Date();
        return;
      } catch (err) {
        job.retries++;
        job.updatedAt = new Date();

        if (job.retries > job.maxRetries) {
          job.status = 'failed';
          job.error = err instanceof Error ? err.message : String(err);
          return;
        }

        // Exponential backoff: 1s, 2s, 4s...
        const delay = 1000 * Math.pow(2, job.retries - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

export const globalQueue = new JobQueue();
