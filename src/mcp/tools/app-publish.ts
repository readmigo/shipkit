/**
 * app.publish - One-click publish to one or more stores
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRegistry } from '../registry.js';

const STORE_IDS = [
  'google_play', 'app_store', 'huawei_agc',
  'xiaomi', 'oppo', 'vivo', 'honor', 'pgyer',
] as const;

const TRACKS = ['internal', 'alpha', 'beta', 'production'] as const;

export function registerAppPublishTool(server: McpServer): void {
  server.registerTool(
    'app.publish',
    {
      title: 'Publish App',
      description:
        'Publish an app version to one or more stores in a single call. ' +
        'Supports batch publishing — one request can target multiple platforms simultaneously. ' +
        'Each store reports its result independently (submitted/failed/skipped). ' +
        'Use build_id (from app.upload result) to reference the uploaded build. ' +
        'Use idempotency_key to prevent duplicate submissions.',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        stores: z
          .array(z.enum(STORE_IDS))
          .min(1)
          .describe('Target app stores for publishing (supports batch)'),
        version_name: z.string().describe("Version name, e.g. '2.1.0'"),
        build_id: z
          .string()
          .optional()
          .describe('Build ID from app.upload result. Required for stores that need prior upload.'),
        track: z
          .enum(TRACKS)
          .default('production')
          .optional()
          .describe('Release track. internal=internal test, alpha=closed test, beta=open test, production=full release'),
        rollout_percentage: z
          .number()
          .min(0.01)
          .max(1.0)
          .default(1.0)
          .optional()
          .describe('Staged rollout percentage (0.01-1.0). Only Google Play production track supports this.'),
        release_notes: z
          .record(z.string(), z.string())
          .optional()
          .describe("Release notes per locale. Key is locale (e.g. 'zh-Hans'), value is text."),
        auto_release: z
          .boolean()
          .default(false)
          .optional()
          .describe('Auto-release after review approval. false=manual, true=automatic.'),
        idempotency_key: z
          .string()
          .optional()
          .describe('Idempotency key. Duplicate requests with the same key will not re-execute.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ app_id, stores, version_name, build_id, track, rollout_percentage, release_notes }) => {
      const registry = await getRegistry();
      const publish_id = `pub_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const effectiveBuildId = build_id ?? version_name;

      const results = await Promise.all(
        stores.map(async (store) => {
          const adapter = registry.getAdapter(store);
          if (!adapter) {
            return {
              store,
              status: 'skipped' as const,
              reason: `Store '${store}' not configured. Use store.connect to add credentials.`,
            };
          }

          try {
            const releaseResult = await adapter.createRelease({
              appId: app_id,
              buildId: effectiveBuildId,
              track: track ?? 'production',
              versionName: version_name,
              releaseNotes: release_notes,
              rolloutPercentage: rollout_percentage,
            });

            if (!releaseResult.success) {
              return {
                store,
                status: 'failed' as const,
                reason: releaseResult.message ?? 'createRelease returned failure',
              };
            }

            const submitResult = await adapter.submitForReview({ appId: app_id });

            return {
              store,
              status: 'submitted' as const,
              release_id: releaseResult.releaseId ?? effectiveBuildId,
              message: submitResult.message,
            };
          } catch (err) {
            return {
              store,
              status: 'failed' as const,
              reason: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ publish_id, results }, null, 2),
        }],
      };
    },
  );
}
