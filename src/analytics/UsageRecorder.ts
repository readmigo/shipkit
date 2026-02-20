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

export interface ClientInfo {
  clientName?: string;
  clientVersion?: string;
  transportType?: string;
  ip?: string;
  country?: string;
}

export interface UsageEvent {
  apiKeyId?: string;
  toolName: string;
  storeId?: string;
  appId?: string;
  status: string;
  durationMs: number;
  fileSizeBytes?: number;
  errorMessage?: string;
  clientInfo?: ClientInfo;
}

export interface SessionEvent {
  type: 'session_start' | 'session_end';
  clientInfo: ClientInfo;
  sessionDurationMs?: number;
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
      const ci = event.clientInfo;

      db.prepare(
        `INSERT INTO usage_events
           (id, api_key_id, tool_name, store_id, app_id, status, duration_ms, file_size_bytes, error_message,
            client_name, client_version, transport_type, ip, country, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ci?.clientName ?? null,
        ci?.clientVersion ?? null,
        ci?.transportType ?? null,
        ci?.ip ?? null,
        ci?.country ?? null,
        now,
      );
    } catch (err) {
      // Log but swallow — analytics must never crash the caller
      log.warn({ err }, 'usage-recorder: failed to persist event');
    }
  }

  /**
   * Record a session lifecycle event (start/end).
   */
  recordSession(event: SessionEvent): void {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();
      const db = getDb();
      const ci = event.clientInfo;

      db.prepare(
        `INSERT INTO usage_events
           (id, tool_name, status, duration_ms,
            client_name, client_version, transport_type, ip, country, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        event.type,
        'success',
        event.sessionDurationMs ?? 0,
        ci.clientName ?? null,
        ci.clientVersion ?? null,
        ci.transportType ?? null,
        ci.ip ?? null,
        ci.country ?? null,
        now,
      );
    } catch (err) {
      log.warn({ err }, 'usage-recorder: failed to persist session event');
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _recorder: UsageRecorder | null = null;

export function getUsageRecorder(): UsageRecorder {
  if (!_recorder) _recorder = new UsageRecorder();
  return _recorder;
}
