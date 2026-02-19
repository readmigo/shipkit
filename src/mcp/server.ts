/**
 * ShipKit MCP Server - Main entry point
 *
 * Registers all tools and resources, then starts the server
 * using stdio transport for local process-spawned integrations.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Commercialization infrastructure — initialise singletons early so the DB
// schema is always up-to-date before any tool is registered.
import { getApiKeyManager } from '../auth/ApiKeyManager.js';
import { getQuotaManager } from '../analytics/QuotaManager.js';
import { getUsageRecorder } from '../analytics/UsageRecorder.js';

// Tools
import { registerStoreListTool } from './tools/store-list.js';
import { registerStoreConnectTool } from './tools/store-connect.js';
import { registerAppUploadTool } from './tools/app-upload.js';
import { registerAppStatusTool } from './tools/app-status.js';
import { registerAppListingTool } from './tools/app-listing.js';
import { registerAppReleaseTool } from './tools/app-release.js';
import { registerAppPublishTool } from './tools/app-publish.js';
import { registerComplianceCheckTool } from './tools/compliance-check.js';

// Resources
import { registerAppStatusResource } from './resources/app-status-resource.js';

export function createMcpServer(): McpServer {
  // Initialise commercialisation singletons. When SHIPKIT_API_KEY is set,
  // the managers are ready to validate and record usage from the first call.
  // When it is absent, tools run in open mode (no quota enforcement).
  getApiKeyManager();
  getQuotaManager();
  getUsageRecorder();

  const server = new McpServer(
    {
      name: 'shipkit',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
      },
    },
  );

  // Register all tools
  registerStoreListTool(server);
  registerStoreConnectTool(server);
  registerAppUploadTool(server);
  registerAppStatusTool(server);
  registerAppListingTool(server);
  registerAppReleaseTool(server);
  registerAppPublishTool(server);
  registerComplianceCheckTool(server);

  // Register resources
  registerAppStatusResource(server);

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
