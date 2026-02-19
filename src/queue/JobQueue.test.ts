import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDb } from './db.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'shipkit-test-'));
  process.env.SHIPKIT_DB_PATH = join(tmpDir, 'test.db');
  vi.useFakeTimers();
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SHIPKIT_DB_PATH;
});

// Dynamic import so each test gets a fresh module with the temp DB
async function freshQueue() {
  const mod = await import('./JobQueue.js');
  return new mod.JobQueue();
}

describe('JobQueue', () => {
  describe('enqueue', () => {
    it('should create a job with PENDING status', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', { app: 'test' });
      const job = queue.getJob(jobId);

      expect(job).toBeDefined();
      expect(job!.status).toBe('pending');
      expect(job!.type).toBe('deploy');
      expect(job!.payload).toEqual({ app: 'test' });
      expect(job!.retries).toBe(0);
      expect(job!.maxRetries).toBe(3);
    });

    it('should generate unique job IDs', async () => {
      const queue = await freshQueue();
      const id1 = queue.enqueue('deploy', {});
      const id2 = queue.enqueue('deploy', {});
      expect(id1).not.toBe(id2);
    });

    it('should accept custom maxRetries', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', {}, 5);
      const job = queue.getJob(jobId);
      expect(job!.maxRetries).toBe(5);
    });
  });

  describe('process - success path', () => {
    it('should transition PENDING -> RUNNING -> COMPLETED', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', { app: 'test' });
      const handler = vi.fn().mockResolvedValue('done');

      const processPromise = queue.process(jobId, handler);
      await vi.runAllTimersAsync();
      await processPromise;

      const job = queue.getJob(jobId);
      expect(job!.status).toBe('completed');
      expect(job!.result).toBe('done');
      expect(handler).toHaveBeenCalledWith({ app: 'test' });
    });
  });

  describe('process - failure with retry', () => {
    it('should retry failed jobs with exponential backoff', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', { app: 'test' }, 2);
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockResolvedValue('success');

      const processPromise = queue.process(jobId, handler);
      await vi.runAllTimersAsync();
      await processPromise;

      const job = queue.getJob(jobId);
      expect(job!.status).toBe('completed');
      expect(job!.result).toBe('success');
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should set status to FAILED after exceeding maxRetries', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', { app: 'test' }, 1);
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-final'));

      const processPromise = queue.process(jobId, handler);
      await vi.runAllTimersAsync();
      await processPromise;

      const job = queue.getJob(jobId);
      expect(job!.status).toBe('failed');
      expect(job!.error).toBe('fail-final');
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should set status to FAILED with maxRetries=0 on first failure', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', { app: 'test' }, 0);
      const handler = vi.fn().mockRejectedValue(new Error('immediate-fail'));

      const processPromise = queue.process(jobId, handler);
      await vi.runAllTimersAsync();
      await processPromise;

      const job = queue.getJob(jobId);
      expect(job!.status).toBe('failed');
      expect(job!.error).toBe('immediate-fail');
    });

    it('should handle non-Error thrown values', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', {}, 0);
      const handler = vi.fn().mockRejectedValue('string-error');

      const processPromise = queue.process(jobId, handler);
      await vi.runAllTimersAsync();
      await processPromise;

      const job = queue.getJob(jobId);
      expect(job!.status).toBe('failed');
      expect(job!.error).toBe('string-error');
    });
  });

  describe('process - error conditions', () => {
    it('should throw when job does not exist', async () => {
      const queue = await freshQueue();
      await expect(queue.process('nonexistent', vi.fn())).rejects.toThrow(
        'Job not found: nonexistent',
      );
    });

    it('should throw when job is not in pending status', async () => {
      const queue = await freshQueue();
      const jobId = queue.enqueue('deploy', {});
      const handler = vi.fn().mockResolvedValue('done');

      const processPromise = queue.process(jobId, handler);
      await vi.runAllTimersAsync();
      await processPromise;

      // Job is now completed, trying to process again should throw
      await expect(queue.process(jobId, handler)).rejects.toThrow(
        `Job ${jobId} is not pending`,
      );
    });
  });

  describe('listJobs', () => {
    it('should list all jobs when no filter', async () => {
      const queue = await freshQueue();
      queue.enqueue('deploy', {});
      queue.enqueue('upload', {});
      expect(queue.listJobs()).toHaveLength(2);
    });

    it('should filter jobs by status', async () => {
      const queue = await freshQueue();
      queue.enqueue('deploy', {});
      queue.enqueue('upload', {});
      expect(queue.listJobs('pending')).toHaveLength(2);
      expect(queue.listJobs('completed')).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('should persist jobs across JobQueue instances', async () => {
      const queue1 = await freshQueue();
      const jobId = queue1.enqueue('deploy', { app: 'persist-test' });

      // Create a new instance - same DB
      const queue2 = await freshQueue();
      const job = queue2.getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.type).toBe('deploy');
      expect(job!.payload).toEqual({ app: 'persist-test' });
    });

    it('should mark running jobs as failed on restart', async () => {
      const queue1 = await freshQueue();
      const jobId = queue1.enqueue('deploy', { slow: true });

      // Manually set status to running to simulate a crash mid-process
      const { getDb } = await import('./db.js');
      getDb().prepare(`UPDATE jobs SET status = 'running' WHERE id = ?`).run(jobId);

      // New queue instance should recover stale running jobs
      const queue2 = await freshQueue();
      const job = queue2.getJob(jobId);
      expect(job!.status).toBe('failed');
      expect(job!.error).toBe('Process restarted unexpectedly');
    });
  });

  describe('globalQueue singleton', () => {
    it('should exist as a JobQueue instance', async () => {
      const { JobQueue, globalQueue } = await import('./JobQueue.js');
      expect(globalQueue).toBeInstanceOf(JobQueue);
    });

    it('should be usable for enqueuing jobs', async () => {
      const { globalQueue } = await import('./JobQueue.js');
      const jobId = globalQueue.enqueue('global-test', { data: 1 });
      const job = globalQueue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.type).toBe('global-test');
    });
  });
});
