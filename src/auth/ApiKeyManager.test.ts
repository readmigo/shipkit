import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDb } from '../queue/db.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'shipkit-apikey-test-'));
  process.env.SHIPKIT_DB_PATH = join(tmpDir, 'test.db');
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SHIPKIT_DB_PATH;
});

async function freshManager() {
  const mod = await import('./ApiKeyManager.js');
  return new mod.ApiKeyManager();
}

describe('ApiKeyManager', () => {
  describe('generateKey', () => {
    it('should return a plaintext key with the correct prefix', async () => {
      const mgr = await freshManager();
      const { apiKey, id } = mgr.generateKey('free');
      expect(apiKey).toMatch(/^sk-shipkit-free-[0-9a-f]{32}$/);
      expect(id).toMatch(/^key_[0-9a-f]{16}$/);
    });

    it('should embed the plan name in the key', async () => {
      const mgr = await freshManager();
      const { apiKey } = mgr.generateKey('pro');
      expect(apiKey).toMatch(/^sk-shipkit-pro-/);
    });

    it('should generate unique keys on each call', async () => {
      const mgr = await freshManager();
      const { apiKey: k1 } = mgr.generateKey('free');
      const { apiKey: k2 } = mgr.generateKey('free');
      expect(k1).not.toBe(k2);
    });

    it('should persist the key and make it retrievable by id', async () => {
      const mgr = await freshManager();
      const { id } = mgr.generateKey('team', 'user@example.com');
      const info = mgr.getKeyInfo(id);
      expect(info).not.toBeNull();
      expect(info!.plan).toBe('team');
      expect(info!.email).toBe('user@example.com');
      expect(info!.isActive).toBe(true);
    });
  });

  describe('validateKey', () => {
    it('should return valid=true for a freshly generated key', async () => {
      const mgr = await freshManager();
      const { apiKey, id } = mgr.generateKey('pro');
      const result = mgr.validateKey(apiKey);
      expect(result.valid).toBe(true);
      expect(result.keyId).toBe(id);
      expect(result.plan).toBe('pro');
    });

    it('should return valid=false for an unknown key', async () => {
      const mgr = await freshManager();
      const result = mgr.validateKey('sk-shipkit-free-' + '0'.repeat(32));
      expect(result.valid).toBe(false);
      expect(result.keyId).toBeUndefined();
    });

    it('should update last_used_at on successful validation', async () => {
      const mgr = await freshManager();
      const { apiKey, id } = mgr.generateKey('free');
      const before = mgr.getKeyInfo(id)!.lastUsedAt;
      expect(before).toBeNull();

      mgr.validateKey(apiKey);

      const after = mgr.getKeyInfo(id)!.lastUsedAt;
      expect(after).not.toBeNull();
    });

    it('should return valid=false for a revoked key', async () => {
      const mgr = await freshManager();
      const { apiKey, id } = mgr.generateKey('free');
      mgr.revokeKey(id);
      const result = mgr.validateKey(apiKey);
      expect(result.valid).toBe(false);
    });
  });

  describe('revokeKey', () => {
    it('should set isActive to false', async () => {
      const mgr = await freshManager();
      const { id } = mgr.generateKey('free');
      mgr.revokeKey(id);
      const info = mgr.getKeyInfo(id);
      expect(info!.isActive).toBe(false);
    });
  });

  describe('getKeyInfo', () => {
    it('should return null for unknown keyId', async () => {
      const mgr = await freshManager();
      expect(mgr.getKeyInfo('key_nonexistent')).toBeNull();
    });
  });
});
