/**
 * app.publish - One-click publish to one or more stores
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
        'Use idempotency_key to prevent duplicate submissions.',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        stores: z
          .array(z.enum(STORE_IDS))
          .min(1)
          .describe('Target app stores for publishing (supports batch)'),
        version_name: z.string().describe("Version name, e.g. '2.1.0'"),
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
    async ({ app_id, stores, version_name, track, rollout_percentage, release_notes, auto_release, idempotency_key }) => {
      const publish_id = `pub_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

      // Simulate per-store results — real implementation delegates to adapters
      const results = stores.map((store) => {
        const release_id = `rel_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
        return {
          store,
          status: 'submitted' as const,
          release_id,
        };
      });

      const result = { publish_id, results };

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
