import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from './AdapterRegistry.js';
import { AuthManager } from '../auth/AuthManager.js';

// Mock the adapter constructors to avoid real HTTP clients
vi.mock('./google-play/GooglePlayAdapter.js', () => ({
  GooglePlayAdapter: class {
    getCapabilities() {
      return { storeId: 'google_play', storeName: 'Google Play' };
    }
  },
}));

vi.mock('./apple-asc/AppleAscAdapter.js', () => ({
  AppleAscAdapter: class {
    getCapabilities() {
      return { storeId: 'app_store', storeName: 'Apple App Store' };
    }
  },
}));

vi.mock('./huawei-agc/HuaweiAgcAdapter.js', () => ({
  HuaweiAgcAdapter: class {
    getCapabilities() {
      return { storeId: 'huawei_agc', storeName: 'Huawei AppGallery' };
    }
  },
}));

vi.mock('./pgyer/PgyerAdapter.js', () => ({
  PgyerAdapter: class {
    getCapabilities() {
      return { storeId: 'pgyer', storeName: 'Pgyer' };
    }
  },
}));

vi.mock('./oppo/OppoAdapter.js', () => ({
  OppoAdapter: class {
    getCapabilities() {
      return { storeId: 'oppo', storeName: 'OPPO App Market' };
    }
  },
}));

vi.mock('./honor/HonorAdapter.js', () => ({
  HonorAdapter: class {
    getCapabilities() {
      return { storeId: 'honor', storeName: 'Honor App Gallery' };
    }
  },
}));

vi.mock('./xiaomi/XiaomiAdapter.js', () => ({
  XiaomiAdapter: class {
    getCapabilities() {
      return { storeId: 'xiaomi', storeName: 'Xiaomi GetApps' };
    }
  },
}));

vi.mock('./vivo/VivoAdapter.js', () => ({
  VivoAdapter: class {
    getCapabilities() {
      return { storeId: 'vivo', storeName: 'vivo App Store' };
    }
  },
}));

vi.mock('./tencent/TencentAdapter.js', () => ({
  TencentAdapter: class {
    getCapabilities() {
      return { storeId: 'tencent_myapp', storeName: 'Tencent MyApp (应用宝)' };
    }
  },
}));

describe('AdapterRegistry', () => {
  describe('createDefault', () => {
    it('should register google_play, app_store, and huawei_agc adapters', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const stores = registry.getSupportedStores();
      expect(stores).toContain('google_play');
      expect(stores).toContain('app_store');
      expect(stores).toContain('huawei_agc');
      expect(stores).toHaveLength(9);
    });
  });

  describe('getAdapter', () => {
    it('should return the correct adapter for a registered store', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const adapter = registry.getAdapter('google_play');
      expect(adapter).not.toBeNull();
      expect(adapter!.getCapabilities().storeId).toBe('google_play');
    });

    it('should return null for an unknown store', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const adapter = registry.getAdapter('unknown_store');
      expect(adapter).toBeNull();
    });

    it('should return different adapters for different store IDs', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const gpAdapter = registry.getAdapter('google_play');
      const ascAdapter = registry.getAdapter('app_store');
      const hwAdapter = registry.getAdapter('huawei_agc');

      expect(gpAdapter).not.toBe(ascAdapter);
      expect(ascAdapter).not.toBe(hwAdapter);
    });
  });

  describe('getSupportedStores', () => {
    it('should return all registered store IDs', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const stores = registry.getSupportedStores();
      expect(stores).toContain('google_play');
      expect(stores).toContain('app_store');
      expect(stores).toContain('huawei_agc');
      expect(stores).toContain('pgyer');
      expect(stores).toContain('oppo');
      expect(stores).toContain('honor');
      expect(stores).toContain('xiaomi');
      expect(stores).toContain('vivo');
      expect(stores).toContain('tencent_myapp');
      expect(stores).toHaveLength(9);
    });

    it('should return empty array for empty registry', () => {
      const registry = new AdapterRegistry();
      expect(registry.getSupportedStores()).toEqual([]);
    });
  });

  describe('register', () => {
    it('should allow registering a custom adapter', () => {
      const registry = new AdapterRegistry();
      const mockAdapter = {
        getCapabilities: vi.fn().mockReturnValue({
          storeId: 'custom_store',
          storeName: 'Custom Store',
        }),
      } as any;

      registry.register('custom_store', mockAdapter);
      expect(registry.getAdapter('custom_store')).toBe(mockAdapter);
      expect(registry.getSupportedStores()).toContain('custom_store');
    });

    it('should overwrite existing adapter on re-register', () => {
      const registry = new AdapterRegistry();
      const adapter1 = { getCapabilities: vi.fn() } as any;
      const adapter2 = { getCapabilities: vi.fn() } as any;

      registry.register('store', adapter1);
      registry.register('store', adapter2);

      expect(registry.getAdapter('store')).toBe(adapter2);
    });
  });

  describe('getCapabilities', () => {
    it('should return capabilities for a registered store', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const caps = registry.getCapabilities('google_play');
      expect(caps).toBeDefined();
      expect(caps!.storeId).toBe('google_play');
    });

    it('should return null for an unknown store', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const caps = registry.getCapabilities('nonexistent');
      expect(caps).toBeNull();
    });
  });

  describe('getAllCapabilities', () => {
    it('should return capabilities for all registered stores', () => {
      const authManager = new AuthManager();
      const registry = AdapterRegistry.createDefault(authManager);

      const allCaps = registry.getAllCapabilities();
      expect(allCaps).toHaveLength(9);
    });

    it('should return empty array for empty registry', () => {
      const registry = new AdapterRegistry();
      expect(registry.getAllCapabilities()).toEqual([]);
    });
  });
});
