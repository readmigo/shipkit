/**
 * Analytics API routes.
 *
 * GET /api/analytics/overview    — Public stats summary
 * GET /api/analytics/tools       — Tool distribution (admin key required)
 * GET /api/analytics/stores      — Store distribution (admin key required)
 * GET /api/analytics/usage       — Personal usage for an API key
 * GET /api/analytics/quota       — Quota status for an API key
 * GET /api/analytics/trends      — N-day call trend data (admin key required)
 */

import { Hono } from 'hono';
import { getDb } from '../../queue/db.js';
import { getApiKeyManager } from '../../auth/ApiKeyManager.js';
import { getQuotaManager } from '../../analytics/QuotaManager.js';

// ─── Helper: validate admin key from Authorization header ─────────────

function getAdminKeyId(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);
  const manager = getApiKeyManager();
  const result = manager.validateKey(apiKey);
  if (!result.valid || !result.keyId) return null;
  // Only enterprise or team keys are treated as admin
  if (result.plan !== 'enterprise' && result.plan !== 'team') return null;
  return result.keyId;
}

// ─── Router ──────────────────────────────────────────────────────────

export function createAnalyticsRouter(): Hono {
  const app = new Hono();

  // GET /api/analytics/overview
  app.get('/overview', (c) => {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(CASE WHEN tool_name IN ('app.publish', 'app.upload') AND status = 'success' THEN 1 END) as total_publishes,
        COUNT(DISTINCT api_key_id) as mau
      FROM usage_events
      WHERE created_at >= datetime('now', '-30 days')
    `).get() as { total_calls: number; total_publishes: number; mau: number };

    const activeStores = db.prepare(`
      SELECT COUNT(DISTINCT store_id) as count
      FROM usage_events
      WHERE created_at >= datetime('now', '-30 days')
        AND store_id IS NOT NULL
        AND store_id != ''
    `).get() as { count: number };

    const successRate = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success
      FROM usage_events
      WHERE created_at >= datetime('now', '-30 days')
    `).get() as { total: number; success: number };

    const uptimePercent = successRate.total > 0
      ? Math.round((successRate.success / successRate.total) * 1000) / 10
      : 100;

    return c.json({
      totalCalls: totals?.total_calls ?? 0,
      totalPublishes: totals?.total_publishes ?? 0,
      mau: totals?.mau ?? 0,
      activeStores: activeStores?.count ?? 0,
      uptimePercent,
    });
  });

  // GET /api/analytics/tools
  app.get('/tools', (c) => {
    const authHeader = c.req.header('Authorization');
    if (!getAdminKeyId(authHeader)) {
      return c.json({ error: 'Admin API key required' }, 401);
    }

    const db = getDb();
    const rows = db.prepare(`
      SELECT
        tool_name as toolName,
        COUNT(*) as totalCalls,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successCalls,
        AVG(duration_ms) as avgDurationMs
      FROM usage_events
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY tool_name
      ORDER BY totalCalls DESC
    `).all() as Array<{ toolName: string; totalCalls: number; successCalls: number; avgDurationMs: number }>;

    const tools = rows.map((r) => ({
      toolName: r.toolName,
      totalCalls: r.totalCalls,
      successRate: r.totalCalls > 0 ? Math.round((r.successCalls / r.totalCalls) * 1000) / 10 : 100,
      avgDurationMs: Math.round(r.avgDurationMs ?? 0),
    }));

    return c.json({ tools });
  });

  // GET /api/analytics/stores
  app.get('/stores', (c) => {
    const authHeader = c.req.header('Authorization');
    if (!getAdminKeyId(authHeader)) {
      return c.json({ error: 'Admin API key required' }, 401);
    }

    const db = getDb();
    const rows = db.prepare(`
      SELECT
        COALESCE(store_id, 'unknown') as storeId,
        COUNT(*) as totalCalls,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successCalls
      FROM usage_events
      WHERE created_at >= datetime('now', '-30 days')
        AND store_id IS NOT NULL
        AND store_id != ''
      GROUP BY store_id
      ORDER BY totalCalls DESC
    `).all() as Array<{ storeId: string; totalCalls: number; successCalls: number }>;

    const stores = rows.map((r) => ({
      storeId: r.storeId,
      totalCalls: r.totalCalls,
      successRate: r.totalCalls > 0 ? Math.round((r.successCalls / r.totalCalls) * 1000) / 10 : 100,
    }));

    return c.json({ stores });
  });

  // GET /api/analytics/usage?apiKeyId=xxx
  app.get('/usage', (c) => {
    const apiKeyId = c.req.query('apiKeyId');
    if (!apiKeyId) {
      return c.json({ error: 'Missing required query parameter: apiKeyId' }, 400);
    }

    const db = getDb();

    const thisMonth = db.prepare(`
      SELECT
        COUNT(*) as calls,
        COUNT(CASE WHEN tool_name IN ('app.publish', 'app.upload') AND status = 'success' THEN 1 END) as publishes
      FROM usage_events
      WHERE api_key_id = ?
        AND created_at >= datetime('now', 'start of month')
    `).get(apiKeyId) as { calls: number; publishes: number };

    const history = db.prepare(`
      SELECT
        date(created_at) as date,
        COUNT(*) as calls,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successCalls,
        COUNT(CASE WHEN tool_name IN ('app.publish', 'app.upload') THEN 1 END) as publishes
      FROM usage_events
      WHERE api_key_id = ?
        AND created_at >= datetime('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all(apiKeyId) as Array<{ date: string; calls: number; successCalls: number; publishes: number }>;

    return c.json({
      thisMonth: {
        calls: thisMonth?.calls ?? 0,
        publishes: thisMonth?.publishes ?? 0,
      },
      history,
    });
  });

  // GET /api/analytics/quota?apiKeyId=xxx
  app.get('/quota', (c) => {
    const apiKeyId = c.req.query('apiKeyId');
    if (!apiKeyId) {
      return c.json({ error: 'Missing required query parameter: apiKeyId' }, 400);
    }

    const db = getDb();
    const row = db.prepare(`
      SELECT plan, monthly_publish_count, monthly_call_count, quota_resets_at
      FROM api_keys WHERE id = ?
    `).get(apiKeyId) as {
      plan: string;
      monthly_publish_count: number;
      monthly_call_count: number;
      quota_resets_at: string;
    } | undefined;

    if (!row) {
      return c.json({ error: `API key not found: ${apiKeyId}` }, 404);
    }

    const quotaManager = getQuotaManager();
    const limits = quotaManager.getLimits(row.plan as 'free' | 'pro' | 'team' | 'enterprise');

    return c.json({
      plan: row.plan,
      publishUsed: row.monthly_publish_count,
      publishLimit: limits.publishLimit,
      callUsed: row.monthly_call_count,
      callLimit: limits.callLimit,
      resetAt: row.quota_resets_at,
    });
  });

  // GET /api/analytics/trends?days=30
  app.get('/trends', (c) => {
    const authHeader = c.req.header('Authorization');
    if (!getAdminKeyId(authHeader)) {
      return c.json({ error: 'Admin API key required' }, 401);
    }

    const daysParam = c.req.query('days');
    const days = Math.min(Math.max(parseInt(daysParam ?? '30', 10) || 30, 1), 90);

    const db = getDb();
    const rows = db.prepare(`
      SELECT
        date(created_at) as date,
        COUNT(*) as totalCalls,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successCalls,
        COUNT(CASE WHEN status != 'success' THEN 1 END) as failedCalls,
        COUNT(DISTINCT api_key_id) as uniqueUsers
      FROM usage_events
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all(days) as Array<{
      date: string;
      totalCalls: number;
      successCalls: number;
      failedCalls: number;
      uniqueUsers: number;
    }>;

    return c.json({ trends: rows });
  });

  return app;
}
