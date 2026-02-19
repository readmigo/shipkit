import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDb } from '../queue/db.js';
import { ApiKeyManager } from '../auth/ApiKeyManager.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'shipkit-quota-test-'));
  process.env.SHIPKIT_DB_PATH = join(tmpDir, 'test.db');
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SHIPKIT_DB_PATH;
});

async function freshQuotaManager() {
  const mod = await import('./QuotaManager.js');
  return new mod.QuotaManager();
}

describe('QuotaManager', () => {
  describe('getLimits', () => {
    it.each([
      ['free',       10,   1_000,  10],
      ['pro',       200,  10_000,  60],
      ['team',      500,  50_000, 300],
      ['enterprise', -1,      -1,  -1],
    ] as const)('%s plan has correct limits', async (plan, publishLimit, callLimit, rateLimit) => {
      const qm = await freshQuotaManager();
      const limits = qm.getLimits(plan);
      expect(limits.publishLimit).toBe(publishLimit);
      expect(limits.callLimit).toBe(callLimit);
      expect(limits.rateLimit).toBe(rateLimit);
    });
  });

  describe('checkQuota', () => {
    it('should allow calls within limits', async () => {
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('pro');
      const qm = await freshQuotaManager();
      const result = qm.checkQuota(id, 'app.status');
      expect(result.allowed).toBe(true);
    });

    it('should block calls when callLimit is exhausted', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('free'); // callLimit = 1000

      // Force the counter to the limit
      getDb()
        .prepare(`UPDATE api_keys SET monthly_call_count = 1000 WHERE id = ?`)
        .run(id);

      const qm = await freshQuotaManager();
      const result = qm.checkQuota(id, 'app.status');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should block publish tools when publishLimit is exhausted', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('free'); // publishLimit = 10

      getDb()
        .prepare(`UPDATE api_keys SET monthly_publish_count = 10 WHERE id = ?`)
        .run(id);

      const qm = await freshQuotaManager();
      const result = qm.checkQuota(id, 'app.publish');
      expect(result.allowed).toBe(false);
    });

    it('should allow publish tools when only callLimit is not exhausted', async () => {
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('free');
      const qm = await freshQuotaManager();
      const result = qm.checkQuota(id, 'app.publish');
      expect(result.allowed).toBe(true);
    });

    it('should return allowed=false for unknown keyId', async () => {
      const qm = await freshQuotaManager();
      expect(qm.checkQuota('key_ghost', 'app.status').allowed).toBe(false);
    });

    it('enterprise plan is always allowed regardless of counts', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('enterprise');

      getDb()
        .prepare(
          `UPDATE api_keys SET monthly_call_count = 999999, monthly_publish_count = 999999 WHERE id = ?`,
        )
        .run(id);

      const qm = await freshQuotaManager();
      expect(qm.checkQuota(id, 'app.publish').allowed).toBe(true);
    });
  });

  describe('incrementUsage', () => {
    it('should increment call count for a regular tool', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('pro');

      const qm = await freshQuotaManager();
      qm.incrementUsage(id, 'app.status');

      const row = getDb()
        .prepare(`SELECT monthly_call_count, monthly_publish_count FROM api_keys WHERE id = ?`)
        .get(id) as { monthly_call_count: number; monthly_publish_count: number };

      expect(row.monthly_call_count).toBe(1);
      expect(row.monthly_publish_count).toBe(0);
    });

    it('should increment both counters for app.publish', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('pro');

      const qm = await freshQuotaManager();
      qm.incrementUsage(id, 'app.publish');

      const row = getDb()
        .prepare(`SELECT monthly_call_count, monthly_publish_count FROM api_keys WHERE id = ?`)
        .get(id) as { monthly_call_count: number; monthly_publish_count: number };

      expect(row.monthly_call_count).toBe(1);
      expect(row.monthly_publish_count).toBe(1);
    });

    it('should increment both counters for app.upload', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('pro');

      const qm = await freshQuotaManager();
      qm.incrementUsage(id, 'app.upload');

      const row = getDb()
        .prepare(`SELECT monthly_call_count, monthly_publish_count FROM api_keys WHERE id = ?`)
        .get(id) as { monthly_call_count: number; monthly_publish_count: number };

      expect(row.monthly_call_count).toBe(1);
      expect(row.monthly_publish_count).toBe(1);
    });
  });

  describe('resetQuotasIfNeeded', () => {
    it('should reset counters when quota_resets_at is in the past', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('free');

      // Push reset date into the past and set some usage
      getDb()
        .prepare(
          `UPDATE api_keys
           SET quota_resets_at = '2000-01-01T00:00:00.000Z',
               monthly_call_count = 50,
               monthly_publish_count = 5
           WHERE id = ?`,
        )
        .run(id);

      const qm = await freshQuotaManager();
      qm.resetQuotasIfNeeded(id);

      const row = getDb()
        .prepare(`SELECT monthly_call_count, monthly_publish_count FROM api_keys WHERE id = ?`)
        .get(id) as { monthly_call_count: number; monthly_publish_count: number };

      expect(row.monthly_call_count).toBe(0);
      expect(row.monthly_publish_count).toBe(0);
    });

    it('should NOT reset counters when quota_resets_at is in the future', async () => {
      const { getDb } = await import('../queue/db.js');
      const keyMgr = new ApiKeyManager();
      const { id } = keyMgr.generateKey('free');

      getDb()
        .prepare(`UPDATE api_keys SET monthly_call_count = 50 WHERE id = ?`)
        .run(id);

      const qm = await freshQuotaManager();
      qm.resetQuotasIfNeeded(id);

      const row = getDb()
        .prepare(`SELECT monthly_call_count FROM api_keys WHERE id = ?`)
        .get(id) as { monthly_call_count: number };

      expect(row.monthly_call_count).toBe(50);
    });
  });
});
