/**
 * app.status - Query review status across platforms
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRegistry } from '../registry.js';

const STORE_IDS = [
  'google_play', 'app_store', 'huawei_agc',
  'xiaomi', 'oppo', 'vivo', 'honor', 'pgyer',
] as const;

export function registerAppStatusTool(server: McpServer): void {
  server.registerTool(
    'app.status',
    {
      title: 'Query App Status',
      description:
        'Query the review status and release progress of an app across one or more stores. ' +
        'Returns version, track, release status, review status, and rollout percentage for each store. ' +
        'Leave stores empty to query all connected stores.',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        stores: z
          .array(z.enum(STORE_IDS))
          .optional()
          .describe('Target stores to query. Leave empty to query all connected stores.'),
        version_name: z
          .string()
          .optional()
          .describe('Specific version to query. Leave empty to query the latest version.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ app_id, stores, version_name }) => {
      const registry = await getRegistry();
      const connectedStores = registry.getSupportedStores();
      const targetStores = stores ?? connectedStores;

      if (targetStores.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              app_id,
              statuses: [],
              message: 'No stores connected. Use store.connect to configure credentials.',
            }, null, 2),
          }],
        };
      }

      const statuses = await Promise.all(
        targetStores.map(async (store) => {
          const adapter = registry.getAdapter(store);
          if (!adapter) {
            return {
              store,
              error: `Store '${store}' not configured. Use store.connect to add credentials.`,
            };
          }
          try {
            const result = await adapter.getStatus(app_id);
            return {
              store,
              version_name: result.currentVersion ?? version_name ?? 'unknown',
              review_status: result.reviewStatus,
              live_status: result.liveStatus,
              last_updated: result.lastUpdated,
            };
          } catch (err) {
            return {
              store,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ app_id, statuses }, null, 2),
        }],
      };
    },
  );
}
