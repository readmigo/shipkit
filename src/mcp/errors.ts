/**
 * ShipKit - Structured Error Handling
 *
 * Unified ShipKitError supports two calling conventions:
 *   1. Object style (MCP tools):  new ShipKitError({ code, message, suggestion, severity, details })
 *   2. Positional style (adapters): new ShipKitError(message, storeId, code, statusCode?, retryable?)
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ShipKitErrorCode, ShipKitErrorInfo } from '../types/index.js';
import { getCatalogEntry } from '../errors/catalog.js';

export class ShipKitError extends Error {
  readonly code: ShipKitErrorCode | string;
  readonly suggestion: string;
  readonly severity: 'blocking' | 'warning' | 'info';
  readonly details?: Record<string, unknown>;
  readonly storeId?: string;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(info: ShipKitErrorInfo);
  constructor(message: string, storeId: string, code: string, statusCode?: number, retryable?: boolean);
  constructor(
    infoOrMessage: ShipKitErrorInfo | string,
    storeId?: string,
    code?: string,
    statusCode?: number,
    retryable?: boolean,
  ) {
    if (typeof infoOrMessage === 'string') {
      super(infoOrMessage);
      this.code = code ?? 'STORE_API_ERROR';
      this.suggestion = '';
      this.severity = 'blocking';
      this.storeId = storeId;
      this.statusCode = statusCode;
      this.retryable = retryable ?? false;
    } else {
      super(infoOrMessage.message);
      this.code = infoOrMessage.code;
      this.suggestion = infoOrMessage.suggestion;
      this.severity = infoOrMessage.severity;
      this.details = infoOrMessage.details;
      this.retryable = false;
    }
    this.name = 'ShipKitError';
  }
}

export function formatMcpError(error: ShipKitError): CallToolResult {
  const catalogEntry = getCatalogEntry(error.code);
  const suggestion = error.suggestion || catalogEntry?.suggestion || '';

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `[${error.code}] ${error.message}\nSuggestion: ${suggestion}`,
      },
    ],
    structuredContent: {
      error_code: error.code,
      message: error.message,
      severity: error.severity,
      suggestion,
      details: error.details,
    },
  };
}
