import { describe, it, expect, vi } from 'vitest';
import { createApp } from './server.js';

// Mock adapters to avoid real HTTP clients
vi.mock('../adapters/google-play/GooglePlayAdapter.js', () => ({
  GooglePlayAdapter: class {
    getCapabilities() {
      return {
        storeId: 'google_play',
        storeName: 'Google Play',
        authMethod: 'service_account',
        supportedFileTypes: ['apk', 'aab'],
        supportsUpload: true,
        supportsListing: true,
        supportsReview: true,
        supportsAnalytics: false,
        supportsRollback: true,
        supportsStagedRollout: true,
        requiresIcp: false,
        maxFileSizeMB: 150,
      };
    }
    authenticate() { return Promise.resolve(); }
    getStatus() { return Promise.resolve({ reviewStatus: 'approved', liveStatus: 'live', currentVersion: '1.0.0' }); }
  },
}));

vi.mock('../adapters/apple-asc/AppleAscAdapter.js', () => ({
  AppleAscAdapter: class {
    getCapabilities() {
      return { storeId: 'app_store', storeName: 'Apple App Store', authMethod: 'jwt', supportedFileTypes: ['ipa'], supportsUpload: true, supportsListing: true, supportsReview: true, supportsAnalytics: false, supportsRollback: false, supportsStagedRollout: true, requiresIcp: false, maxFileSizeMB: 4000 };
    }
  },
}));

vi.mock('../adapters/huawei-agc/HuaweiAgcAdapter.js', () => ({
  HuaweiAgcAdapter: class {
    getCapabilities() {
      return { storeId: 'huawei_agc', storeName: 'Huawei AppGallery', authMethod: 'oauth2', supportedFileTypes: ['apk', 'aab'], supportsUpload: true, supportsListing: true, supportsReview: true, supportsAnalytics: false, supportsRollback: false, supportsStagedRollout: false, requiresIcp: true, maxFileSizeMB: 4096 };
    }
  },
}));

vi.mock('../adapters/pgyer/PgyerAdapter.js', () => ({
  PgyerAdapter: class {
    getCapabilities() {
      return { storeId: 'pgyer', storeName: 'Pgyer', authMethod: 'api_key', supportedFileTypes: ['apk', 'ipa'], supportsUpload: true, supportsListing: false, supportsReview: false, supportsAnalytics: false, supportsRollback: false, supportsStagedRollout: false, requiresIcp: false, maxFileSizeMB: 500 };
    }
  },
}));

vi.mock('../adapters/oppo/OppoAdapter.js', () => ({
  OppoAdapter: class {
    getCapabilities() {
      return { storeId: 'oppo', storeName: 'OPPO App Market', authMethod: 'oauth2', supportedFileTypes: ['apk'], supportsUpload: true, supportsListing: true, supportsReview: true, supportsAnalytics: false, supportsRollback: false, supportsStagedRollout: false, requiresIcp: true, maxFileSizeMB: 500 };
    }
  },
}));

vi.mock('../adapters/honor/HonorAdapter.js', () => ({
  HonorAdapter: class {
    getCapabilities() {
      return { storeId: 'honor', storeName: 'Honor App Gallery', authMethod: 'oauth2', supportedFileTypes: ['apk'], supportsUpload: true, supportsListing: true, supportsReview: true, supportsAnalytics: false, supportsRollback: false, supportsStagedRollout: false, requiresIcp: true, maxFileSizeMB: 500 };
    }
  },
}));

vi.mock('../adapters/xiaomi/XiaomiAdapter.js', () => ({
  XiaomiAdapter: class {
    getCapabilities() {
      return { storeId: 'xiaomi', storeName: 'Xiaomi GetApps', authMethod: 'rsa', supportedFileTypes: ['apk'], supportsUpload: true, supportsListing: false, supportsReview: true, supportsAnalytics: false, supportsRollback: false, supportsStagedRollout: false, requiresIcp: true, maxFileSizeMB: 500 };
    }
  },
}));

