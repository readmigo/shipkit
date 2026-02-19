/**
 * Compliance check API routes
 *
 * POST /check → Run compliance pre-checks for specified stores
 */

import { Hono } from 'hono';
import { existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { AdapterRegistry } from '../../adapters/AdapterRegistry.js';

interface ComplianceCheckResult {
  store: string;
  category: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
  suggestion?: string;
}

interface ComplianceRequest {
  app_id: string;
  store_ids: string[];
  metadata?: {
    title?: string;
    short_description?: string;
    full_description?: string;
    privacy_policy_url?: string;
    screenshot_count?: number;
  };
  artifact_path?: string;
}

// Stores that require ICP filing
const ICP_REQUIRED_STORES = new Set(['huawei_agc', 'xiaomi', 'oppo', 'vivo', 'honor']);

// Title max lengths per store
const TITLE_MAX_LENGTH: Record<string, number> = {
  google_play: 50,
  app_store: 30,
  huawei_agc: 64,
  xiaomi: 64,
  oppo: 64,
  vivo: 64,
  honor: 64,
};

// Description max lengths per store
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

// Valid extensions per store family
const ANDROID_EXTENSIONS = new Set(['.apk', '.aab']);
const APPLE_EXTENSIONS = new Set(['.ipa']);
const HUAWEI_EXTENSIONS = new Set(['.apk', '.aab', '.hap']);

export function createComplianceRouter(registry: AdapterRegistry) {
  const app = new Hono();

  // POST /check — Run compliance checks
  app.post('/check', async (c) => {
    let body: ComplianceRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { app_id, store_ids, metadata, artifact_path } = body;

    if (!app_id || !store_ids || !Array.isArray(store_ids) || store_ids.length === 0) {
      return c.json({ error: 'Missing required fields: app_id, store_ids (non-empty array)' }, 400);
    }

    const checks: ComplianceCheckResult[] = [];

    for (const storeId of store_ids) {
      const capabilities = registry.getCapabilities(storeId);

      // Privacy policy
      if (!metadata?.privacy_policy_url) {
        checks.push({
          store: storeId,
          category: 'privacy_policy',
          status: 'fail',
          message: 'Privacy policy URL is missing. All stores require a valid privacy policy.',
          suggestion: 'Provide a privacy_policy_url that starts with https://.',
        });
      } else if (!metadata.privacy_policy_url.startsWith('https://')) {
        checks.push({
          store: storeId,
          category: 'privacy_policy',
          status: 'fail',
          message: `Privacy policy URL must use HTTPS. Got: ${metadata.privacy_policy_url}`,
          suggestion: 'Update your privacy policy URL to use https:// protocol.',
        });
      } else {
        checks.push({
          store: storeId,
          category: 'privacy_policy',
          status: 'pass',
          message: 'Privacy policy URL is present and uses HTTPS.',
        });
      }

      // ICP filing
      if (ICP_REQUIRED_STORES.has(storeId)) {
        checks.push({
          store: storeId,
          category: 'icp_filing',
          status: 'warning',
          message: 'ICP filing is required for Chinese app stores.',
          suggestion: 'Ensure your ICP filing number is valid and added to the app listing.',
        });

        // PIPL compliance
        checks.push({
          store: storeId,
          category: 'pipl_compliance',
          status: 'warning',
          message: 'PIPL compliance should be verified for Chinese stores.',
          suggestion: 'Ensure data collection disclosures comply with PIPL requirements.',
        });
      }

      // Listing completeness — title
      if (metadata?.title !== undefined) {
        const maxLen = TITLE_MAX_LENGTH[storeId] ?? 50;
        if (metadata.title.length === 0) {
          checks.push({ store: storeId, category: 'listing_completeness', status: 'fail', message: 'Title is empty.', suggestion: 'Provide a non-empty app title.' });
        } else if (metadata.title.length > maxLen) {
          checks.push({ store: storeId, category: 'listing_completeness', status: 'fail', message: `Title is ${metadata.title.length} chars, exceeds max of ${maxLen}.`, suggestion: `Shorten the title to ${maxLen} characters or fewer.` });
        } else {
          checks.push({ store: storeId, category: 'listing_completeness', status: 'pass', message: `Title length ${metadata.title.length}/${maxLen} is within limits.` });
        }
      }

      // Listing completeness — description
      if (metadata?.full_description !== undefined) {
        const maxLen = DESCRIPTION_MAX_LENGTH[storeId] ?? 4000;
        if (metadata.full_description.length < DESCRIPTION_MIN_LENGTH) {
          checks.push({ store: storeId, category: 'listing_completeness', status: 'fail', message: `Description is ${metadata.full_description.length} chars, below minimum of ${DESCRIPTION_MIN_LENGTH}.`, suggestion: `Add more detail to reach at least ${DESCRIPTION_MIN_LENGTH} characters.` });
        } else if (metadata.full_description.length > maxLen) {
          checks.push({ store: storeId, category: 'listing_completeness', status: 'fail', message: `Description is ${metadata.full_description.length} chars, exceeds max of ${maxLen}.`, suggestion: `Shorten the description to ${maxLen} characters or fewer.` });
        } else {
          checks.push({ store: storeId, category: 'listing_completeness', status: 'pass', message: `Description length ${metadata.full_description.length}/${maxLen} is within limits.` });
        }
      }

      // Screenshots
      if (metadata?.screenshot_count !== undefined) {
        if (metadata.screenshot_count < MIN_SCREENSHOTS) {
          checks.push({ store: storeId, category: 'screenshots', status: 'fail', message: `Only ${metadata.screenshot_count} screenshot(s). Minimum ${MIN_SCREENSHOTS} required.`, suggestion: `Add at least ${MIN_SCREENSHOTS - metadata.screenshot_count} more screenshot(s).` });
        } else {
          checks.push({ store: storeId, category: 'screenshots', status: 'pass', message: `${metadata.screenshot_count} screenshots provided.` });
        }
      }

      // Artifact validation
      if (artifact_path) {
        if (!existsSync(artifact_path)) {
          checks.push({ store: storeId, category: 'artifact_validation', status: 'fail', message: `Artifact not found: ${artifact_path}`, suggestion: 'Verify the file path is correct.' });
        } else {
          const ext = extname(artifact_path).toLowerCase();
          const validExts = getValidExtensions(storeId);

          if (!validExts.has(ext)) {
            checks.push({ store: storeId, category: 'artifact_validation', status: 'fail', message: `Invalid extension "${ext}" for ${storeId}. Expected: ${[...validExts].join(', ')}`, suggestion: `Build with a supported extension: ${[...validExts].join(', ')}` });
          } else {
            checks.push({ store: storeId, category: 'artifact_validation', status: 'pass', message: `File extension "${ext}" is valid for ${storeId}.` });
          }

          // File size check
          try {
            const fileStat = statSync(artifact_path);
            const fileSizeMB = fileStat.size / (1024 * 1024);
            const maxMB = capabilities?.maxFileSizeMB ?? getDefaultMaxFileSizeMB(storeId);
            if (fileSizeMB > maxMB) {
              checks.push({ store: storeId, category: 'artifact_validation', status: 'fail', message: `Artifact is ${fileSizeMB.toFixed(1)} MB, exceeds ${maxMB} MB limit.`, suggestion: `Reduce build size below ${maxMB} MB.` });
            } else {
              checks.push({ store: storeId, category: 'artifact_validation', status: 'pass', message: `Artifact size ${fileSizeMB.toFixed(1)} MB is within the ${maxMB} MB limit.` });
            }
          } catch {
            checks.push({ store: storeId, category: 'artifact_validation', status: 'warning', message: `Unable to read file size for ${artifact_path}.` });
          }
        }
      }
    }

    const failCount = checks.filter((ch) => ch.status === 'fail').length;
    const warnCount = checks.filter((ch) => ch.status === 'warning').length;
    const overallStatus = failCount > 0 ? 'fail' : warnCount > 0 ? 'warning' : 'pass';

    return c.json({
      app_id,
      overall_status: overallStatus,
      checks,
      blocking_issues_count: failCount,
    });
  });

  return app;
}

function getValidExtensions(store: string): Set<string> {
  if (store === 'app_store') return APPLE_EXTENSIONS;
  if (store === 'huawei_agc') return HUAWEI_EXTENSIONS;
  return ANDROID_EXTENSIONS;
}

function getDefaultMaxFileSizeMB(store: string): number {
  switch (store) {
    case 'google_play': return 150;
    case 'app_store': return 4000;
    case 'huawei_agc': return 4096;
    default: return 500;
  }
}
