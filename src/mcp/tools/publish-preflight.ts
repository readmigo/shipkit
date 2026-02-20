/**
 * publish.preflight - Pre-publish readiness check
 */

import { z } from 'zod';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const CREDENTIALS_DIR = join(homedir(), '.shipkit', 'credentials');

const STORE_FILE_TYPES: Record<string, string[]> = {
  google_play: ['.apk', '.aab'],
  app_store: ['.ipa'],
  huawei_agc: ['.apk', '.aab'],
  xiaomi: ['.apk', '.aab'],
  oppo: ['.apk'],
  vivo: ['.apk'],
  honor: ['.apk'],
  pgyer: ['.apk', '.ipa'],
};

const CHINA_STORES = ['xiaomi', 'oppo', 'vivo', 'honor'];

interface CheckResult {
  check: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

function checkCredentials(storeId: string): CheckResult {
  const metaPath = join(CREDENTIALS_DIR, `${storeId}.json`);
  const credPath = join(CREDENTIALS_DIR, `${storeId}.credentials`);

  if (!existsSync(metaPath) || !existsSync(credPath)) {
    return {
      check: 'credentials',
      status: 'fail',
      message: `Store "${storeId}" is not configured. Run store.setup-guide for instructions, then store.connect to configure.`,
    };
  }
  return { check: 'credentials', status: 'pass', message: `Store "${storeId}" credentials configured.` };
}

function checkFile(storeId: string, filePath?: string): CheckResult {
  if (!filePath) {
    return { check: 'build_file', status: 'warn', message: 'No file_path provided. Skipping file check.' };
  }

  if (!existsSync(filePath)) {
    return { check: 'build_file', status: 'fail', message: `File not found: ${filePath}` };
  }

  const ext = extname(filePath).toLowerCase();
  const allowed = STORE_FILE_TYPES[storeId] ?? [];
  if (allowed.length > 0 && !allowed.includes(ext)) {
    return {
      check: 'build_file',
      status: 'fail',
      message: `File type "${ext}" not supported by ${storeId}. Expected: ${allowed.join(', ')}`,
    };
  }

  const stat = statSync(filePath);
  const sizeMB = Math.round(stat.size / (1024 * 1024));

  if (sizeMB > 4000) {
    return { check: 'build_file', status: 'fail', message: `File too large (${sizeMB} MB). Max 4 GB.` };
  }

  return { check: 'build_file', status: 'pass', message: `File OK (${sizeMB} MB, ${ext})` };
}

function checkEnvironment(storeId: string): CheckResult {
  if (storeId === 'app_store') {
    if (platform() !== 'darwin') {
      return {
        check: 'environment',
        status: 'fail',
        message: 'iOS upload requires macOS. Current platform: ' + platform(),
      };
    }

    try {
      execFileSync('xcrun', ['--version'], { stdio: 'pipe' });
    } catch {
      return {
        check: 'environment',
        status: 'fail',
        message: 'Xcode Command Line Tools not found. Install with: xcode-select --install',
      };
    }

    return { check: 'environment', status: 'pass', message: 'macOS with Xcode CLI detected.' };
  }

  return { check: 'environment', status: 'pass', message: 'No special environment requirements.' };
}

function checkCompliance(storeId: string): CheckResult {
  if (CHINA_STORES.includes(storeId)) {
    return {
      check: 'compliance',
      status: 'warn',
      message: 'Chinese store requires ICP filing. Run compliance.check to verify your app meets requirements.',
    };
  }

  return { check: 'compliance', status: 'pass', message: 'No special compliance requirements.' };
}

export function registerPublishPreflightTool(server: McpServer): void {
  server.registerTool(
    'publish.preflight',
    {
      title: 'Publish Preflight Check',
      description:
        'Run a comprehensive pre-publish readiness check. Validates credentials, ' +
        'build file, environment, and compliance requirements in one call. ' +
        'Returns pass/fail/warn for each check with actionable messages. ' +
        'Always run this before app.upload to catch issues early.',
      inputSchema: {
        store_id: z
          .enum(['google_play', 'app_store', 'huawei_agc', 'xiaomi', 'oppo', 'vivo', 'honor', 'pgyer'])
          .describe('Target store to check readiness for'),
        file_path: z
          .string()
          .optional()
          .describe('Path to the build artifact (IPA/APK/AAB). Optional but recommended.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ store_id, file_path }) => {
      const checks: CheckResult[] = [
        checkCredentials(store_id),
        checkFile(store_id, file_path),
        checkEnvironment(store_id),
        checkCompliance(store_id),
      ];

      const allPassed = checks.every((c) => c.status === 'pass');
      const hasFailures = checks.some((c) => c.status === 'fail');

      const result = {
        store_id,
        ready: allPassed,
        summary: hasFailures
          ? 'NOT READY — fix the failed checks below before publishing.'
          : allPassed
            ? 'ALL CLEAR — ready to publish!'
            : 'MOSTLY READY — review warnings below.',
        checks,
        next_step: hasFailures
          ? 'Fix the failed items above, then run publish.preflight again.'
          : 'Proceed with app.upload to upload your build.',
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  );
}
