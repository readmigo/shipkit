/**
 * Store management API routes
 *
 * GET  /           → List all stores with connection status
 * POST /:id/connect → Connect a store with credentials
 */

import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AdapterRegistry } from '../../adapters/AdapterRegistry.js';
import type { AuthManager } from '../../auth/AuthManager.js';

const CREDENTIALS_DIR = join(homedir(), '.shipkit', 'credentials');

export function createStoresRouter(registry: AdapterRegistry, authManager: AuthManager) {
  const app = new Hono();

  // GET / — List all stores with connection status
  app.get('/', (c) => {
    const capabilities = registry.getAllCapabilities();

    const stores = capabilities.map((cap) => {
      const metaPath = join(CREDENTIALS_DIR, `${cap.storeId}.json`);
      const credPath = join(CREDENTIALS_DIR, `${cap.storeId}.credentials`);
      const connected = existsSync(metaPath) && existsSync(credPath);

      return {
        storeId: cap.storeId,
        storeName: cap.storeName,
        connected,
        authMethod: cap.authMethod,
        supportedFileTypes: cap.supportedFileTypes,
        capabilities: {
          upload: cap.supportsUpload,
          listing: cap.supportsListing,
          review: cap.supportsReview,
          analytics: cap.supportsAnalytics,
          rollback: cap.supportsRollback,
          stagedRollout: cap.supportsStagedRollout,
        },
        requiresIcp: cap.requiresIcp,
        maxFileSizeMB: cap.maxFileSizeMB,
      };
    });

    return c.json({ stores });
  });

  // POST /:id/connect — Connect a store with credentials
  app.post('/:id/connect', async (c) => {
    const storeId = c.req.param('id');

    const adapter = registry.getAdapter(storeId);
    if (!adapter) {
      return c.json({ error: `Unknown store: ${storeId}` }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    try {
      // Ensure credentials directory exists
      await mkdir(CREDENTIALS_DIR, { recursive: true });

      // Write credential files
      const metaPath = join(CREDENTIALS_DIR, `${storeId}.json`);
      const credPath = join(CREDENTIALS_DIR, `${storeId}.credentials`);

      const meta = {
        store_id: storeId,
        auth_type: body.auth_type ?? 'api_key',
        config: body.config ?? {},
      };
      await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

      const credentials = body.credentials ?? body;
      await writeFile(credPath, JSON.stringify(credentials, null, 2), 'utf-8');

      // Load credentials into auth manager and authenticate
      await authManager.loadCredentials(storeId, metaPath);
      await adapter.authenticate();

      return c.json({ success: true, store_id: storeId, message: `Connected to ${storeId}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to connect: ${message}` }, 500);
    }
  });

  return app;
}
