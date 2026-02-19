/**
 * app.release - Manage release tracks (promote, rollout, halt, resume)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ShipKitError, formatMcpError } from '../errors.js';
import { getRegistry } from '../registry.js';

const TRACK_STORES = ['google_play', 'app_store', 'huawei_agc'] as const;
const TRACKS = ['internal', 'alpha', 'beta', 'production'] as const;
const ACTIONS = ['list_tracks', 'promote', 'set_rollout', 'halt', 'resume'] as const;

export function registerAppReleaseTool(server: McpServer): void {
  server.registerTool(
    'app.release',
    {
      title: 'Manage Release Tracks',
      description:
        'Manage app release tracks: list tracks, promote versions between tracks, ' +
        'set staged rollout percentage, halt or resume a release. ' +
        'Only Google Play and Huawei AGC support multiple tracks. ' +
        'App Store supports TestFlight + Production only.',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        store: z
          .enum(TRACK_STORES)
          .describe('Target store (only Google Play, App Store, Huawei AGC support track management)'),
        action: z
          .enum(ACTIONS)
          .describe(
            'Operation type. list_tracks=list all tracks, promote=promote to target track, ' +
            'set_rollout=set rollout %, halt=pause release, resume=resume release',
          ),
        release_id: z
          .string()
          .optional()
          .describe('Target release ID (required for promote/halt/resume)'),
        target_track: z
          .enum(TRACKS)
          .optional()
          .describe('Target track (required for promote)'),
        rollout_percentage: z
          .number()
          .min(0.01)
          .max(1.0)
          .optional()
          .describe('Rollout percentage 0.01-1.0 (required for set_rollout)'),
        idempotency_key: z.string().optional().describe('Idempotency key'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ app_id, store, action, release_id, target_track, rollout_percentage }) => {
      const registry = await getRegistry();
      const adapter = registry.getAdapter(store);

      if (action === 'list_tracks') {
        if (adapter) {
          try {
            const status = await adapter.getStatus(app_id);
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  app_id,
                  store,
                  current_version: status.currentVersion,
                  review_status: status.reviewStatus,
                  live_status: status.liveStatus,
                  note: 'Detailed track list requires store-specific console access.',
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

      if (action === 'promote') {
        if (!release_id) {
          return formatMcpError(new ShipKitError({
            code: 'ARTIFACT_NOT_FOUND',
            message: 'release_id is required for promote action.',
            suggestion: 'Provide the release_id of the version to promote.',
            severity: 'blocking',
          }));
        }
        if (!target_track) {
          return formatMcpError(new ShipKitError({
            code: 'TRACK_NOT_AVAILABLE',
            message: 'target_track is required for promote action.',
            suggestion: 'Specify the target track (internal, alpha, beta, or production).',
            severity: 'blocking',
          }));
        }
        if (!adapter) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                error: `Store '${store}' not configured. Use store.connect to add credentials.`,
              }, null, 2),
            }],
          };
        }
        try {
          const result = await adapter.promoteRelease({
            appId: app_id,
            releaseId: release_id,
            sourceTrack: 'beta',
            targetTrack: target_track,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                action_result: { action: 'promote', release_id, target_track, ...result },
              }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                action_result: { action: 'promote', success: false, error: err instanceof Error ? err.message : String(err) },
              }, null, 2),
            }],
          };
        }
      }

      if (action === 'set_rollout') {
        if (rollout_percentage === undefined) {
          return formatMcpError(new ShipKitError({
            code: 'TRACK_NOT_AVAILABLE',
            message: 'rollout_percentage is required for set_rollout action.',
            suggestion: 'Provide a rollout_percentage between 0.01 and 1.0.',
            severity: 'blocking',
          }));
        }
        if (!adapter) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                error: `Store '${store}' not configured. Use store.connect to add credentials.`,
              }, null, 2),
            }],
          };
        }
        try {
          const result = await adapter.setRollout({
            appId: app_id,
            track: target_track ?? 'production',
            rolloutPercentage: rollout_percentage,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                action_result: { action: 'set_rollout', rollout_percentage, ...result },
              }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                action_result: { action: 'set_rollout', success: false, error: err instanceof Error ? err.message : String(err) },
              }, null, 2),
            }],
          };
        }
      }

      if (action === 'halt' || action === 'resume') {
        if (!release_id) {
          return formatMcpError(new ShipKitError({
            code: 'ARTIFACT_NOT_FOUND',
            message: `release_id is required for ${action} action.`,
            suggestion: 'Provide the release_id of the release to halt or resume.',
            severity: 'blocking',
          }));
        }

        if (!adapter) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                error: `Store '${store}' not configured. Use store.connect to add credentials.`,
              }, null, 2),
            }],
          };
        }

        try {
          if (action === 'halt') {
            const result = await adapter.rollback({ appId: app_id });
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  app_id, store,
                  action_result: { action: 'halt', ...result },
                }, null, 2),
              }],
            };
          } else {
            const result = await adapter.resumeRelease({
              appId: app_id,
              track: target_track ?? 'production',
            });
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  app_id, store,
                  action_result: { action: 'resume', ...result },
                }, null, 2),
              }],
            };
          }
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                app_id, store,
                action_result: { action, success: false, error: err instanceof Error ? err.message : String(err) },
              }, null, 2),
            }],
          };
        }
      }

      return {
        content: [{ type: 'text' as const, text: `Unknown action: ${action as string}` }],
        isError: true,
      };
    },
  );
}
