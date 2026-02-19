/**
 * Build management API routes
 *
 * GET  /       → List builds with optional filters
 * POST /upload → Upload a build artifact
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AdapterRegistry } from '../../adapters/AdapterRegistry.js';
import { BuildRegistry, type BuildRecord, type BuildListFilters } from '../../registry/BuildRegistry.js';

export function createBuildsRouter(registry: AdapterRegistry) {
  const app = new Hono();
  const buildRegistry = new BuildRegistry();

  // GET / — List builds with optional query filters
  app.get('/', (c) => {
    const filters: BuildListFilters = {};

    const appId = c.req.query('app_id');
    const storeId = c.req.query('store_id');
    const status = c.req.query('status');

    if (appId) filters.app_id = appId;
    if (storeId) filters.store_id = storeId;
    if (status && (status === 'uploaded' || status === 'published' || status === 'failed')) {
      filters.status = status;
    }

    const builds = buildRegistry.list(filters);
    return c.json({ builds });
  });

  // POST /upload — Upload a build artifact via multipart form data
  app.post('/upload', async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: 'Invalid multipart form data' }, 400);
    }

    const file = formData.get('file') as File | null;
    const appId = formData.get('app_id') as string | null;
    const storeId = formData.get('store_id') as string | null;
    const fileType = formData.get('file_type') as string | null;

    if (!file || !appId || !storeId || !fileType) {
      return c.json({ error: 'Missing required fields: file, app_id, store_id, file_type' }, 400);
    }

    const adapter = registry.getAdapter(storeId);
    if (!adapter) {
      return c.json({ error: `Unknown store: ${storeId}` }, 404);
    }

    try {
      // Write uploaded file to temp directory
      const tempDir = join(tmpdir(), 'shipkit-uploads');
      await mkdir(tempDir, { recursive: true });

      const fileName = `${randomUUID()}.${fileType}`;
      const tempPath = join(tempDir, fileName);

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(tempPath, buffer);

      // Compute SHA256 hash
      const sha256 = createHash('sha256').update(buffer).digest('hex');

      // Upload to store adapter
      const uploadResult = await adapter.uploadBuild({
        appId,
        filePath: tempPath,
        fileType,
      });

      // Save build record
      const artifactId = `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const record: BuildRecord = {
        artifact_id: artifactId,
        build_id: uploadResult.buildId ?? artifactId,
        store_id: storeId,
        app_id: appId,
        file_path: tempPath,
        sha256,
        timestamp: new Date().toISOString(),
        status: uploadResult.success ? 'uploaded' : 'failed',
      };

      buildRegistry.save(record);

      return c.json({
        success: uploadResult.success,
        artifact_id: artifactId,
        build_id: record.build_id,
        store_ref: uploadResult.storeRef,
        message: uploadResult.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Upload failed: ${message}` }, 500);
    }
  });

  return app;
}
