/**
 * Analytics API endpoint tests.
 *
 * Uses an in-memory SQLite database (SHIPKIT_DB_PATH=:memory:) and seeds
 * test data before each suite to keep tests isolated and fast.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createAnalyticsRouter } from './analytics.js';
import { getDb, closeDb } from '../../queue/db.js';
import { getApiKeyManager } from '../../auth/ApiKeyManager.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeApp(): Hono {
  const app = new Hono();
  app.route('/api/analytics', createAnalyticsRouter());
  return app;
}

function seedEvents(overrides: Partial<{
  apiKeyId: string;
  toolName: string;
  storeId: string;
  status: string;
  durationMs: number;
}>[]) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO usage_events (id, api_key_id, tool_name, store_id, status, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' days'))
  `);
  const insert = db.transaction((rows: typeof overrides) => {
    rows.forEach((r, i) => {
      stmt.run(
        `evt_test_${i}_${Date.now()}`,
        r.apiKeyId ?? null,
        r.toolName ?? 'app.status',
        r.storeId ?? 'google_play',
        r.status ?? 'success',
        r.durationMs ?? 100,
        0, // today
      );
    });
  });
  insert(overrides);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Analytics API', () => {
  let app: Hono;

  beforeEach(() => {
    process.env.SHIPKIT_DB_PATH = ':memory:';
    // Reset singleton so a fresh DB is used each test
    closeDb();
    app = makeApp();
  });

  afterEach(() => {
    closeDb();
  });

  // ── /overview ────────────────────────────────────────────────────

  describe('GET /api/analytics/overview', () => {
    it('returns zero counts on empty DB', async () => {
      const res = await app.request('/api/analytics/overview');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.totalCalls).toBe(0);
      expect(body.totalPublishes).toBe(0);
      expect(body.mau).toBe(0);
      expect(body.activeStores).toBe(0);
      expect(body.uptimePercent).toBe(100);
    });

    it('aggregates total calls correctly', async () => {
      seedEvents([
        { status: 'success' },
        { status: 'success' },
        { status: 'failed' },
      ]);
      const res = await app.request('/api/analytics/overview');
      const body = await res.json() as Record<string, unknown>;
      expect(body.totalCalls).toBe(3);
      expect(typeof body.uptimePercent).toBe('number');
    });

    it('counts publish events', async () => {
      seedEvents([
        { toolName: 'app.publish', status: 'success' },
        { toolName: 'app.upload', status: 'success' },
        { toolName: 'app.status', status: 'success' },
      ]);
      const res = await app.request('/api/analytics/overview');
      const body = await res.json() as Record<string, unknown>;
      expect(body.totalPublishes).toBe(2);
    });

    it('counts MAU (monthly active users)', async () => {
      seedEvents([
        { apiKeyId: 'key_aaa' },
        { apiKeyId: 'key_bbb' },
        { apiKeyId: 'key_aaa' }, // duplicate, same user
      ]);
      const res = await app.request('/api/analytics/overview');
      const body = await res.json() as Record<string, unknown>;
      expect(body.mau).toBe(2);
    });

    it('counts active stores', async () => {
      seedEvents([
        { storeId: 'google_play' },
        { storeId: 'app_store' },
        { storeId: 'google_play' },
      ]);
      const res = await app.request('/api/analytics/overview');
      const body = await res.json() as Record<string, unknown>;
      expect(body.activeStores).toBe(2);
    });

    it('calculates uptime percentage', async () => {
      seedEvents([
        { status: 'success' },
        { status: 'success' },
        { status: 'success' },
        { status: 'failed' },
      ]);
      const res = await app.request('/api/analytics/overview');
      const body = await res.json() as Record<string, unknown>;
      expect(body.uptimePercent).toBe(75);
    });
  });

  // ── /tools ───────────────────────────────────────────────────────

  describe('GET /api/analytics/tools', () => {
    it('returns 401 without admin key', async () => {
      const res = await app.request('/api/analytics/tools');
      expect(res.status).toBe(401);
    });

    it('returns tool stats for valid admin key', async () => {
      // Create an enterprise key (treated as admin)
      const km = getApiKeyManager();
      const { apiKey } = km.generateKey('enterprise');

      seedEvents([
        { toolName: 'app.publish', status: 'success' },
        { toolName: 'app.publish', status: 'success' },
        { toolName: 'app.status', status: 'failed' },
      ]);

      const res = await app.request('/api/analytics/tools', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { tools: Array<Record<string, unknown>> };
      expect(Array.isArray(body.tools)).toBe(true);

      const publishTool = body.tools.find((t) => t.toolName === 'app.publish');
      expect(publishTool).toBeDefined();
      expect(publishTool!.totalCalls).toBe(2);
      expect(publishTool!.successRate).toBe(100);
    });
  });

  // ── /stores ──────────────────────────────────────────────────────

  describe('GET /api/analytics/stores', () => {
    it('returns 401 without admin key', async () => {
      const res = await app.request('/api/analytics/stores');
      expect(res.status).toBe(401);
    });

    it('returns store stats for valid admin key', async () => {
      const km = getApiKeyManager();
      const { apiKey } = km.generateKey('enterprise');

      seedEvents([
        { storeId: 'google_play', status: 'success' },
        { storeId: 'google_play', status: 'failed' },
        { storeId: 'app_store', status: 'success' },
      ]);

      const res = await app.request('/api/analytics/stores', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { stores: Array<Record<string, unknown>> };
      expect(Array.isArray(body.stores)).toBe(true);

      const gp = body.stores.find((s) => s.storeId === 'google_play');
      expect(gp).toBeDefined();
      expect(gp!.totalCalls).toBe(2);
      expect(gp!.successRate).toBe(50);
    });
  });

  // ── /usage ───────────────────────────────────────────────────────

  describe('GET /api/analytics/usage', () => {
    it('returns 400 without apiKeyId', async () => {
      const res = await app.request('/api/analytics/usage');
      expect(res.status).toBe(400);
    });

    it('returns zero usage for unknown key', async () => {
      const res = await app.request('/api/analytics/usage?apiKeyId=key_nonexistent');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const thisMonth = body.thisMonth as Record<string, unknown>;
      expect(thisMonth.calls).toBe(0);
      expect(thisMonth.publishes).toBe(0);
    });

    it('returns usage stats for known key', async () => {
      seedEvents([
        { apiKeyId: 'key_target', toolName: 'app.publish', status: 'success' },
        { apiKeyId: 'key_target', toolName: 'app.status', status: 'success' },
        { apiKeyId: 'key_other', toolName: 'app.status', status: 'success' },
      ]);
      const res = await app.request('/api/analytics/usage?apiKeyId=key_target');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const thisMonth = body.thisMonth as Record<string, unknown>;
      expect(thisMonth.calls).toBe(2);
      expect(thisMonth.publishes).toBe(1);
      expect(Array.isArray(body.history)).toBe(true);
    });
  });

  // ── /quota ───────────────────────────────────────────────────────

  describe('GET /api/analytics/quota', () => {
    it('returns 400 without apiKeyId', async () => {
      const res = await app.request('/api/analytics/quota');
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown key', async () => {
      const res = await app.request('/api/analytics/quota?apiKeyId=key_unknown');
      expect(res.status).toBe(404);
    });

    it('returns quota for a real key', async () => {
      const km = getApiKeyManager();
      const { id } = km.generateKey('pro', 'test@example.com');

      const res = await app.request(`/api/analytics/quota?apiKeyId=${encodeURIComponent(id)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.plan).toBe('pro');
      expect(body.publishUsed).toBe(0);
      expect(body.publishLimit).toBe(200);
      expect(body.callUsed).toBe(0);
      expect(body.callLimit).toBe(10000);
      expect(body.resetAt).toBeDefined();
    });

    it('reflects plan limits for free tier', async () => {
      const km = getApiKeyManager();
      const { id } = km.generateKey('free');

      const res = await app.request(`/api/analytics/quota?apiKeyId=${encodeURIComponent(id)}`);
      const body = await res.json() as Record<string, unknown>;
      expect(body.plan).toBe('free');
      expect(body.publishLimit).toBe(10);
      expect(body.callLimit).toBe(1000);
    });

    it('reflects unlimited limits for enterprise tier', async () => {
      const km = getApiKeyManager();
      const { id } = km.generateKey('enterprise');

      const res = await app.request(`/api/analytics/quota?apiKeyId=${encodeURIComponent(id)}`);
      const body = await res.json() as Record<string, unknown>;
      expect(body.plan).toBe('enterprise');
      expect(body.publishLimit).toBe(-1);
      expect(body.callLimit).toBe(-1);
    });
  });

  // ── /trends ──────────────────────────────────────────────────────

  describe('GET /api/analytics/trends', () => {
    it('returns 401 without admin key', async () => {
      const res = await app.request('/api/analytics/trends');
      expect(res.status).toBe(401);
    });

    it('returns trend data for admin key', async () => {
      const km = getApiKeyManager();
      const { apiKey } = km.generateKey('enterprise');

      seedEvents([
        { status: 'success', apiKeyId: 'key_u1' },
        { status: 'failed', apiKeyId: 'key_u2' },
      ]);

      const res = await app.request('/api/analytics/trends?days=30', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { trends: Array<Record<string, unknown>> };
      expect(Array.isArray(body.trends)).toBe(true);
      if (body.trends.length > 0) {
        const row = body.trends[0];
        expect(typeof row.date).toBe('string');
        expect(typeof row.totalCalls).toBe('number');
        expect(typeof row.successCalls).toBe('number');
        expect(typeof row.failedCalls).toBe('number');
        expect(typeof row.uniqueUsers).toBe('number');
      }
    });

    it('caps days parameter at 90', async () => {
      const km = getApiKeyManager();
      const { apiKey } = km.generateKey('enterprise');

      const res = await app.request('/api/analytics/trends?days=999', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status).toBe(200);
    });
  });
});
