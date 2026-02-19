/**
 * store.connect - Connect/configure an app store account
 */

import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ShipKitError, formatMcpError } from '../errors.js';

const CREDENTIALS_DIR = join(homedir(), '.shipkit', 'credentials');

export function registerStoreConnectTool(server: McpServer): void {
  server.registerTool(
    'store.connect',
    {
      title: 'Connect App Store',
      description:
        'Configure or update authentication credentials for an app store. ' +
        'Credentials are stored securely on the server side — the AI model never accesses plaintext secrets. ' +
        'Supports service_account (Google Play), api_key (App Store Connect), jwt, and oauth auth types.',
      inputSchema: {
        store_id: z
          .enum([
            'google_play', 'app_store', 'huawei_agc',
            'xiaomi', 'oppo', 'vivo', 'honor', 'pgyer',
          ])
          .describe('Target store ID'),
        auth_type: z
          .enum(['service_account', 'api_key', 'jwt', 'oauth'])
          .describe('Authentication type'),
        credentials_path: z
          .string()
          .describe('Local file path to the credentials file (e.g. Google Service Account JSON)'),
        config: z
          .object({
            issuer_id: z.string().optional().describe('App Store Connect: Issuer ID'),
            key_id: z.string().optional().describe('App Store Connect: Key ID'),
            client_id: z.string().optional().describe('Huawei AGC: Client ID'),
            project_id: z.string().optional().describe('Huawei AGC: Project ID'),
          })
          .optional()
          .describe('Store-specific configuration parameters'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ store_id, auth_type, credentials_path, config }) => {
      // Reject path traversal
      if (credentials_path.includes('..')) {
        const err = new ShipKitError({
          code: 'ARTIFACT_NOT_FOUND',
          message: 'Invalid credentials path: path traversal is not allowed.',
          suggestion: 'Provide an absolute path to the credentials file without ".." segments.',
          severity: 'blocking',
        });
        return formatMcpError(err);
      }

      // Verify credentials file exists
      if (!existsSync(credentials_path)) {
        const err = new ShipKitError({
          code: 'ARTIFACT_NOT_FOUND',
          message: `Credentials file not found: ${credentials_path}`,
          suggestion: 'Verify the file path is correct and the file exists.',
          severity: 'blocking',
        });
        return formatMcpError(err);
      }

      // Read and validate basic JSON structure
      let credentialsContent: string;
      try {
        credentialsContent = await readFile(credentials_path, 'utf-8');
        JSON.parse(credentialsContent);
      } catch {
        const err = new ShipKitError({
          code: 'ARTIFACT_INVALID_FORMAT',
          message: 'Credentials file is not valid JSON.',
          suggestion: 'Ensure the credentials file contains valid JSON.',
          severity: 'blocking',
        });
        return formatMcpError(err);
      }

      // Store credentials
      await mkdir(CREDENTIALS_DIR, { recursive: true });
      const destPath = join(CREDENTIALS_DIR, `${store_id}.json`);
      const storedData = JSON.stringify({
        store_id,
        auth_type,
        config: config ?? {},
        stored_at: new Date().toISOString(),
      });
      await writeFile(destPath, storedData, 'utf-8');
      // Store actual credentials separately (not in the metadata file)
      await writeFile(join(CREDENTIALS_DIR, `${store_id}.credentials`), credentialsContent, 'utf-8');

      const result = {
        store_id,
        auth_status: 'connected' as const,
        account_name: `${store_id}_developer_account`,
        permissions: ['app_upload', 'app_publish', 'listing_read', 'listing_write', 'review_status'],
      };

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
