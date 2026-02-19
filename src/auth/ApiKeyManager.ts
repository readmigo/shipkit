/**
 * ApiKeyManager — Generate, validate, and revoke ShipKit API keys.
 *
 * Keys are stored as SHA-256 hashes; plaintext is never persisted.
 * Format: sk-shipkit-{plan}-{32 hex chars}
 */

import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../queue/db.js';

// ─── Types ───────────────────────────────────────────────────────────

export type ApiKeyPlan = 'free' | 'pro' | 'team' | 'enterprise';

export interface ApiKeyInfo {
  id: string;
  plan: ApiKeyPlan;
  userId: string | null;
  email: string | null;
  monthlyPublishCount: number;
  monthlyCallCount: number;
  quotaResetsAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  isActive: boolean;
}

interface ApiKeyRow {
  id: string;
  key_hash: string;
  plan: string;
  user_id: string | null;
  email: string | null;
  monthly_publish_count: number;
  monthly_call_count: number;
  quota_resets_at: string;
  created_at: string;
  last_used_at: string | null;
  is_active: number;
}

function rowToInfo(row: ApiKeyRow): ApiKeyInfo {
  return {
    id: row.id,
    plan: row.plan as ApiKeyPlan,
    userId: row.user_id,
    email: row.email,
    monthlyPublishCount: row.monthly_publish_count,
    monthlyCallCount: row.monthly_call_count,
    quotaResetsAt: row.quota_resets_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    isActive: row.is_active === 1,
  };
}

function hashKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

function nextMonthReset(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ─── ApiKeyManager ───────────────────────────────────────────────────

export class ApiKeyManager {
  /**
   * Generate a new API key for the given plan.
   * Returns the plaintext key (shown once) and its database id.
   */
  generateKey(plan: ApiKeyPlan, email?: string): { apiKey: string; id: string } {
    const suffix = randomBytes(16).toString('hex'); // 32 hex chars
    const apiKey = `sk-shipkit-${plan}-${suffix}`;
    const id = `key_${randomBytes(8).toString('hex')}`;
    const keyHash = hashKey(apiKey);
    const now = new Date().toISOString();
    const quotaResetsAt = nextMonthReset();

    const db = getDb();
    db.prepare(
      `INSERT INTO api_keys (id, key_hash, plan, email, quota_resets_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, keyHash, plan, email ?? null, quotaResetsAt, now);

    return { apiKey, id };
  }

  /**
   * Validate an API key. Returns validity status, key id, and plan.
   * Updates last_used_at on success.
   */
  validateKey(apiKey: string): { valid: boolean; keyId?: string; plan?: ApiKeyPlan } {
    const keyHash = hashKey(apiKey);
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1`)
      .get(keyHash) as ApiKeyRow | undefined;

    if (!row) return { valid: false };

    db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      row.id,
    );

    return { valid: true, keyId: row.id, plan: row.plan as ApiKeyPlan };
  }

  /**
   * Soft-delete an API key by setting is_active = 0.
   */
  revokeKey(keyId: string): void {
    const db = getDb();
    db.prepare(`UPDATE api_keys SET is_active = 0 WHERE id = ?`).run(keyId);
  }

  /**
   * Retrieve full key info by id (without the hash).
   */
  getKeyInfo(keyId: string): ApiKeyInfo | null {
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM api_keys WHERE id = ?`)
      .get(keyId) as ApiKeyRow | undefined;
    return row ? rowToInfo(row) : null;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _manager: ApiKeyManager | null = null;

export function getApiKeyManager(): ApiKeyManager {
  if (!_manager) _manager = new ApiKeyManager();
  return _manager;
}
