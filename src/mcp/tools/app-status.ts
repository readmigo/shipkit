/**
 * app.status - Query review status across platforms
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
      // Return mock status data — real implementation will query adapters
      const targetStores = stores ?? ['google_play', 'app_store'];
      const resolvedVersion = version_name ?? '1.0.0';

      const statuses = targetStores.map((store) => ({
        store,
        version_name: resolvedVersion,
        version_code: 1,
        track: 'production' as const,
        release_status: 'draft' as const,
        review_status: 'pending' as const,
      }));

      const result = { app_id, statuses };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
