/**
 * app.release - Manage release tracks (promote, rollout, halt, resume)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ShipKitError, formatMcpError } from '../errors.js';

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
      if (action === 'list_tracks') {
        const tracks = [
          { track: 'internal', version_name: '2.0.0', version_code: 200, status: 'released', rollout_percentage: 1.0, user_count: 10 },
          { track: 'beta', version_name: '2.1.0-beta.1', version_code: 210, status: 'released', rollout_percentage: 1.0, user_count: 500 },
          { track: 'production', version_name: '2.0.0', version_code: 200, status: 'released', rollout_percentage: 1.0, user_count: 50000 },
        ];

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ app_id, store, tracks }, null, 2) }],
        };
      }

      if (action === 'promote') {
        if (!release_id) {
          const err = new ShipKitError({
            code: 'ARTIFACT_NOT_FOUND',
            message: 'release_id is required for promote action.',
            suggestion: 'Provide the release_id of the version to promote.',
            severity: 'blocking',
          });
          return formatMcpError(err);
        }
        if (!target_track) {
          const err = new ShipKitError({
            code: 'TRACK_NOT_AVAILABLE',
            message: 'target_track is required for promote action.',
            suggestion: 'Specify the target track (internal, alpha, beta, or production).',
            severity: 'blocking',
          });
          return formatMcpError(err);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              app_id,
              store,
              action_result: { action: 'promote', success: true, previous_state: 'beta', current_state: target_track },
            }, null, 2),
          }],
        };
      }

      if (action === 'set_rollout') {
        if (rollout_percentage === undefined) {
          const err = new ShipKitError({
            code: 'TRACK_NOT_AVAILABLE',
            message: 'rollout_percentage is required for set_rollout action.',
            suggestion: 'Provide a rollout_percentage between 0.01 and 1.0.',
            severity: 'blocking',
          });
          return formatMcpError(err);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              app_id,
              store,
              action_result: { action: 'set_rollout', success: true, previous_state: '0.1', current_state: String(rollout_percentage) },
            }, null, 2),
          }],
        };
      }

      if (action === 'halt' || action === 'resume') {
        if (!release_id) {
          const err = new ShipKitError({
            code: 'ARTIFACT_NOT_FOUND',
            message: `release_id is required for ${action} action.`,
            suggestion: 'Provide the release_id of the release to halt or resume.',
            severity: 'blocking',
          });
          return formatMcpError(err);
        }

        const prevState = action === 'halt' ? 'released' : 'halted';
        const currState = action === 'halt' ? 'halted' : 'released';

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              app_id,
              store,
              action_result: { action, success: true, previous_state: prevState, current_state: currState },
            }, null, 2),
          }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Unknown action: ${action as string}` }],
        isError: true,
      };
    },
  );
}
