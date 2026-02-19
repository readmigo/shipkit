/**
 * PollingScheduler - Periodically polls store adapter status and fires
 * callbacks when review/publish status changes.
 *
 * Persists active polls to SQLite so they survive process restarts.
 */

import { getDb } from '../queue/db.js';
import type { StoreAdapter, StatusResult } from '../adapters/base/StoreAdapter.js';

// Store-specific default polling intervals (ms)
const DEFAULT_INTERVALS: Record<string, number> = {
  app_store: 30 * 60 * 1000,   // 30 min — Apple reviews are slow
  google_play: 5 * 60 * 1000,  // 5 min
  huawei_agc: 10 * 60 * 1000,  // 10 min
};
const FALLBACK_INTERVAL = 15 * 60 * 1000; // 15 min

export type StatusChangeCallback = (
  taskId: string,
  appId: string,
  storeId: string,
  oldStatus: StatusResult,
  newStatus: StatusResult,
) => void;

interface ActivePoll {
  taskId: string;
  appId: string;
  storeId: string;
  adapter: StoreAdapter;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
  lastStatus: StatusResult | null;
  onStatusChange: StatusChangeCallback;
}

export class PollingScheduler {
  private polls = new Map<string, ActivePoll>();

  /** Start polling for a specific app/store combination. */
  startPolling(params: {
    taskId: string;
    appId: string;
    storeId: string;
    adapter: StoreAdapter;
    onStatusChange: StatusChangeCallback;
    intervalMs?: number;
  }): void {
    const { taskId, appId, storeId, adapter, onStatusChange } = params;

    // Stop existing poll for this task if any
    if (this.polls.has(taskId)) {
      this.stopPolling(taskId);
    }

    const intervalMs =
      params.intervalMs ?? DEFAULT_INTERVALS[storeId] ?? FALLBACK_INTERVAL;

    // Persist to db
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO poll_tasks (id, app_id, store_id, interval_ms, active)
       VALUES (?, ?, ?, ?, 1)`,
    ).run(taskId, appId, storeId, intervalMs);

    const timer = setInterval(() => {
      void this.poll(taskId);
    }, intervalMs);

    // Prevent the timer from keeping the process alive
    if (timer.unref) timer.unref();

    this.polls.set(taskId, {
      taskId,
      appId,
      storeId,
      adapter,
      intervalMs,
      timer,
      lastStatus: null,
      onStatusChange,
    });

    // Run an immediate first poll
    void this.poll(taskId);
  }

  /** Stop polling for a specific task. */
  stopPolling(taskId: string): void {
    const poll = this.polls.get(taskId);
    if (!poll) return;

    clearInterval(poll.timer);
    this.polls.delete(taskId);

    // Mark inactive in db
    try {
      const db = getDb();
      db.prepare('UPDATE poll_tasks SET active = 0 WHERE id = ?').run(taskId);
    } catch {
      // db may be closed during shutdown
    }
  }

  /** Stop all active polls. */
  stopAll(): void {
    for (const taskId of Array.from(this.polls.keys())) {
      this.stopPolling(taskId);
    }
  }

  /** Restore active polls from db (call after process restart). */
  restorePolls(
    resolveAdapter: (storeId: string) => StoreAdapter | null,
    onStatusChange: StatusChangeCallback,
  ): number {
    const db = getDb();
    const rows = db
      .prepare('SELECT id, app_id, store_id, interval_ms FROM poll_tasks WHERE active = 1')
      .all() as Array<{ id: string; app_id: string; store_id: string; interval_ms: number }>;

    let restored = 0;
    for (const row of rows) {
      const adapter = resolveAdapter(row.store_id);
      if (!adapter) continue;

      this.startPolling({
        taskId: row.id,
        appId: row.app_id,
        storeId: row.store_id,
        adapter,
        onStatusChange,
        intervalMs: row.interval_ms,
      });
      restored++;
    }
    return restored;
  }

  /** Get IDs of currently active polls. */
  getActivePolls(): string[] {
    return Array.from(this.polls.keys());
  }

  /** Execute a single poll cycle for a task. */
  private async poll(taskId: string): Promise<void> {
    const poll = this.polls.get(taskId);
    if (!poll) return;

    try {
      const newStatus = await poll.adapter.getStatus(poll.appId);
      const oldStatus = poll.lastStatus;

      if (oldStatus && hasStatusChanged(oldStatus, newStatus)) {
        poll.onStatusChange(taskId, poll.appId, poll.storeId, oldStatus, newStatus);
      }

      poll.lastStatus = newStatus;

      // Update last_poll timestamp in db
      try {
        const db = getDb();
        db.prepare('UPDATE poll_tasks SET last_poll = ? WHERE id = ?').run(
          new Date().toISOString(),
          taskId,
        );
      } catch {
        // non-critical
      }
    } catch {
      // Failed poll — do not crash; will retry on next interval
    }
  }
}

function hasStatusChanged(a: StatusResult, b: StatusResult): boolean {
  return a.reviewStatus !== b.reviewStatus || a.liveStatus !== b.liveStatus;
}

/** Singleton instance for app-wide use. */
export const pollingScheduler = new PollingScheduler();
