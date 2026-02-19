/**
 * Job queue API routes
 *
 * GET  /          → List jobs, optionally filtered by status
 * GET  /:id       → Get a specific job
 * POST /:id/retry → Re-enqueue a failed job
 */

import { Hono } from 'hono';
import { JobQueue, type JobStatus } from '../../queue/JobQueue.js';

export function createJobsRouter() {
  const app = new Hono();
  const queue = new JobQueue();

  // GET / — List jobs with optional status filter
  app.get('/', (c) => {
    const status = c.req.query('status') as JobStatus | undefined;

    const validStatuses = new Set<string>(['pending', 'running', 'completed', 'failed']);
    const filter = status && validStatuses.has(status) ? status : undefined;

    const jobs = queue.listJobs(filter);
    return c.json({ jobs });
  });

  // GET /:id — Get a specific job
  app.get('/:id', (c) => {
    const jobId = c.req.param('id');
    const job = queue.getJob(jobId);

    if (!job) {
      return c.json({ error: `Job not found: ${jobId}` }, 404);
    }

    return c.json({ job });
  });

  // POST /:id/retry — Re-enqueue a failed job
  app.post('/:id/retry', (c) => {
    const jobId = c.req.param('id');
    const job = queue.getJob(jobId);

    if (!job) {
      return c.json({ error: `Job not found: ${jobId}` }, 404);
    }

    if (job.status !== 'failed') {
      return c.json({ error: `Job ${jobId} is not in failed state (current: ${job.status})` }, 400);
    }

    const newJobId = queue.enqueue(job.type, job.payload, job.maxRetries);
    return c.json({
      success: true,
      original_job_id: jobId,
      new_job_id: newJobId,
      message: 'Job re-enqueued',
    });
  });

  return app;
}
