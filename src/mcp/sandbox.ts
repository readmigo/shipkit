/**
 * Sandbox MCP Server for Smithery capability scanning.
 *
 * Creates a lightweight McpServer that registers tool schemas without
 * initialising SQLite-backed singletons (ApiKeyManager, QuotaManager, etc.).
 * This allows Smithery to scan available tools/resources without native deps.
 *
 * Note: Resources are excluded because app-status-resource transitively
 * imports PollingScheduler → getDb → better-sqlite3 (native module).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerStoreListTool } from './tools/store-list.js';
import { registerStoreConnectTool } from './tools/store-connect.js';
import { registerAppUploadTool } from './tools/app-upload.js';
import { registerAppStatusTool } from './tools/app-status.js';
import { registerAppListingTool } from './tools/app-listing.js';
import { registerAppReleaseTool } from './tools/app-release.js';
import { registerAppPublishTool } from './tools/app-publish.js';
import { registerComplianceCheckTool } from './tools/compliance-check.js';
import { registerOnboardingTool } from './tools/onboarding.js';
import { registerStoreSetupGuideTool } from './tools/store-setup-guide.js';
import { registerPublishPreflightTool } from './tools/publish-preflight.js';
import { registerGuideResource } from './resources/guide-resource.js';

export function createSandboxServer(): McpServer {
  const server = new McpServer(
    {
      name: 'shipkit',
      version: '0.1.1',
    },
    {
      capabilities: {
        tools: { listChanged: true },
      },
    },
  );

  // Register all tools (schema only — handlers won't be called during scan)
  registerStoreListTool(server);
  registerStoreConnectTool(server);
  registerAppUploadTool(server);
  registerAppStatusTool(server);
  registerAppListingTool(server);
  registerAppReleaseTool(server);
  registerAppPublishTool(server);
  registerComplianceCheckTool(server);
  registerOnboardingTool(server);
  registerStoreSetupGuideTool(server);
  registerPublishPreflightTool(server);

  // Guide resource has no SQLite dependency — safe for sandbox
  registerGuideResource(server);

  return server;
}
