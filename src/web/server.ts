/**
 * ShipKit Web Dashboard — Hono HTTP Server
 *
 * Wraps the existing adapter/registry/auth APIs into REST endpoints.
 * Serves static files from the public directory for the SPA frontend.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { AuthManager } from '../auth/AuthManager.js';
import { AdapterRegistry } from '../adapters/AdapterRegistry.js';
import { createStoresRouter } from './api/stores.js';
import { createBuildsRouter } from './api/builds.js';
import { createPublishRouter } from './api/publish.js';
import { createStatusRouter } from './api/status.js';
import { createJobsRouter } from './api/jobs.js';
import { createComplianceRouter } from './api/compliance.js';

export function createApp() {
  const app = new Hono();

  // Initialize shared services
  const authManager = new AuthManager();
  const registry = AdapterRegistry.createDefault(authManager);

  // CORS middleware — allow all origins for development
  app.use('*', cors());

  // API routes
  app.route('/api/stores', createStoresRouter(registry, authManager));
  app.route('/api/builds', createBuildsRouter(registry));
  app.route('/api/publish', createPublishRouter(registry));
  app.route('/api/status', createStatusRouter(registry));
  app.route('/api/jobs', createJobsRouter());
  app.route('/api/compliance', createComplianceRouter(registry));

  // Health check
  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  // Serve static files from public directory
  app.use('/*', serveStatic({ root: './src/web/public' }));

  // SPA fallback — serve index.html for unmatched routes
  app.get('*', serveStatic({ root: './src/web/public', path: 'index.html' }));

  return { app, authManager, registry };
}

export async function startWebServer(port?: number): Promise<void> {
  const resolvedPort = port ?? parseInt(process.env.SHIPKIT_WEB_PORT || '3456', 10);
  const { app } = createApp();

  serve({
    fetch: app.fetch,
    port: resolvedPort,
  });

  console.log(`ShipKit Web Dashboard running at http://localhost:${resolvedPort}`);
}

// Auto-start when executed directly
const isMain = process.argv[1]?.endsWith('web/server.js') || process.argv[1]?.endsWith('web/server.ts');
if (isMain) {
  startWebServer();
}
