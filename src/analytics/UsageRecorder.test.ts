import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDb, getDb } from '../queue/db.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'shipkit-usage-test-'));
  process.env.SHIPKIT_DB_PATH = join(tmpDir, 'test.db');
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SHIPKIT_DB_PATH;
});

async function freshRecorder() {
  const mod = await import('./UsageRecorder.js');
  return new mod.UsageRecorder();
}

interface UsageEventRow {
  id: string;
  api_key_id: string | null;
  tool_name: string;
  store_id: string | null;
  app_id: string | null;
  status: string;
  duration_ms: number;
  file_size_bytes: number | null;
  error_message: string | null;
}

describe('UsageRecorder', () => {
  describe('recordEvent', () => {
    it('should insert a row into usage_events', async () => {
      const recorder = await freshRecorder();
      recorder.recordEvent({ toolName: 'app.status', status: 'success', durationMs: 42 });

      const rows = getDb().prepare(`SELECT * FROM usage_events`).all() as UsageEventRow[];
      expect(rows).toHaveLength(1);
      expect(rows[0].tool_name).toBe('app.status');
      expect(rows[0].status).toBe('success');
      expect(rows[0].duration_ms).toBe(42);
    });

    it('should persist all optional fields when supplied', async () => {
      const recorder = await freshRecorder();
      recorder.recordEvent({
        apiKeyId: 'key_abc',
        toolName: 'app.publish',
        storeId: 'google_play',
        appId: 'com.example',
        status: 'failed',
        durationMs: 100,
        fileSizeBytes: 5_000_000,
        errorMessage: 'Network timeout',
      });

      const row = getDb()
        .prepare(`SELECT * FROM usage_events`)
        .get() as UsageEventRow;

      expect(row.api_key_id).toBe('key_abc');
      expect(row.store_id).toBe('google_play');
      expect(row.app_id).toBe('com.example');
      expect(row.file_size_bytes).toBe(5_000_000);
      expect(row.error_message).toBe('Network timeout');
    });

    it('should persist null for missing optional fields', async () => {
      const recorder = await freshRecorder();
      recorder.recordEvent({ toolName: 'store.list', status: 'success', durationMs: 5 });

      const row = getDb()
        .prepare(`SELECT * FROM usage_events`)
        .get() as UsageEventRow;

      expect(row.api_key_id).toBeNull();
      expect(row.store_id).toBeNull();
      expect(row.app_id).toBeNull();
      expect(row.file_size_bytes).toBeNull();
      expect(row.error_message).toBeNull();
    });

    it('should generate unique ids for each event', async () => {
      const recorder = await freshRecorder();
      recorder.recordEvent({ toolName: 'app.status', status: 'success', durationMs: 1 });
      recorder.recordEvent({ toolName: 'app.status', status: 'success', durationMs: 2 });

      const rows = getDb().prepare(`SELECT id FROM usage_events`).all() as Array<{ id: string }>;
      expect(rows[0].id).not.toBe(rows[1].id);
    });

    it('should never throw even when the DB fails', async () => {
      const recorder = await freshRecorder();

      // Force a DB error by closing the connection
      closeDb();

      // Must not throw
      expect(() =>
        recorder.recordEvent({ toolName: 'app.status', status: 'success', durationMs: 1 }),
      ).not.toThrow();
    });
  });
});
