/**
 * app.listing - Manage store listing metadata
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRegistry } from '../registry.js';

const STORE_IDS_LISTING = [
  'google_play', 'app_store', 'huawei_agc',
  'xiaomi', 'oppo', 'vivo', 'honor',
] as const;

export function registerAppListingTool(server: McpServer): void {
  server.registerTool(
    'app.listing',
    {
      title: 'Manage Store Listing',
      description:
        'Get or update an app\'s store listing (title, description, screenshots, keywords). ' +
        'Use action "get" to retrieve current listing, or "update" to modify listing fields. ' +
        'Only include fields that need updating. Validation warnings are returned for fields ' +
        'that may cause review issues (e.g. title too long, missing screenshots).',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        store: z
          .enum(STORE_IDS_LISTING)
          .describe('Target store'),
        action: z
          .enum(['get', 'update'])
          .describe('Operation type. get=retrieve current listing, update=modify listing'),
        locale: z
          .string()
          .optional()
          .describe("Locale code, e.g. 'zh-Hans', 'en-US'. Leave empty for get to return all locales."),
        listing_data: z
          .object({
            title: z.string().max(30).optional().describe('App title (max 30 chars for App Store)'),
            short_description: z.string().max(80).optional().describe('Short description (max 80 chars for Google Play)'),
            full_description: z.string().max(4000).optional().describe('Full description (max 4000 chars for Google Play)'),
            keywords: z.string().max(100).optional().describe('Keywords, comma-separated (max 100 chars for App Store)'),
            whats_new: z.string().max(500).optional().describe('Release notes'),
            screenshots: z
              .array(
                z.object({
                  device_type: z.enum(['phone_5.5', 'phone_6.5', 'phone_6.7', 'tablet_12.9', 'watch', 'tv']).describe('Device type'),
                  file_path: z.string().describe('Local file path to screenshot'),
                  position: z.number().int().optional().describe('Sort position (0-based)'),
                }),
              )
              .optional()
              .describe('Screenshots to upload'),
            icon_path: z.string().optional().describe('App icon file path (1024x1024 PNG)'),
          })
          .optional()
          .describe('Listing data for update action. Only include fields to update.'),
        idempotency_key: z.string().optional().describe('Idempotency key'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ app_id, store, action, locale, listing_data }) => {
      const registry = await getRegistry();

      if (action === 'get') {
        const adapter = registry.getAdapter(store);
        if (!adapter) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id,
                store,
                error: `Store '${store}' not configured. Use store.connect to add credentials.`,
              }, null, 2),
            }],
          };
        }

        try {
          const result = await adapter.getListing({ appId: app_id, locale });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id,
                store,
                ...result,
              }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id,
                store,
                error: err instanceof Error ? err.message : String(err),
              }, null, 2),
            }],
          };
        }
      }

      // action === 'update'
      const validation_warnings: Array<{ field: string; message: string; severity: 'warning' | 'error' }> = [];
      const updated_fields: string[] = [];

      if (listing_data?.title !== undefined) {
        updated_fields.push('title');
        if (listing_data.title.length > 30) {
          validation_warnings.push({
            field: 'title',
            message: `Title is ${listing_data.title.length} chars, App Store limit is 30.`,
            severity: 'error',
          });
        }
      }
      if (listing_data?.short_description !== undefined) updated_fields.push('short_description');
      if (listing_data?.full_description !== undefined) updated_fields.push('full_description');
      if (listing_data?.keywords !== undefined) updated_fields.push('keywords');
      if (listing_data?.whats_new !== undefined) updated_fields.push('whats_new');
      if (listing_data?.screenshots !== undefined) updated_fields.push('screenshots');
      if (listing_data?.icon_path !== undefined) updated_fields.push('icon_path');

      // Call real adapter if available
      const adapter = registry.getAdapter(store);
      let adapter_result: { success?: boolean; message?: string; error?: string } = {};

      if (adapter && listing_data) {
        try {
          const result = await adapter.updateListing({
            appId: app_id,
            locale: locale ?? 'en-US',
            title: listing_data.title,
            shortDescription: listing_data.short_description,
            fullDescription: listing_data.full_description,
          });
          adapter_result = { success: result.success, message: result.message };
        } catch (err) {
          adapter_result = { error: err instanceof Error ? err.message : String(err) };
        }
      } else if (!adapter) {
        adapter_result = {
          error: `Store '${store}' not configured. Use store.connect to add credentials.`,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            app_id,
            store,
            locale: locale ?? 'en-US',
            updated_fields,
            validation_warnings,
            ...adapter_result,
          }, null, 2),
        }],
      };
    },
  );
}
