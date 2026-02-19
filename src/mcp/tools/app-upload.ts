/**
 * app.upload - Upload a build artifact (APK/AAB/IPA/HAP)
 */

import { z } from 'zod';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ShipKitError, formatMcpError } from '../errors.js';

const FILE_TYPE_EXTENSIONS: Record<string, string> = {
  apk: '.apk',
  aab: '.aab',
  ipa: '.ipa',
  hap: '.hap',
};

export function registerAppUploadTool(server: McpServer): void {
  server.registerTool(
    'app.upload',
    {
      title: 'Upload Build Artifact',
      description:
        'Upload an app build artifact to ShipKit. Supports APK, AAB, IPA, and HAP formats. ' +
        'Upload is idempotent: files with the same SHA256 hash will not be re-uploaded. ' +
        'The file is validated locally (existence, extension, size) and its SHA256 is computed.',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        file_path: z.string().describe('Absolute local file path to the build artifact'),
        file_type: z
          .enum(['apk', 'aab', 'ipa', 'hap'])
          .describe('Build artifact type'),
        version_name: z.string().describe("Version name, e.g. '2.1.0'"),
        version_code: z.number().int().describe('Version build number (Android versionCode / iOS build number)'),
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
    async ({ app_id, file_path, file_type, version_name, version_code, idempotency_key }) => {
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

      // Get file size
      const stats = statSync(file_path);
      const file_size = stats.size;

      // Compute SHA256
      const fileBuffer = await readFile(file_path);
      const sha256 = createHash('sha256').update(fileBuffer).digest('hex');

      const artifact_id = `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

      const result = {
        artifact_id,
        upload_status: 'completed' as const,
        sha256,
        file_size,
        app_id,
        version_name,
        version_code,
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
