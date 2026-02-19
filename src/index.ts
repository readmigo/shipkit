#!/usr/bin/env node
/**
 * ShipKit - Unified App Publishing MCP Server
 * Entry point: detects run mode and starts appropriate service
 */

const args = process.argv.slice(2);
const mode = process.env.SHIPKIT_MODE || args[0] || 'mcp';

if (mode === 'mcp' || mode === 'serve') {
  import('./mcp/server.js').then(m => m.startMcpServer());
} else if (mode === 'cli') {
  import('./cli/index.js');
} else {
  import('./mcp/server.js').then(m => m.startMcpServer());
}
