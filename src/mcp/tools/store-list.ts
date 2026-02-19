/**
 * store.list - List all supported stores and their connection status
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../../types/index.js';

const KNOWN_STORES: Store[] = [
  {
    store_id: 'google_play',
    name: 'Google Play',
    platform: 'android',
    region: 'global',
    status: 'not_configured',
    supported_file_types: ['aab', 'apk'],
    features: ['staged_rollout', 'multiple_tracks', 'review_required', 'listing_api'],
  },
  {
    store_id: 'app_store',
    name: 'Apple App Store',
    platform: 'ios',
    region: 'global',
    status: 'not_configured',
    supported_file_types: ['ipa'],
    features: ['staged_rollout', 'review_required', 'listing_api', 'testflight'],
  },
  {
    store_id: 'huawei_agc',
    name: 'Huawei AppGallery',
    platform: 'android',
    region: 'all',
    status: 'not_configured',
    supported_file_types: ['apk', 'aab'],
    features: ['staged_rollout', 'multiple_tracks', 'review_required', 'listing_api'],
  },
  {
    store_id: 'xiaomi',
    name: 'Xiaomi GetApps',
    platform: 'android',
    region: 'china',
    status: 'not_configured',
    supported_file_types: ['apk'],
    features: ['review_required', 'icp_required'],
  },
  {
    store_id: 'oppo',
    name: 'OPPO App Market',
    platform: 'android',
    region: 'china',
    status: 'not_configured',
    supported_file_types: ['apk'],
    features: ['review_required', 'icp_required'],
  },
  {
    store_id: 'vivo',
    name: 'vivo App Store',
    platform: 'android',
    region: 'china',
    status: 'not_configured',
    supported_file_types: ['apk'],
    features: ['review_required', 'icp_required'],
  },
  {
    store_id: 'honor',
    name: 'Honor App Market',
    platform: 'android',
    region: 'china',
    status: 'not_configured',
    supported_file_types: ['apk'],
    features: ['review_required', 'icp_required'],
  },
  {
    store_id: 'pgyer',
    name: 'Pgyer (蒲公英)',
    platform: 'android',
    region: 'china',
    status: 'not_configured',
    supported_file_types: ['apk', 'ipa'],
    features: ['no_review'],
  },
];

export function registerStoreListTool(server: McpServer): void {
  server.registerTool(
    'store.list',
    {
      title: 'List Supported Stores',
      description:
        'List all supported app stores and their current connection status. ' +
        'This is the recommended entry point for discovering available publishing targets. ' +
        'Optionally filter by platform (ios, android, harmonyos).',
      inputSchema: {
        platform: z
          .enum(['ios', 'android', 'harmonyos'])
          .optional()
          .describe('Filter by platform. Leave empty to return stores for all platforms.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ platform }) => {
      const filtered = platform
        ? KNOWN_STORES.filter((s) => s.platform === platform)
        : KNOWN_STORES;

      const stores = filtered.map((s) => ({
        store_id: s.store_id,
        name: s.name,
        platform: s.platform,
        region: s.region,
        auth_status: s.status,
        supported_file_types: s.supported_file_types,
        features: s.features,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ stores }, null, 2),
          },
        ],
      };
    },
  );
}
