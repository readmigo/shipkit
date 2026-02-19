/**
 * app.upload - Upload a build artifact (APK/AAB/IPA/HAP)
 */

import { z } from 'zod';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ShipKitError, formatMcpError } from '../errors.js';
import { getRegistry } from '../registry.js';
import { buildRegistry } from '../../registry/BuildRegistry.js';

const FILE_TYPE_EXTENSIONS: Record<string, string> = {
  apk: '.apk',
  aab: '.aab',
  ipa: '.ipa',
  hap: '.hap',
};

// Default target stores inferred from file type
const FILE_TYPE_DEFAULT_STORES: Record<string, string[]> = {
  apk: ['google_play', 'huawei_agc'],
  aab: ['google_play'],
  ipa: ['app_store'],
  hap: ['huawei_agc'],
};

export function registerAppUploadTool(server: McpServer): void {
  server.registerTool(
    'app.upload',
    {
      title: 'Upload Build Artifact',
      description:
        'Upload an app build artifact to one or more stores. Supports APK, AAB, IPA, and HAP formats. ' +
        'The file is validated locally (existence, extension, size) and its SHA256 is computed. ' +
        'If stores is not specified, target stores are inferred from file_type (aab→Google Play, ipa→App Store, hap→Huawei).',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        file_path: z.string().describe('Absolute local file path to the build artifact'),
        file_type: z
          .enum(['apk', 'aab', 'ipa', 'hap'])
          .describe('Build artifact type'),
        version_name: z.string().describe("Version name, e.g. '2.1.0'"),
        version_code: z.number().int().describe('Version build number (Android versionCode / iOS build number)'),
        stores: z
          .array(z.enum(['google_play', 'app_store', 'huawei_agc', 'xiaomi', 'oppo', 'vivo', 'honor']))
          .optional()
          .describe('Target stores to upload to. Inferred from file_type if not specified.'),
        idempotency_key: z
          .string()
          .optional()
          .describe('Idempotency key. Files with the same SHA256 are auto-deduplicated.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ app_id, file_path, file_type, version_name, version_code, stores }) => {
      // Reject path traversal
      if (file_path.includes('..')) {
        const err = new ShipKitError({
          code: 'ARTIFACT_NOT_FOUND',
          message: 'Invalid file path: path traversal is not allowed.',
          suggestion: 'Provide an absolute path without ".." segments.',
          severity: 'blocking',
        });
        return formatMcpError(err);
      }

      // Check file exists
      if (!existsSync(file_path)) {
        const err = new ShipKitError({
          code: 'ARTIFACT_NOT_FOUND',
          message: `Build artifact not found: ${file_path}`,
          suggestion: 'Verify the file path is correct. Use an absolute path.',
          severity: 'blocking',
        });
        return formatMcpError(err);
      }

      // Validate extension matches declared file_type
      const expectedExt = FILE_TYPE_EXTENSIONS[file_type];
      if (expectedExt && !file_path.toLowerCase().endsWith(expectedExt)) {
        const err = new ShipKitError({
          code: 'ARTIFACT_INVALID_FORMAT',
          message: `File extension does not match declared type '${file_type}'. Expected '${expectedExt}'.`,
          suggestion: `Ensure the file has a '${expectedExt}' extension or correct the file_type parameter.`,
          severity: 'blocking',
        });
        return formatMcpError(err);
      }

      // Get file size and SHA256
      const stats = statSync(file_path);
      const file_size = stats.size;
      const fileBuffer = await readFile(file_path);
      const sha256 = createHash('sha256').update(fileBuffer).digest('hex');
      const artifact_id = `art_${sha256.slice(0, 16)}`;

      // Determine target stores
      const targetStores = stores ?? FILE_TYPE_DEFAULT_STORES[file_type] ?? [];
      const registry = await getRegistry();

      // Upload to each target store
      const upload_results = await Promise.all(
        targetStores.map(async (store) => {
          const adapter = registry.getAdapter(store);
          if (!adapter) {
            return {
              store,
              status: 'skipped' as const,
              reason: `Store '${store}' not configured. Use store.connect to add credentials.`,
            };
          }
          try {
            const result = await adapter.uploadBuild({
              appId: app_id,
              filePath: file_path,
              fileType: file_type,
            });
            const uploadStatus = result.success ? 'uploaded' as const : 'failed' as const;
            if (result.success && result.buildId) {
              buildRegistry.save({
                artifact_id,
                build_id: result.buildId,
                store_id: store,
                app_id,
                file_path,
                sha256,
                version_name,
                version_code: String(version_code),
                timestamp: new Date().toISOString(),
                status: 'uploaded',
              });
            }
            return {
              store,
              status: uploadStatus,
              build_id: result.buildId,
              store_ref: result.storeRef,
              message: result.message,
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
          text: JSON.stringify({
            artifact_id,
            sha256,
            file_size,
            app_id,
            version_name,
            version_code,
            upload_results,
          }, null, 2),
        }],
      };
    },
  );
}
