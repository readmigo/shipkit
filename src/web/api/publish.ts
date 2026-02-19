/**
 * Publishing API routes
 *
 * POST / → Submit app for review across multiple stores
 */

import { Hono } from 'hono';
import type { AdapterRegistry } from '../../adapters/AdapterRegistry.js';

interface PublishRequest {
  app_id: string;
  build_id: string;
  store_ids: string[];
  version_name?: string;
  release_notes?: string;
}

export function createPublishRouter(registry: AdapterRegistry) {
  const app = new Hono();

  // POST / — Submit for review across specified stores
  app.post('/', async (c) => {
    let body: PublishRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { app_id, build_id, store_ids, version_name, release_notes } = body;

    if (!app_id || !build_id || !store_ids || !Array.isArray(store_ids) || store_ids.length === 0) {
      return c.json({ error: 'Missing required fields: app_id, build_id, store_ids (non-empty array)' }, 400);
    }

    const results: Array<{
      store_id: string;
      success: boolean;
      submission_id?: string;
      message?: string;
      error?: string;
    }> = [];

    for (const storeId of store_ids) {
      const adapter = registry.getAdapter(storeId);
      if (!adapter) {
        results.push({
          store_id: storeId,
          success: false,
          error: `Unknown store: ${storeId}`,
        });
        continue;
      }

      try {
        const submitResult = await adapter.submitForReview({
          appId: app_id,
          releaseType: 'production',
        });

        results.push({
          store_id: storeId,
          success: submitResult.success,
          submission_id: submitResult.submissionId,
          message: submitResult.message,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          store_id: storeId,
          success: false,
          error: message,
        });
      }
    }

    const allSuccess = results.every((r) => r.success);
    return c.json({
      success: allSuccess,
      app_id,
      build_id,
      version_name,
      release_notes,
      results,
    });
  });

  return app;
}
