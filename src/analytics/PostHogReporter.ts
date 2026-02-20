/**
 * PostHogReporter — Async batch uploader for analytics events.
 *
 * Reads unsynced rows from usage_events (synced_at IS NULL) and POSTs them
 * to PostHog in batches. Runs on a 30-second interval; also flushes when
 * the pending queue reaches 50 events.
 *
 * Never throws — upload failures are logged and retried on the next cycle.
 *
 * Requires env: POSTHOG_API_KEY (skips silently if absent).
 */

import { getDb } from '../queue/db.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('posthog-reporter');

// ─── Config ──────────────────────────────────────────────────────────

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────

interface UsageEventRow {
  id: string;
  api_key_id: string | null;
  tool_name: string;
  store_id: string | null;
  app_id: string | null;
  status: string;
  duration_ms: number | null;
  file_size_bytes: number | null;
  error_message: string | null;
  client_name: string | null;
  client_version: string | null;
  transport_type: string | null;
  ip: string | null;
  country: string | null;
  created_at: string;
}

interface PostHogEvent {
  event: string;
  properties: Record<string, unknown>;
  distinct_id: string;
  timestamp: string;
}

// ─── PostHogReporter ─────────────────────────────────────────────────

export class PostHogReporter {
  private apiKey: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Start the periodic flush loop. */
  start(): void {
    if (this.timer) return;
    log.info('PostHog reporter started (interval=%dms, batch=%d)', FLUSH_INTERVAL_MS, BATCH_SIZE);
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
    // Don't block process exit
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop the periodic flush loop and do a final flush. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /**
   * Read unsynced events from SQLite and POST to PostHog in batches.
   * Marks events as synced after successful upload.
   */
  async flush(): Promise<number> {
    let totalSynced = 0;

    try {
      const db = getDb();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const rows = db
          .prepare(
            `SELECT id, api_key_id, tool_name, store_id, app_id, status,
                    duration_ms, file_size_bytes, error_message,
                    client_name, client_version, transport_type, ip, country, created_at
             FROM usage_events
             WHERE synced_at IS NULL
             ORDER BY created_at ASC
             LIMIT ?`,
          )
          .all(BATCH_SIZE) as UsageEventRow[];

        if (rows.length === 0) break;

        const batch = rows.map((row) => this.toPostHogEvent(row));
        const ok = await this.sendBatch(batch);

        if (!ok) break; // Retry on next cycle

        const now = new Date().toISOString();
        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(
          `UPDATE usage_events SET synced_at = ? WHERE id IN (${placeholders})`,
        ).run(now, ...ids);

        totalSynced += rows.length;

        if (rows.length < BATCH_SIZE) break; // No more rows
      }
    } catch (err) {
      log.warn({ err }, 'posthog-reporter: flush failed');
    }

    if (totalSynced > 0) {
      log.info('posthog-reporter: synced %d events', totalSynced);
    }

    return totalSynced;
  }

  // ─── Private helpers ────────────────────────────────────────────

  private toPostHogEvent(row: UsageEventRow): PostHogEvent {
    const eventName = this.mapEventName(row.tool_name, row.status);

    return {
      event: eventName,
      distinct_id: row.api_key_id ?? 'anonymous',
      timestamp: row.created_at,
      properties: {
        tool_name: row.tool_name,
        store_id: row.store_id,
        app_id: row.app_id,
        status: row.status,
        duration_ms: row.duration_ms,
        file_size_bytes: row.file_size_bytes,
        error_message: row.error_message,
        $set: {
          client_name: row.client_name,
          client_version: row.client_version,
          transport_type: row.transport_type,
        },
        $ip: row.ip,
        $geoip_country_code: row.country,
      },
    };
  }

  private mapEventName(toolName: string, status: string): string {
    if (toolName === 'session_start') return 'mcp_session_start';
    if (toolName === 'session_end') return 'mcp_session_end';
    if (status === 'error') return 'mcp_error';
    if (toolName === 'store.connect') return 'store_connect';
    if (toolName === 'app.publish') return 'app_publish';
    return 'mcp_tool_call';
  }

  private async sendBatch(batch: PostHogEvent[]): Promise<boolean> {
    try {
      const resp = await fetch(`${POSTHOG_HOST}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          batch,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        log.warn('posthog-reporter: batch upload failed (%d %s)', resp.status, resp.statusText);
        return false;
      }

      return true;
    } catch (err) {
      log.warn({ err }, 'posthog-reporter: network error');
      return false;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _reporter: PostHogReporter | null = null;

/**
 * Get or create the PostHogReporter singleton.
 * Returns null if POSTHOG_API_KEY is not configured.
 */
export function getPostHogReporter(): PostHogReporter | null {
  if (_reporter) return _reporter;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    log.debug('POSTHOG_API_KEY not set — PostHog reporting disabled');
    return null;
  }

  _reporter = new PostHogReporter(apiKey);
  return _reporter;
}
