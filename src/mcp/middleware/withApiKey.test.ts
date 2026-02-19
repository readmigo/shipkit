import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDb, getDb } from '../../queue/db.js';
import { ApiKeyManager } from '../../auth/ApiKeyManager.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'shipkit-middleware-test-'));
  process.env.SHIPKIT_DB_PATH = join(tmpDir, 'test.db');
  delete process.env.SHIPKIT_API_KEY;
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SHIPKIT_DB_PATH;
  delete process.env.SHIPKIT_API_KEY;
});

async function freshMiddleware() {
  const mod = await import('./withApiKey.js');
  return mod.withApiKey;
}

const okHandler = vi.fn().mockResolvedValue({
  content: [{ type: 'text' as const, text: 'ok' }],
});

describe('withApiKey middleware', () => {
  beforeEach(() => {
    okHandler.mockClear();
  });

  describe('unauthenticated path (requireAuth = false)', () => {
    it('should call handler when no key is present and requireAuth is false', async () => {
      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler);
      const result = await wrapped({});
      expect(okHandler).toHaveBeenCalledOnce();
      expect(result.content[0].text).toBe('ok');
    });

    it('should read key from SHIPKIT_API_KEY env when no _apiKey param', async () => {
      const keyMgr = new ApiKeyManager();
      const { apiKey } = keyMgr.generateKey('pro');
      process.env.SHIPKIT_API_KEY = apiKey;

      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler);
      await wrapped({});
      expect(okHandler).toHaveBeenCalledOnce();
    });
  });

  describe('requireAuth = true', () => {
    it('should return UNAUTHORIZED when no key is provided', async () => {
      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler, { requireAuth: true });
      const result = await wrapped({});
      expect(okHandler).not.toHaveBeenCalled();
      const body = JSON.parse(result.content[0].text);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('invalid key', () => {
    it('should return UNAUTHORIZED for an unrecognized key', async () => {
      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler);
      const result = await wrapped({ _apiKey: 'sk-shipkit-free-' + 'f'.repeat(32) });
      const body = JSON.parse(result.content[0].text);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(okHandler).not.toHaveBeenCalled();
    });

    it('should return UNAUTHORIZED for a revoked key', async () => {
      const keyMgr = new ApiKeyManager();
      const { apiKey, id } = keyMgr.generateKey('free');
      keyMgr.revokeKey(id);

      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler);
      const result = await wrapped({ _apiKey: apiKey });
      const body = JSON.parse(result.content[0].text);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('quota enforcement', () => {
    it('should return QUOTA_EXCEEDED when call limit is reached', async () => {
      const keyMgr = new ApiKeyManager();
      const { apiKey, id } = keyMgr.generateKey('free');

      // Exhaust the call limit
      getDb()
        .prepare(`UPDATE api_keys SET monthly_call_count = 1000 WHERE id = ?`)
        .run(id);

      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler);
      const result = await wrapped({ _apiKey: apiKey });
      const body = JSON.parse(result.content[0].text);
      expect(body.code).toBe('QUOTA_EXCEEDED');
      expect(okHandler).not.toHaveBeenCalled();
    });
  });

  describe('successful authenticated call', () => {
    it('should call handler and increment usage counters', async () => {
      const keyMgr = new ApiKeyManager();
      const { apiKey, id } = keyMgr.generateKey('pro');

      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler);
      const result = await wrapped({ _apiKey: apiKey });

      expect(result.content[0].text).toBe('ok');

      const row = getDb()
        .prepare(`SELECT monthly_call_count FROM api_keys WHERE id = ?`)
        .get(id) as { monthly_call_count: number };
      expect(row.monthly_call_count).toBe(1);
    });

    it('should record a usage event on success', async () => {
      const keyMgr = new ApiKeyManager();
      const { apiKey } = keyMgr.generateKey('pro');

      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.status', okHandler);
      await wrapped({ _apiKey: apiKey });

      const rows = getDb().prepare(`SELECT * FROM usage_events`).all() as Array<{
        tool_name: string;
        status: string;
      }>;
      const event = rows.find(r => r.tool_name === 'app.status');
      expect(event).toBeDefined();
      expect(event!.status).toBe('success');
    });

    it('should record a failed usage event and rethrow when handler throws', async () => {
      const keyMgr = new ApiKeyManager();
      const { apiKey } = keyMgr.generateKey('pro');
      const failingHandler = vi.fn().mockRejectedValue(new Error('store unreachable'));

      const withApiKey = await freshMiddleware();
      const wrapped = withApiKey('app.publish', failingHandler);

      await expect(wrapped({ _apiKey: apiKey })).rejects.toThrow('store unreachable');

      const rows = getDb().prepare(`SELECT * FROM usage_events`).all() as Array<{
        tool_name: string;
        status: string;
        error_message: string | null;
      }>;
      const event = rows.find(r => r.tool_name === 'app.publish');
      expect(event!.status).toBe('failed');
      expect(event!.error_message).toBe('store unreachable');
    });
  });
});
