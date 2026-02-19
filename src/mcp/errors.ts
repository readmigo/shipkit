/**
 * ShipKit - Structured Error Handling
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ShipKitErrorCode, ShipKitErrorInfo } from '../types/index.js';

export class ShipKitError extends Error {
  readonly code: ShipKitErrorCode;
  readonly suggestion: string;
  readonly severity: 'blocking' | 'warning' | 'info';
  readonly details?: Record<string, unknown>;

  constructor(info: ShipKitErrorInfo) {
    super(info.message);
    this.name = 'ShipKitError';
    this.code = info.code;
    this.suggestion = info.suggestion;
    this.severity = info.severity;
    this.details = info.details;
  }
}

export function formatMcpError(error: ShipKitError): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `[${error.code}] ${error.message}\nSuggestion: ${error.suggestion}`,
      },
    ],
    structuredContent: {
      error_code: error.code,
      message: error.message,
      severity: error.severity,
      suggestion: error.suggestion,
      details: error.details,
    },
  };
}
