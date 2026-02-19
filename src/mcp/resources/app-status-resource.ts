/**
 * app://{app_id}/status - Real-time app status across all connected stores
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
      // Mock data — real implementation will aggregate from adapters
      const appId = app_id as string;
      const statusData = {
        app_id: appId,
        name: appId,
        stores: [
          {
            store: 'google_play',
            latest_version: '1.0.0',
            release_status: 'draft',
            review_status: 'pending',
            track: 'production',
            rollout_percentage: 1.0,
          },
          {
            store: 'app_store',
            latest_version: '1.0.0',
            release_status: 'draft',
            review_status: 'pending',
          },
        ],
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
