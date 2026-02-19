/**
 * compliance.check - Pre-submission compliance checks
 *
 * Performs real dynamic validation against store-specific rules:
 * - Metadata checks: title/description length, privacy policy URL, screenshot count
 * - Artifact checks: file existence, size vs store maxFileSizeMB, extension validation
 * - Android artifact analysis via aapt2 (targetSdkVersion, dangerous permissions)
 * - Regulatory checks: ICP filing, PIPL compliance
 */

import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRegistry } from '../registry.js';

const STORE_IDS = [
  'google_play', 'app_store', 'huawei_agc',
  'xiaomi', 'oppo', 'vivo', 'honor',
] as const;

const CHECK_CATEGORIES = [
  'privacy_policy', 'data_collection', 'content_rating',
  'icp_filing', 'pipl_compliance', 'export_compliance',
  'age_rating', 'screenshots', 'listing_completeness',
  'artifact_validation',
] as const;

interface ComplianceCheckResult {
  store: string;
  category: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
  suggestion?: string;
  reference_url?: string;
}

// Stores that require ICP filing (Chinese domestic stores)
const ICP_REQUIRED_STORES = new Set(['huawei_agc', 'xiaomi', 'oppo', 'vivo', 'honor']);

// Store-specific title max lengths
const TITLE_MAX_LENGTH: Record<string, number> = {
  google_play: 50,
  app_store: 30,
  huawei_agc: 64,
  xiaomi: 64,
  oppo: 64,
  vivo: 64,
  honor: 64,
};

// Store-specific description max lengths
const DESCRIPTION_MAX_LENGTH: Record<string, number> = {
  google_play: 4000,
  app_store: 4000,
  huawei_agc: 8000,
  xiaomi: 4000,
  oppo: 4000,
  vivo: 4000,
  honor: 4000,
};

const DESCRIPTION_MIN_LENGTH = 10;
const MIN_SCREENSHOTS = 2;

// Valid file extensions per store family
const ANDROID_EXTENSIONS = new Set(['.apk', '.aab']);
const APPLE_EXTENSIONS = new Set(['.ipa']);
const HUAWEI_EXTENSIONS = new Set(['.apk', '.aab', '.hap']);

// Dangerous Android permissions that stores may flag
const DANGEROUS_PERMISSIONS = new Set([
  'android.permission.SEND_SMS',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
  'android.permission.READ_PHONE_STATE',
  'android.permission.PROCESS_OUTGOING_CALLS',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
]);

const MetadataSchema = z.object({
  title: z.string().optional(),
  short_description: z.string().optional(),
  full_description: z.string().optional(),
  privacy_policy_url: z.string().optional(),
  screenshot_count: z.number().optional(),
}).optional();