vi.mock('../adapters/vivo/VivoAdapter.js', () => ({
  VivoAdapter: class {
    getCapabilities() {
      return { storeId: 'vivo', storeName: 'vivo App Store', authMethod: 'hmac', supportedFileTypes: ['apk'], supportsUpload: true, supportsListing: false, supportsReview: true, supportsAnalytics: false, supportsRollback: false, supportsStagedRollout: false, requiresIcp: true, maxFileSizeMB: 500 };
    }
  },
}));

describe('Web Dashboard Server', () => {
  const { app } = createApp();

  describe('GET /api/health', () => {
    it('should return status ok', async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBe('0.1.0');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/stores', () => {
    it('should return all 8 stores', async () => {
      const res = await app.request('/api/stores');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stores).toHaveLength(8);
    });

    it('should include store properties', async () => {
      const res = await app.request('/api/stores');
      const body = await res.json();
      const gp = body.stores.find((s: any) => s.storeId === 'google_play');
      expect(gp).toBeDefined();
      expect(gp.storeName).toBe('Google Play');
      expect(gp.authMethod).toBe('service_account');
      expect(typeof gp.connected).toBe('boolean');
      expect(gp.capabilities).toBeDefined();
    });
  });

  describe('POST /api/stores/:id/connect', () => {
    it('should reject unknown store', async () => {
      const res = await app.request('/api/stores/unknown/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: { key: 'value' } }),
      });
      expect(res.status).toBe(404);
    });

    it('should reject invalid JSON', async () => {
      const res = await app.request('/api/stores/google_play/connect', {
        method: 'POST',
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/builds', () => {
    it('should return builds array', async () => {
      const res = await app.request('/api/builds');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.builds).toBeDefined();
      expect(Array.isArray(body.builds)).toBe(true);
    });
  });

  describe('POST /api/publish', () => {
    it('should reject missing fields', async () => {
      const res = await app.request('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: 'com.test' }),
      });
      expect(res.status).toBe(400);
    });

    it('should reject invalid JSON', async () => {
      const res = await app.request('/api/publish', {
        method: 'POST',
        body: 'bad',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/jobs', () => {
    it('should return jobs array', async () => {
      const res = await app.request('/api/jobs');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs).toBeDefined();
      expect(Array.isArray(body.jobs)).toBe(true);
    });
  });

  describe('GET /api/jobs/:id', () => {
    it('should return 404 for unknown job', async () => {
      const res = await app.request('/api/jobs/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/jobs/:id/retry', () => {
    it('should return 404 for unknown job', async () => {
      const res = await app.request('/api/jobs/nonexistent/retry', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/compliance/check', () => {
    it('should reject missing fields', async () => {
      const res = await app.request('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: 'com.test' }),
      });
      expect(res.status).toBe(400);
    });

    it('should run checks and return results', async () => {
      const res = await app.request('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: 'com.test',
          store_ids: ['google_play'],
          metadata: {
            title: 'My App',
            privacy_policy_url: 'https://example.com/privacy',
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.app_id).toBe('com.test');
      expect(body.overall_status).toBeDefined();
      expect(body.checks).toBeDefined();
      expect(body.checks.length).toBeGreaterThan(0);
    });

    it('should detect missing privacy policy', async () => {
      const res = await app.request('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: 'com.test',
          store_ids: ['google_play'],
        }),
      });
      const body = await res.json();
      const privacyCheck = body.checks.find((c: any) => c.category === 'privacy_policy');
      expect(privacyCheck).toBeDefined();
      expect(privacyCheck.status).toBe('fail');
    });

    it('should warn about ICP for Chinese stores', async () => {
      const res = await app.request('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: 'com.test',
          store_ids: ['huawei_agc'],
          metadata: { privacy_policy_url: 'https://example.com/privacy' },
        }),
      });
      const body = await res.json();
      const icpCheck = body.checks.find((c: any) => c.category === 'icp_filing');
      expect(icpCheck).toBeDefined();
      expect(icpCheck.status).toBe('warning');
    });
  });
});
