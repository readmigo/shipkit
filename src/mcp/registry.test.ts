import { describe, it, expect, beforeEach, vi } from 'vitest';

// Track created AuthManager instances for assertion
const authInstances: any[] = [];

// Mock node:fs and node:fs/promises before importing the module under test
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock the AdapterRegistry to avoid importing real adapters with external deps
vi.mock('../adapters/AdapterRegistry.js', () => {
  class MockAdapterRegistry {
    register = vi.fn();
    getAdapter = vi.fn();
    getSupportedStores = vi.fn().mockReturnValue([]);
    getCapabilities = vi.fn();
    getAllCapabilities = vi.fn().mockReturnValue([]);
    static createDefault = vi.fn().mockImplementation(function () {
      return new MockAdapterRegistry();
    });
  }

  return { AdapterRegistry: MockAdapterRegistry };
});

// Mock AuthManager - use a class so `new AuthManager()` works
vi.mock('../auth/AuthManager.js', () => {
  class MockAuthManager {
    setCredentials = vi.fn();
    getToken = vi.fn();
    isTokenValid = vi.fn();
    loadCredentials = vi.fn();
    refreshToken = vi.fn();
    ensureCredentialsDir = vi.fn();
    constructor() {
      authInstances.push(this);
    }
  }

  return { AuthManager: MockAuthManager };
});

import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { invalidateRegistry, getRegistry } from './registry.js';
import { AdapterRegistry } from '../adapters/AdapterRegistry.js';

describe('registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authInstances.length = 0;
    // Always invalidate to clear cached _registry between tests
    invalidateRegistry();
  });

  describe('invalidateRegistry', () => {
    it('should clear cached registry so getRegistry creates a new one', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const reg1 = await getRegistry();
      invalidateRegistry();
      const reg2 = await getRegistry();

      // createDefault should have been called twice (once per getRegistry after invalidation)
      expect(AdapterRegistry.createDefault).toHaveBeenCalledTimes(2);
      expect(reg1).not.toBe(reg2);
    });
  });

  describe('getRegistry - empty credentials directory', () => {
    it('should return AdapterRegistry when credentials directory does not exist', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const registry = await getRegistry();

      expect(registry).toBeDefined();
      expect(AdapterRegistry.createDefault).toHaveBeenCalledTimes(1);
    });

    it('should return cached registry on subsequent calls', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const reg1 = await getRegistry();
      const reg2 = await getRegistry();

      expect(reg1).toBe(reg2);
      expect(AdapterRegistry.createDefault).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRegistry - with credential files', () => {
    it('should load credentials when json and credentials files exist', async () => {
      const existsSyncMock = existsSync as ReturnType<typeof vi.fn>;
      existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(true);

      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'google_play.json',
      ]);

      const readFileMock = readFile as ReturnType<typeof vi.fn>;
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({
          store_id: 'google_play',
          auth_type: 'service_account',
          config: {},
        }),
      );
      readFileMock.mockResolvedValueOnce('service-account-content');

      const registry = await getRegistry();

      expect(registry).toBeDefined();
      expect(authInstances).toHaveLength(1);
      expect(authInstances[0].setCredentials).toHaveBeenCalledWith(
        'google_play',
        expect.objectContaining({ type: 'oauth2' }),
      );
    });

    it('should skip files without matching .credentials file', async () => {
      const existsSyncMock = existsSync as ReturnType<typeof vi.fn>;
      existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'google_play.json',
      ]);

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        JSON.stringify({
          store_id: 'google_play',
          auth_type: 'service_account',
          config: {},
        }),
      );

      const registry = await getRegistry();
      expect(registry).toBeDefined();

      expect(authInstances).toHaveLength(1);
      expect(authInstances[0].setCredentials).not.toHaveBeenCalled();
    });

    it('should skip corrupt json files gracefully', async () => {
      const existsSyncMock = existsSync as ReturnType<typeof vi.fn>;
      existsSyncMock.mockReturnValue(true);

      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'corrupt.json',
      ]);

      (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'not-valid-json{{{',
      );

      const registry = await getRegistry();
      expect(registry).toBeDefined();
    });

    it('should handle api_key auth type correctly', async () => {
      const existsSyncMock = existsSync as ReturnType<typeof vi.fn>;
      existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(true);

      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'test_store.json',
      ]);

      const readFileMock = readFile as ReturnType<typeof vi.fn>;
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({
          store_id: 'test_store',
          auth_type: 'api_key',
          config: {},
        }),
      );
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({ api_key: 'my-api-key' }),
      );

      const registry = await getRegistry();
      expect(registry).toBeDefined();

      expect(authInstances).toHaveLength(1);
      expect(authInstances[0].setCredentials).toHaveBeenCalledWith(
        'test_store',
        expect.objectContaining({
          type: 'apikey',
          config: expect.objectContaining({ apiKey: 'my-api-key' }),
        }),
      );
    });

    it('should handle oauth auth type with client credentials', async () => {
      const existsSyncMock = existsSync as ReturnType<typeof vi.fn>;
      existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(true);

      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'huawei.json',
      ]);

      const readFileMock = readFile as ReturnType<typeof vi.fn>;
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({
          store_id: 'huawei_agc',
          auth_type: 'oauth',
          config: { client_id: 'from-meta' },
        }),
      );
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({
          client_id: 'hw-id',
          client_secret: 'hw-secret',
          token_url: 'https://example.com/token',
        }),
      );

      const registry = await getRegistry();
      expect(registry).toBeDefined();

      expect(authInstances).toHaveLength(1);
      expect(authInstances[0].setCredentials).toHaveBeenCalledWith(
        'huawei_agc',
        expect.objectContaining({
          type: 'oauth2',
          config: expect.objectContaining({
            clientId: 'hw-id',
            clientSecret: 'hw-secret',
            tokenUrl: 'https://example.com/token',
          }),
        }),
      );
    });
  });
});
