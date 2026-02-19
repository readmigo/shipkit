/**
 * Status API routes
 *
 * GET /stream/:appId → SSE endpoint for real-time status changes
 * GET /:appId        → Query all connected adapters for app status
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import type { AdapterRegistry } from '../../adapters/AdapterRegistry.js';
import { PollingScheduler, type StatusChangeCallback } from '../../polling/PollingScheduler.js';

export function createStatusRouter(registry: AdapterRegistry) {
  const app = new Hono();
  const scheduler = new PollingScheduler();

  // GET /stream/:appId — SSE endpoint for status change events
  app.get('/stream/:appId', (c) => {
    const appId = c.req.param('appId');
    const storeIds = registry.getSupportedStores();

    return streamSSE(c, async (stream) => {
      const taskIds: string[] = [];

      const onStatusChange: StatusChangeCallback = async (taskId, evtAppId, storeId, oldStatus, newStatus) => {
        const adapter = registry.getAdapter(storeId);
        const storeName = adapter?.getCapabilities().storeName ?? storeId;
        await stream.writeSSE({
          event: 'status_change',
          data: JSON.stringify({
            storeId,
            storeName,
            reviewStatus: newStatus.reviewStatus,
            liveStatus: newStatus.liveStatus,
            lastUpdated: new Date().toISOString(),
          }),
          id: taskId,
        });
      };

      // Start polling for each store
      for (const storeId of storeIds) {
        const adapter = registry.getAdapter(storeId);
        if (!adapter) continue;

        const taskId = `sse_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
        taskIds.push(taskId);

        scheduler.startPolling({
          taskId,
          appId,
          storeId,
          adapter,
          onStatusChange,
          intervalMs: 30_000, // 30s for SSE
        });
      }

      // Send initial connected event
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({
          app_id: appId,
          polling_stores: storeIds,
          message: 'SSE stream connected. Listening for status changes.',
        }),
      });

      // Keep stream alive until client disconnects
      try {
        while (true) {
          await stream.sleep(15_000);
          await stream.writeSSE({ event: 'heartbeat', data: new Date().toISOString() });
        }
      } finally {
        // Clean up polling on disconnect
        for (const taskId of taskIds) {
          scheduler.stopPolling(taskId);
        }
      }
    });
  });

  // GET /:appId — Query all connected adapters for current status
  app.get('/:appId', async (c) => {
    const appId = c.req.param('appId');
    const storeIds = registry.getSupportedStores();

    const statuses: Array<{
      storeId: string;
      storeName: string;
      reviewStatus?: string;
      liveStatus?: string;
      version?: string;
      lastUpdated?: string;
      error?: string;
    }> = [];

    for (const storeId of storeIds) {
      const adapter = registry.getAdapter(storeId);
      if (!adapter) continue;

      const caps = adapter.getCapabilities();
      try {
        const result = await adapter.getStatus(appId);
        statuses.push({
          storeId,
          storeName: caps.storeName,
          reviewStatus: result.reviewStatus,
          liveStatus: result.liveStatus,
          version: result.currentVersion,
          lastUpdated: result.lastUpdated,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        statuses.push({
          storeId,
          storeName: caps.storeName,
          error: message,
        });
      }
    }

    return c.json({ app_id: appId, statuses });
  });

  return app;
}