export function registerComplianceCheckTool(server: McpServer): void {
  server.registerTool(
    'compliance.check',
    {
      title: 'Compliance Pre-Check',
      description:
        'Run compliance pre-checks before submitting an app for review. ' +
        'Checks privacy policy, ICP filing (Chinese stores), PIPL compliance, ' +
        'screenshot completeness, content rating, listing completeness, ' +
        'and artifact validation. ' +
        'Returns pass/warning/fail for each check with actionable fix suggestions.',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        stores: z
          .array(z.enum(STORE_IDS))
          .min(1)
          .describe('Target stores to check compliance for'),
        check_categories: z
          .array(z.enum(CHECK_CATEGORIES))
          .optional()
          .describe('Specific categories to check. Leave empty to run all checks.'),
        metadata: MetadataSchema.describe(
          'App metadata to validate (title, short_description, full_description, privacy_policy_url, screenshot_count)',
        ),
        artifact_path: z
          .string()
          .optional()
          .describe('Path to the build artifact (.apk, .aab, .ipa, .hap) to validate'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ app_id, stores, check_categories, metadata, artifact_path }) => {
      const categories = check_categories ?? [...CHECK_CATEGORIES];
      const checks: ComplianceCheckResult[] = [];

      // Attempt to load registry for capability lookups (non-fatal if unavailable)
      let registry: Awaited<ReturnType<typeof getRegistry>> | null = null;
      try {
        registry = await getRegistry();
      } catch {
        // Registry unavailable — use fallback defaults
      }

      for (const store of stores) {
        const capabilities = registry?.getCapabilities(store) ?? null;

        for (const category of categories) {
          const results = runCheck(store, category, metadata, artifact_path, capabilities);
          checks.push(...results);
        }
      }

      const failCount = checks.filter((c) => c.status === 'fail').length;
      const warnCount = checks.filter((c) => c.status === 'warning').length;
      const overall_status = failCount > 0 ? 'fail' : warnCount > 0 ? 'warning' : 'pass';

      const result = {
        app_id,
        overall_status,
        checks,
        blocking_issues_count: failCount,
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

interface StoreCapabilitiesLike {
  maxFileSizeMB: number;
  supportedFileTypes: string[];
}

function runCheck(
  store: string,
  category: string,
  metadata?: { title?: string; short_description?: string; full_description?: string; privacy_policy_url?: string; screenshot_count?: number },
  artifactPath?: string,
  capabilities?: StoreCapabilitiesLike | null,
): ComplianceCheckResult[] {
  const results: ComplianceCheckResult[] = [];

  // ─── ICP Filing ─────────────────────────────────────────────────────
  if (category === 'icp_filing') {
    if (ICP_REQUIRED_STORES.has(store)) {
      results.push({
        store,
        category,
        status: 'warning',
        message: 'ICP filing is required for Chinese app stores. Verify your ICP number is registered.',
        suggestion: 'Ensure your ICP filing number is valid and added to the app listing.',
        reference_url: 'https://beian.miit.gov.cn/',
      });
    } else {
      results.push({ store, category, status: 'pass', message: 'ICP filing not required for this store.' });
    }
    return results;
  }

  // ─── PIPL Compliance ────────────────────────────────────────────────
  if (category === 'pipl_compliance') {
    if (ICP_REQUIRED_STORES.has(store)) {
      results.push({
        store,
        category,
        status: 'warning',
        message: 'PIPL (Personal Information Protection Law) compliance should be verified for Chinese stores.',
        suggestion: 'Ensure data collection disclosures and consent mechanisms comply with PIPL requirements.',
      });
    } else {
      results.push({ store, category, status: 'pass', message: 'PIPL compliance check not applicable for this store.' });
    }
    return results;
  }

  // ─── Privacy Policy ─────────────────────────────────────────────────
  if (category === 'privacy_policy') {
    if (!metadata?.privacy_policy_url) {
      results.push({
        store,
        category,
        status: 'fail',
        message: 'Privacy policy URL is missing. All stores require a valid privacy policy.',
        suggestion: 'Provide a privacy_policy_url in metadata that starts with https://.',
      });
    } else if (!metadata.privacy_policy_url.startsWith('https://')) {
      results.push({
        store,
        category,
        status: 'fail',
        message: `Privacy policy URL must use HTTPS. Got: ${metadata.privacy_policy_url}`,
        suggestion: 'Update your privacy policy URL to use https:// protocol.',
      });
    } else {
      results.push({ store, category, status: 'pass', message: 'Privacy policy URL is present and uses HTTPS.' });
    }
    return results;
  }

  // ─── Screenshots ────────────────────────────────────────────────────
  if (category === 'screenshots') {
    if (metadata?.screenshot_count === undefined) {
      results.push({
        store,
        category,
        status: 'warning',
        message: 'Screenshot count not provided. Cannot validate screenshot requirements.',
        suggestion: `Provide screenshot_count in metadata. Minimum ${MIN_SCREENSHOTS} screenshots required.`,
      });
    } else if (metadata.screenshot_count < MIN_SCREENSHOTS) {
      results.push({
        store,
        category,
        status: 'fail',
        message: `Only ${metadata.screenshot_count} screenshot(s) provided. Minimum ${MIN_SCREENSHOTS} required for ${store}.`,
        suggestion: `Add at least ${MIN_SCREENSHOTS - metadata.screenshot_count} more screenshot(s).`,
      });
    } else {
      results.push({ store, category, status: 'pass', message: `${metadata.screenshot_count} screenshots provided (minimum ${MIN_SCREENSHOTS}).` });
    }
    return results;
  }

  // ─── Listing Completeness ──────────────────────────────────────────
  if (category === 'listing_completeness') {
    // Title length check
    if (metadata?.title !== undefined) {
      const maxLen = TITLE_MAX_LENGTH[store] ?? 50;
      if (metadata.title.length === 0) {
        results.push({
          store,
          category,
          status: 'fail',
          message: 'Title is empty.',
          suggestion: 'Provide a non-empty app title.',
        });
      } else if (metadata.title.length > maxLen) {
        results.push({
          store,
          category,
          status: 'fail',
          message: `Title is ${metadata.title.length} chars, exceeds ${store} maximum of ${maxLen}.`,
          suggestion: `Shorten the title to ${maxLen} characters or fewer.`,
        });
      } else {
        results.push({ store, category, status: 'pass', message: `Title length ${metadata.title.length}/${maxLen} is within limits.` });
      }
    }

    // Description length check
    const description = metadata?.full_description;
    if (description !== undefined) {
      const maxLen = DESCRIPTION_MAX_LENGTH[store] ?? 4000;
      if (description.length < DESCRIPTION_MIN_LENGTH) {
        results.push({
          store,
          category,
          status: 'fail',
          message: `Description is ${description.length} chars, below minimum of ${DESCRIPTION_MIN_LENGTH}.`,
          suggestion: `Add more detail to reach at least ${DESCRIPTION_MIN_LENGTH} characters.`,
        });
      } else if (description.length > maxLen) {
        results.push({
          store,
          category,
          status: 'fail',
          message: `Description is ${description.length} chars, exceeds ${store} maximum of ${maxLen}.`,
          suggestion: `Shorten the description to ${maxLen} characters or fewer.`,
        });
      } else {
        results.push({ store, category, status: 'pass', message: `Description length ${description.length}/${maxLen} is within limits.` });
      }
    }

    // If no metadata fields to check, issue a general warning
    if (metadata?.title === undefined && metadata?.full_description === undefined) {
      results.push({
        store,
        category,
        status: 'warning',
        message: 'No metadata provided to check listing completeness.',
        suggestion: 'Provide title and full_description in metadata for validation.',
      });
    }
    return results;
  }

  // ─── Artifact Validation ───────────────────────────────────────────
  if (category === 'artifact_validation') {
    if (!artifactPath) {
      results.push({
        store,
        category,
        status: 'warning',
        message: 'No artifact_path provided. Skipping artifact validation.',
        suggestion: 'Provide artifact_path to validate the build file.',
      });
      return results;
    }

    // File existence
    if (!existsSync(artifactPath)) {
      results.push({
        store,
        category,
        status: 'fail',
        message: `Artifact not found: ${artifactPath}`,
        suggestion: 'Verify the file path is correct and the build artifact exists.',
      });
      return results;
    }

    const ext = extname(artifactPath).toLowerCase();

    // Extension validation per store
    const validExtensions = getValidExtensions(store);
    if (!validExtensions.has(ext)) {
      results.push({
        store,
        category,
        status: 'fail',
        message: `Invalid file extension "${ext}" for ${store}. Expected: ${[...validExtensions].join(', ')}`,
        suggestion: `Build your artifact with one of the supported extensions: ${[...validExtensions].join(', ')}`,
      });
    } else {
      results.push({ store, category, status: 'pass', message: `File extension "${ext}" is valid for ${store}.` });
    }

    // File size check
    try {
      const fileStat = statSync(artifactPath);
      const fileSizeMB = fileStat.size / (1024 * 1024);
      const maxMB = capabilities?.maxFileSizeMB ?? getDefaultMaxFileSizeMB(store);

      if (fileSizeMB > maxMB) {
        results.push({
          store,
          category,
          status: 'fail',
          message: `Artifact is ${fileSizeMB.toFixed(1)} MB, exceeds ${store} maximum of ${maxMB} MB.`,
          suggestion: `Reduce the build size below ${maxMB} MB. Consider enabling code shrinking or removing unused resources.`,
        });
      } else {
        results.push({
          store,
          category,
          status: 'pass',
          message: `Artifact size ${fileSizeMB.toFixed(1)} MB is within the ${maxMB} MB limit.`,
        });
      }
    } catch {
      results.push({
        store,
        category,
        status: 'warning',
        message: `Unable to read file size for ${artifactPath}.`,
      });
    }

    // aapt2 analysis for Android artifacts (APK/AAB) — uses execFileSync with
    // argument array to prevent shell injection (artifact path is never interpolated
    // into a shell command string)
    if (ANDROID_EXTENSIONS.has(ext)) {
      const aapt2Results = runAapt2Analysis(artifactPath, store);
      results.push(...aapt2Results);
    }

    return results;
  }

  // ─── Default checks (data_collection, content_rating, age_rating, export_compliance) ─
  // These require external data not available in params — return advisory status
  results.push({
    store,
    category,
    status: 'warning',
    message: `${category} requires manual verification for ${store}.`,
    suggestion: `Review ${category.replace(/_/g, ' ')} requirements in ${store} developer console documentation.`,
  });
  return results;
}

function getValidExtensions(store: string): Set<string> {
  if (store === 'app_store') return APPLE_EXTENSIONS;
  if (store === 'huawei_agc') return HUAWEI_EXTENSIONS;
  // All Android stores (google_play, xiaomi, oppo, vivo, honor)
  return ANDROID_EXTENSIONS;
}

function getDefaultMaxFileSizeMB(store: string): number {
  switch (store) {
    case 'google_play': return 150;
    case 'app_store': return 4000;
    case 'huawei_agc': return 4096;
    default: return 500; // Conservative default for Chinese stores
  }
}

function runAapt2Analysis(artifactPath: string, store: string): ComplianceCheckResult[] {
  const results: ComplianceCheckResult[] = [];
  const category = 'artifact_validation';

  try {
    // execFileSync with argument array — no shell interpolation, safe from injection
    const output = execFileSync('aapt2', ['dump', 'badging', artifactPath], {
      encoding: 'utf-8',
      timeout: 15_000,
    });

    // Parse targetSdkVersion
    const targetSdkMatch = output.match(/targetSdkVersion:'(\d+)'/);
    if (targetSdkMatch) {
      const targetSdk = parseInt(targetSdkMatch[1], 10);
      if (targetSdk < 33) {
        results.push({
          store,
          category,
          status: 'warning',
          message: `targetSdkVersion is ${targetSdk}. Google Play requires 33+ for new apps.`,
          suggestion: 'Update targetSdkVersion to 33 or higher in your build configuration.',
          reference_url: 'https://developer.android.com/google/play/requirements/target-sdk',
        });
      } else {
        results.push({
          store,
          category,
          status: 'pass',
          message: `targetSdkVersion ${targetSdk} meets requirements.`,
        });
      }
    }

    // Parse dangerous permissions
    const permissionRegex = /uses-permission: name='([^']+)'/g;
    const dangerousFound: string[] = [];
    let match;
    while ((match = permissionRegex.exec(output)) !== null) {
      if (DANGEROUS_PERMISSIONS.has(match[1])) {
        dangerousFound.push(match[1]);
      }
    }

    if (dangerousFound.length > 0) {
      results.push({
        store,
        category,
        status: 'warning',
        message: `Found ${dangerousFound.length} sensitive permission(s): ${dangerousFound.join(', ')}`,
        suggestion: 'Ensure each sensitive permission has a justified use case. Stores may reject apps with unnecessary sensitive permissions.',
      });
    } else {
      results.push({
        store,
        category,
        status: 'pass',
        message: 'No sensitive permissions detected.',
      });
    }
  } catch {
    results.push({
      store,
      category,
      status: 'warning',
      message: 'aapt2 not available or failed. Skipping Android artifact analysis.',
      suggestion: 'Install Android SDK build-tools and ensure aapt2 is on PATH for deeper APK/AAB inspection.',
    });
  }

  return results;
}
