import { describe, it, expect, beforeEach } from 'vitest';
import { AuthManager } from './AuthManager.js';

describe('AuthManager', () => {
  let auth: AuthManager;

  beforeEach(() => {
    auth = new AuthManager();
  });

  describe('setCredentials + getToken (apikey path)', () => {
    it('should return the api key as token without HTTP request', async () => {
      auth.setCredentials('test_store', {
        type: 'apikey',
        config: { apiKey: 'my-secret-key-123' },
      });

      const token = await auth.getToken('test_store');
      expect(token).toBe('my-secret-key-123');
    });

    it('should return empty string when apiKey is missing from config', async () => {
      auth.setCredentials('test_store', {
        type: 'apikey',
        config: {},
      });

      const token = await auth.getToken('test_store');
      expect(token).toBe('');
    });

    it('should cache the apikey token after first getToken call', async () => {
      auth.setCredentials('test_store', {
        type: 'apikey',
        config: { apiKey: 'cached-key' },
      });

      await auth.getToken('test_store');
      expect(auth.isTokenValid('test_store')).toBe(true);
    });
  });

  describe('setCredentials + getToken (rsa path)', () => {
    it('should return rsa-sign-per-request marker', async () => {
      auth.setCredentials('rsa_store', {
        type: 'rsa',
        config: {},
      });

      const token = await auth.getToken('rsa_store');
      expect(token).toBe('rsa-sign-per-request');
    });
  });

  describe('isTokenValid', () => {
    it('should return false when no token is cached', () => {
      expect(auth.isTokenValid('nonexistent_store')).toBe(false);
    });

    it('should return true when cached token has not expired', async () => {
      auth.setCredentials('test_store', {
        type: 'apikey',
        config: { apiKey: 'valid-key' },
      });

      await auth.getToken('test_store');
      expect(auth.isTokenValid('test_store')).toBe(true);
    });

    it('should return cached token on second getToken call', async () => {
      auth.setCredentials('test_store', {
        type: 'apikey',
        config: { apiKey: 'reuse-key' },
      });

      const token1 = await auth.getToken('test_store');
      const token2 = await auth.getToken('test_store');
      expect(token1).toBe(token2);
      expect(token2).toBe('reuse-key');
    });
  });

  describe('getToken error handling', () => {
    it('should throw error when no credentials configured', async () => {
      await expect(auth.getToken('unknown_store')).rejects.toThrow(
        'No credentials configured for store: unknown_store',
      );
    });

    it('should throw error for missing store after setting different store', async () => {
      auth.setCredentials('store_a', {
        type: 'apikey',
        config: { apiKey: 'key-a' },
      });

      await expect(auth.getToken('store_b')).rejects.toThrow(
        'No credentials configured for store: store_b',
      );
    });
  });

  describe('refreshToken', () => {
    it('should overwrite cached token on refreshToken call', async () => {
      auth.setCredentials('test_store', {
        type: 'apikey',
        config: { apiKey: 'fresh-key' },
      });

      const token = await auth.refreshToken('test_store');
      expect(token).toBe('fresh-key');
      expect(auth.isTokenValid('test_store')).toBe(true);
    });
  });

  describe('multiple stores', () => {
    it('should manage credentials for multiple stores independently', async () => {
      auth.setCredentials('store_a', {
        type: 'apikey',
        config: { apiKey: 'key-a' },
      });
      auth.setCredentials('store_b', {
        type: 'apikey',
        config: { apiKey: 'key-b' },
      });

      const tokenA = await auth.getToken('store_a');
      const tokenB = await auth.getToken('store_b');

      expect(tokenA).toBe('key-a');
      expect(tokenB).toBe('key-b');
    });
  });
});
