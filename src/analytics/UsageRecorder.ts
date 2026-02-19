/**
 * UsageRecorder — Fire-and-forget analytics event sink.
 *
 * Inserts rows into usage_events without ever throwing so that analytics
 * failures can never interrupt the main tool execution path.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../queue/db.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('usage-recorder');

// ─── Types ───────────────────────────────────────────────────────────

export interface UsageEvent {
  apiKeyId?: string;
  toolName: string;
  storeId?: string;
  appId?: string;
  status: string;
  durationMs: number;
  fileSizeBytes?: number;
  errorMessage?: string;
}

// ─── UsageRecorder ───────────────────────────────────────────────────

export class UsageRecorder {
  /**
   * Persist a usage event. Never throws — analytics must not break the main flow.
   */
  recordEvent(event: UsageEvent): void {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();
      const db = getDb();

      db.prepare(
        `INSERT INTO usage_events
           (id, api_key_id, tool_name, store_id, app_id, status, duration_ms, file_size_bytes, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        event.apiKeyId ?? null,
        event.toolName,
        event.storeId ?? null,
        event.appId ?? null,
        event.status,
        event.durationMs,
        event.fileSizeBytes ?? null,
        event.errorMessage ?? null,
        now,
      );
    } catch (err) {
      // Log but swallow — analytics must never crash the caller
      log.warn({ err }, 'usage-recorder: failed to persist event');
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _recorder: UsageRecorder | null = null;

export function getUsageRecorder(): UsageRecorder {
  if (!_recorder) _recorder = new UsageRecorder();
  return _recorder;
}
