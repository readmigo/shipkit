/**
 * app://{app_id}/status - Real-time app status across all connected stores
 *
 * When accessed, starts polling each store adapter for status changes
 * and sends MCP resource-updated notifications via server.sendResourceUpdated().
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRegistry } from '../registry.js';
import { pollingScheduler } from '../../polling/PollingScheduler.js';
import type { StatusResult } from '../../adapters/base/StoreAdapter.js';

/** In-memory cache of latest statuses keyed by "appId::storeId". */
const statusCache = new Map<string, StatusResult>();

export function registerAppStatusResource(server: McpServer): void {
  server.registerResource(
    'app-status',
    new ResourceTemplate('app://{app_id}/status', { list: undefined }),
    {
      title: 'App Status Overview',
      description:
        'Real-time status of an app across all connected stores. ' +
        'Subscribe to receive notifications when review status changes.',
      mimeType: 'application/json',
    },
    async (uri, { app_id }) => {
      const appId = app_id as string;
      const registry = await getRegistry();
      const storeIds = registry.getSupportedStores();

      // Start polling for each store (idempotent — skips if already running)
      for (const storeId of storeIds) {
        const taskId = `${appId}::${storeId}`;
        if (pollingScheduler.getActivePolls().includes(taskId)) continue;

        const adapter = registry.getAdapter(storeId);
        if (!adapter) continue;

        pollingScheduler.startPolling({
          taskId,
          appId,
          storeId,
          adapter,
          onStatusChange: (_taskId, _appId, _storeId, _old, newStatus) => {
            statusCache.set(`${_appId}::${_storeId}`, newStatus);
            try {
              void server.server.sendResourceUpdated({ uri: uri.href });
            } catch {
              // server may not support notifications yet
            }
          },
        });
      }

      // Build response from cache (or placeholders for stores not yet polled)
      const stores: Array<Record<string, unknown>> = [];
      for (const storeId of storeIds) {
        const cached = statusCache.get(`${appId}::${storeId}`);
        if (cached) {
          stores.push({
            store: storeId,
            latest_version: cached.currentVersion ?? 'unknown',
            review_status: cached.reviewStatus,
            live_status: cached.liveStatus,
            last_updated: cached.lastUpdated,
          });
        } else {
          stores.push({
            store: storeId,
            review_status: 'polling',
            live_status: 'unknown',
          });
        }
      }

      const statusData = {
        app_id: appId,
        stores,
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(statusData, null, 2),
          },
        ],
      };
    },
  );
}
