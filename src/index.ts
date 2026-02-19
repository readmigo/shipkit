#!/usr/bin/env node
/**
 * ShipKit - Unified App Publishing MCP Server & CLI
 * Entry point: detects run mode and starts appropriate service
 */

// Re-export public API
export { createMcpServer, startMcpServer } from './mcp/server.js';
export { AdapterRegistry } from './adapters/AdapterRegistry.js';
export { AuthManager } from './auth/AuthManager.js';
export { JobQueue, globalQueue } from './queue/JobQueue.js';
export type { Job, JobStatus } from './queue/JobQueue.js';

// When executed directly, detect mode from args/env
const isMainModule = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');

if (isMainModule) {
  const args = process.argv.slice(2);
  const mode = process.env.SHIPKIT_MODE || args[0] || 'mcp';

  if (mode === 'mcp' || mode === 'serve') {
    import('./mcp/server.js').then(m => m.startMcpServer());
  } else if (mode === 'cli') {
    import('./cli/index.js');
  } else {
    import('./mcp/server.js').then(m => m.startMcpServer());
  }
}
