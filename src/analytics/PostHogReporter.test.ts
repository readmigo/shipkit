import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDb, getDb } from '../queue/db.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'shipkit-posthog-test-'));
  process.env.SHIPKIT_DB_PATH = join(tmpDir, 'test.db');
  process.env.POSTHOG_API_KEY = 'phc_test_key';
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SHIPKIT_DB_PATH;
  delete process.env.POSTHOG_API_KEY;
  vi.restoreAllMocks();
});

function seedEvents(count: number): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO usage_events
       (id, tool_name, status, duration_ms, client_name, client_version, transport_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i++) {
    stmt.run(
      `evt-${i}`,
      'app.status',
      'success',
      10 + i,
      'claude-code',
      '1.0.0',
      'stdio',
      new Date().toISOString(),
    );
  }
}

interface SyncedRow {
  id: string;
  synced_at: string | null;
}

describe('PostHogReporter', () => {
  describe('flush', () => {
    it('should mark events as synced after successful upload', async () => {
      seedEvents(3);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      );

      const { PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = new PostHogReporter('phc_test_key');
      const synced = await reporter.flush();

      expect(synced).toBe(3);

      const rows = getDb()
        .prepare(`SELECT id, synced_at FROM usage_events ORDER BY id`)
        .all() as SyncedRow[];

      for (const row of rows) {
        expect(row.synced_at).not.toBeNull();
      }
    });

    it('should send correct PostHog batch payload', async () => {
      seedEvents(1);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      );

      const { PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = new PostHogReporter('phc_test_key');
      await reporter.flush();

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain('/batch');

      const body = JSON.parse(opts!.body as string);
      expect(body.api_key).toBe('phc_test_key');
      expect(body.batch).toHaveLength(1);
      expect(body.batch[0].event).toBe('mcp_tool_call');
      expect(body.batch[0].properties.tool_name).toBe('app.status');
    });

    it('should not mark events as synced on upload failure', async () => {
      seedEvents(2);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('rate limited', { status: 429 }),
      );

      const { PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = new PostHogReporter('phc_test_key');
      const synced = await reporter.flush();

      expect(synced).toBe(0);

      const rows = getDb()
        .prepare(`SELECT synced_at FROM usage_events`)
        .all() as SyncedRow[];

      for (const row of rows) {
        expect(row.synced_at).toBeNull();
      }
    });

    it('should handle network errors without throwing', async () => {
      seedEvents(1);

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = new PostHogReporter('phc_test_key');

      // Must not throw
      const synced = await reporter.flush();
      expect(synced).toBe(0);
    });

    it('should return 0 when no unsynced events exist', async () => {
      // Empty DB, no events seeded
      getDb(); // Initialize schema

      const { PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = new PostHogReporter('phc_test_key');
      const synced = await reporter.flush();

      expect(synced).toBe(0);
    });

    it('should map session events to correct PostHog event names', async () => {
      const db = getDb();
      db.prepare(
        `INSERT INTO usage_events (id, tool_name, status, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('evt-session', 'session_start', 'success', 0, new Date().toISOString());

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      );

      const { PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = new PostHogReporter('phc_test_key');
      await reporter.flush();

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.batch[0].event).toBe('mcp_session_start');
    });

    it('should process events in batches of 50', async () => {
      seedEvents(75);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      );

      const { PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = new PostHogReporter('phc_test_key');
      const synced = await reporter.flush();

      expect(synced).toBe(75);
      // 50 + 25 = 2 batch calls
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPostHogReporter', () => {
    it('should return null when POSTHOG_API_KEY is not set', async () => {
      delete process.env.POSTHOG_API_KEY;

      // Force fresh module
      vi.resetModules();
      const { getPostHogReporter } = await import('./PostHogReporter.js');
      const reporter = getPostHogReporter();
      expect(reporter).toBeNull();
    });

    it('should return a PostHogReporter when POSTHOG_API_KEY is set', async () => {
      process.env.POSTHOG_API_KEY = 'phc_test';

      vi.resetModules();
      const { getPostHogReporter, PostHogReporter } = await import('./PostHogReporter.js');
      const reporter = getPostHogReporter();
      expect(reporter).toBeInstanceOf(PostHogReporter);
    });
  });
});
