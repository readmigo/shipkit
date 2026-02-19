/**
 * AdapterRegistry — Central registry for all store adapters
 *
 * Provides adapter lookup by storeId and capability querying.
 */

import type { StoreAdapter, StoreCapabilities } from './base/StoreAdapter.js';
import { GooglePlayAdapter } from './google-play/GooglePlayAdapter.js';
import { AppleAscAdapter } from './apple-asc/AppleAscAdapter.js';
import { HuaweiAgcAdapter } from './huawei-agc/HuaweiAgcAdapter.js';
import { PgyerAdapter } from './pgyer/PgyerAdapter.js';
import { OppoAdapter } from './oppo/OppoAdapter.js';
import { HonorAdapter } from './honor/HonorAdapter.js';
import { XiaomiAdapter } from './xiaomi/XiaomiAdapter.js';
import { VivoAdapter } from './vivo/VivoAdapter.js';
import { AuthManager } from '../auth/AuthManager.js';

export type StoreId = 'google_play' | 'app_store' | 'huawei_agc' | 'pgyer' | 'oppo' | 'honor' | 'xiaomi' | 'vivo';

export class AdapterRegistry {
  private adapters = new Map<string, StoreAdapter>();

  /**
   * Initialize registry with default adapters using a shared AuthManager
   */
  static createDefault(authManager: AuthManager): AdapterRegistry {
    const registry = new AdapterRegistry();
    registry.register('google_play', new GooglePlayAdapter(authManager));
    registry.register('app_store', new AppleAscAdapter(authManager));
    registry.register('huawei_agc', new HuaweiAgcAdapter(authManager));
    registry.register('pgyer', new PgyerAdapter(authManager));
    registry.register('oppo', new OppoAdapter(authManager));
    registry.register('honor', new HonorAdapter(authManager));
    registry.register('xiaomi', new XiaomiAdapter(authManager));
    registry.register('vivo', new VivoAdapter(authManager));
    return registry;
  }

  /**
   * Register an adapter for a store
   */
  register(storeId: string, adapter: StoreAdapter): void {
    this.adapters.set(storeId, adapter);
  }

  /**
   * Get adapter by storeId, or null if not registered
   */
  getAdapter(storeId: string): StoreAdapter | null {
    return this.adapters.get(storeId) ?? null;
  }

  /**
   * List all registered store IDs
   */
  getSupportedStores(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get capabilities for a specific store
   */
  getCapabilities(storeId: string): StoreCapabilities | null {
    const adapter = this.adapters.get(storeId);
    return adapter ? adapter.getCapabilities() : null;
  }

  /**
   * Get capabilities for all registered stores
   */
  getAllCapabilities(): StoreCapabilities[] {
    return Array.from(this.adapters.values()).map(a => a.getCapabilities());
  }
}
