/**
 * withApiKey — Higher-order function that wraps an MCP tool handler with
 * API key validation, quota enforcement, and usage recording.
 *
 * Behavior:
 *   - If no key is present and requireAuth is false, the handler runs unauthenticated.
 *   - An invalid key always returns UNAUTHORIZED regardless of requireAuth.
 *   - Quota exhaustion returns a structured error without throwing.
 *   - Usage events are always recorded (success and failure paths).
 */

import { getApiKeyManager } from '../../auth/ApiKeyManager.js';
import { getQuotaManager } from '../../analytics/QuotaManager.js';
import { getUsageRecorder } from '../../analytics/UsageRecorder.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface ApiKeyContext {
  apiKeyId?: string;
}

export interface WithApiKeyOptions {
  /** When true, requests without an API key are rejected. Default: false. */
  requireAuth?: boolean;
}

type McpTextResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

// ─── Middleware ───────────────────────────────────────────────────────

/**
 * Wrap an MCP tool handler with API key auth, quota checks, and usage recording.
 *
 * @param toolName  The tool name used for quota classification and event logging.
 * @param handler   The actual tool implementation. Receives params (minus _apiKey)
 *                  and an ApiKeyContext with the resolved keyId.
 * @param options   Middleware options (requireAuth flag).
 */
export function withApiKey<T extends { _apiKey?: string }>(
  toolName: string,
  handler: (params: Omit<T, '_apiKey'>, context: ApiKeyContext) => Promise<McpTextResponse>,
  options: WithApiKeyOptions = {},
): (params: T) => Promise<McpTextResponse> {
  return async (params: T): Promise<McpTextResponse> => {
    const { _apiKey: paramKey, ...rest } = params;
    const apiKey = paramKey ?? process.env.SHIPKIT_API_KEY;

    // ── No key provided ──────────────────────────────────────────────
    if (!apiKey) {
      if (options.requireAuth) {
        return errorResponse('API key required', 'UNAUTHORIZED');
      }
      // Unauthenticated path — record event but skip quota
      const start = Date.now();
      try {
        const response = await handler(rest as Omit<T, '_apiKey'>, {});
        getUsageRecorder().recordEvent({
          toolName,
          status: 'success',
          durationMs: Date.now() - start,
        });
        return response;
      } catch (err) {
        getUsageRecorder().recordEvent({
          toolName,
          status: 'failed',
          durationMs: Date.now() - start,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    // ── Validate key ─────────────────────────────────────────────────
    const keyManager = getApiKeyManager();
    const validation = keyManager.validateKey(apiKey);
    if (!validation.valid) {
      return errorResponse('Invalid API key', 'UNAUTHORIZED');
    }

    const keyId = validation.keyId!;

    // ── Quota check ──────────────────────────────────────────────────
    const quotaManager = getQuotaManager();
    quotaManager.resetQuotasIfNeeded(keyId);

    const quota = quotaManager.checkQuota(keyId, toolName);
    if (!quota.allowed) {
      return errorResponse(
        'Quota exceeded',
        'QUOTA_EXCEEDED',
        { remaining: 0, resetAt: quota.resetAt },
      );
    }

    // ── Execute handler ──────────────────────────────────────────────
    const start = Date.now();
    try {
      const response = await handler(rest as Omit<T, '_apiKey'>, { apiKeyId: keyId });
      quotaManager.incrementUsage(keyId, toolName);
      getUsageRecorder().recordEvent({
        apiKeyId: keyId,
        toolName,
        status: 'success',
        durationMs: Date.now() - start,
      });
      return response;
    } catch (err) {
      getUsageRecorder().recordEvent({
        apiKeyId: keyId,
        toolName,
        status: 'failed',
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function errorResponse(
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): McpTextResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message, code, ...extra }),
      },
    ],
    isError: true,
  };
}
