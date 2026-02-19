/**
 * QuotaManager — Per-plan monthly quota enforcement.
 *
 * Plans:
 *   free:       10 publishes / 1 000 calls / 10 rpm
 *   pro:       200 publishes / 10 000 calls / 60 rpm
 *   team:      500 publishes / 50 000 calls / 300 rpm
 *   enterprise: unlimited (-1)
 *
 * Quota windows are calendar-month boundaries stored in api_keys.quota_resets_at.
 */

import { getDb } from '../queue/db.js';
import type { ApiKeyPlan } from '../auth/ApiKeyManager.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface PlanLimits {
  /** Max publish operations per month. -1 = unlimited. */
  publishLimit: number;
  /** Max tool calls per month. -1 = unlimited. */
  callLimit: number;
  /** Max calls per minute. -1 = unlimited. */
  rateLimit: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  remaining?: number;
  resetAt?: string;
}

const PLAN_LIMITS: Record<ApiKeyPlan, PlanLimits> = {
  free:       { publishLimit: 10,   callLimit: 1_000,  rateLimit: 10  },
  pro:        { publishLimit: 200,  callLimit: 10_000, rateLimit: 60  },
  team:       { publishLimit: 500,  callLimit: 50_000, rateLimit: 300 },
  enterprise: { publishLimit: -1,   callLimit: -1,     rateLimit: -1  },
};

/** Tool names that consume a publish quota slot in addition to a call slot. */
const PUBLISH_TOOLS = new Set(['app.publish', 'app.upload']);

interface ApiKeyQuotaRow {
  plan: string;
  monthly_publish_count: number;
  monthly_call_count: number;
  quota_resets_at: string;
}

// ─── QuotaManager ────────────────────────────────────────────────────

export class QuotaManager {
  /**
   * Returns limits for the given plan.
   */
  getLimits(plan: ApiKeyPlan): PlanLimits {
    return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  }

  /**
   * Reset monthly counters if quota_resets_at has passed.
   */
  resetQuotasIfNeeded(keyId: string): void {
    const db = getDb();
    const row = db
      .prepare(`SELECT quota_resets_at FROM api_keys WHERE id = ?`)
      .get(keyId) as { quota_resets_at: string } | undefined;

    if (!row) return;

    if (new Date() >= new Date(row.quota_resets_at)) {
      const nextReset = this.nextMonthReset();
      db.prepare(
        `UPDATE api_keys
         SET monthly_publish_count = 0,
             monthly_call_count    = 0,
             quota_resets_at       = ?
         WHERE id = ?`,
      ).run(nextReset, keyId);
    }
  }

  /**
   * Check whether a key is allowed to invoke `toolName`.
   * Call resetQuotasIfNeeded before this.
   */
  checkQuota(keyId: string, toolName: string): QuotaCheckResult {
    const db = getDb();
    const row = db
      .prepare(`SELECT plan, monthly_publish_count, monthly_call_count, quota_resets_at FROM api_keys WHERE id = ?`)
      .get(keyId) as ApiKeyQuotaRow | undefined;

    if (!row) return { allowed: false };

    const limits = this.getLimits(row.plan as ApiKeyPlan);

    // Check call limit
    if (limits.callLimit !== -1 && row.monthly_call_count >= limits.callLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: row.quota_resets_at,
      };
    }

    // Check publish limit for publish-type tools
    if (PUBLISH_TOOLS.has(toolName) && limits.publishLimit !== -1) {
      if (row.monthly_publish_count >= limits.publishLimit) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: row.quota_resets_at,
        };
      }
    }

    const callRemaining =
      limits.callLimit === -1 ? undefined : limits.callLimit - row.monthly_call_count;

    return { allowed: true, remaining: callRemaining, resetAt: row.quota_resets_at };
  }

  /**
   * Increment usage counters after a successful tool call.
   */
  incrementUsage(keyId: string, toolName: string): void {
    const db = getDb();
    if (PUBLISH_TOOLS.has(toolName)) {
      db.prepare(
        `UPDATE api_keys
         SET monthly_call_count    = monthly_call_count + 1,
             monthly_publish_count = monthly_publish_count + 1
         WHERE id = ?`,
      ).run(keyId);
    } else {
      db.prepare(
        `UPDATE api_keys SET monthly_call_count = monthly_call_count + 1 WHERE id = ?`,
      ).run(keyId);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────

  private nextMonthReset(): string {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _manager: QuotaManager | null = null;

export function getQuotaManager(): QuotaManager {
  if (!_manager) _manager = new QuotaManager();
  return _manager;
}
