/**
 * clientContext — Holds the current MCP client info (name, version, transport).
 *
 * Set once after the MCP handshake completes; read by middleware to
 * enrich usage events with client metadata.
 */

import type { ClientInfo } from '../analytics/UsageRecorder.js';

type ClientInfoProvider = () => ClientInfo;

let _provider: ClientInfoProvider | null = null;

/** Register a provider that returns current client info. */
export function setClientInfoProvider(fn: ClientInfoProvider): void {
  _provider = fn;
}

/** Get current client info. Returns empty object if provider is not set. */
export function getClientInfo(): ClientInfo {
  return _provider?.() ?? {};
}
