#!/usr/bin/env node
/**
 * ShipKit CLI - Unified app publishing command-line tool
 */

import { Command } from 'commander';
import { startMcpServer } from '../mcp/server.js';
import { AdapterRegistry } from '../adapters/AdapterRegistry.js';
import { AuthManager } from '../auth/AuthManager.js';
import { globalQueue } from '../queue/JobQueue.js';

const VERSION = '0.1.0';

// ─── Shared state ────────────────────────────────────────────────────

const authManager = new AuthManager();
const registry = AdapterRegistry.createDefault(authManager);

// ─── Output helpers ──────────────────────────────────────────────────

interface OutputOptions {
  format?: string;
  verbose?: boolean;
}

function output(data: unknown, opts: OutputOptions): void {
  if (opts.format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    // Table format: simple key-value for objects, tabular for arrays
    if (Array.isArray(data)) {
      if (data.length === 0) {
        console.log('(no results)');
        return;
      }
      console.table(data);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

// ─── Program ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name('shipkit')
  .description('Unified app publishing CLI for Google Play, Apple App Store, Huawei AGC, and more')
  .version(VERSION)
  .option('--format <format>', 'Output format (table|json)', 'table')
  .option('--verbose', 'Verbose output', false)
  .option('--dry-run', 'Show what would be done without executing', false);

// ─── store commands ──────────────────────────────────────────────────

const store = program.command('store').description('Manage app store connections');

store
  .command('list')
  .description('List all supported stores and connection status')
  .option('--platform <platform>', 'Filter by platform (ios|android|harmonyos)')
  .action((opts) => {
    const caps = registry.getAllCapabilities();
    const filtered = opts.platform
      ? caps.filter(c => {
          if (opts.platform === 'ios') return c.storeId === 'app_store';
          if (opts.platform === 'android') return c.storeId !== 'app_store';
          return true;
        })
      : caps;

    const rows = filtered.map(c => ({
      store_id: c.storeId,
      name: c.storeName,
      auth_method: c.authMethod,
      file_types: c.supportedFileTypes.join(', '),
      upload: c.supportsUpload ? 'yes' : 'no',
      rollback: c.supportsRollback ? 'yes' : 'no',
    }));

    output(rows, program.opts() as OutputOptions);
  });

store
  .command('connect <store-id>')
  .description('Connect to an app store with credentials')
  .requiredOption('--credentials <path>', 'Path to credentials file (JSON)')
  .action(async (storeId: string, opts: { credentials: string }) => {
    try {
      await authManager.loadCredentials(storeId, opts.credentials);
      const adapter = registry.getAdapter(storeId);
      if (!adapter) {
        console.error(`Unknown store: ${storeId}`);
        process.exit(1);
      }
      await adapter.authenticate();
      console.log(`Connected to ${storeId} successfully.`);
    } catch (err) {
      console.error(`Failed to connect to ${storeId}:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ─── build commands ──────────────────────────────────────────────────

const build = program.command('build').description('Build artifact management');

build
  .command('upload <file>')
  .description('Upload a build artifact to a store')
  .requiredOption('--platform <platform>', 'Target platform (ios|android|harmonyos)')
  .requiredOption('--store <store>', 'Target store ID')
  .option('--file-type <type>', 'File type (apk|aab|ipa|hap)')
  .requiredOption('--app-id <id>', 'Application ID')
  .action(async (file: string, opts: { platform: string; store: string; fileType?: string; appId: string }) => {
    const parentOpts = program.opts() as OutputOptions & { dryRun?: boolean };
    const adapter = registry.getAdapter(opts.store);
    if (!adapter) {
      console.error(`Unknown store: ${opts.store}. Use 'shipkit store list' to see available stores.`);
      process.exit(1);
    }

    const fileType = opts.fileType ?? file.split('.').pop() ?? 'apk';

    if (parentOpts.dryRun) {
      console.log(`[dry-run] Would upload ${file} (${fileType}) to ${opts.store} for app ${opts.appId}`);
      return;
    }

    const jobId = globalQueue.enqueue('upload', { appId: opts.appId, filePath: file, fileType });
    console.log(`Upload job queued: ${jobId}`);

    try {
      await globalQueue.process(jobId, async (payload) => {
        const p = payload as { appId: string; filePath: string; fileType: string };
        return adapter.uploadBuild({ appId: p.appId, filePath: p.filePath, fileType: p.fileType });
      });

      const job = globalQueue.getJob(jobId);
      if (job?.status === 'completed') {
        console.log('Upload completed.');
        output(job.result, parentOpts);
      } else {
        console.error(`Upload failed: ${job?.error}`);
        process.exit(1);
      }
    } catch (err) {
      console.error('Upload error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ─── status command ──────────────────────────────────────────────────

program
  .command('status')
  .description('Query app status across all connected stores')
  .option('--app-id <id>', 'Application ID')
  .option('--store <store>', 'Query specific store only')
  .action(async (opts: { appId?: string; store?: string }) => {
    const parentOpts = program.opts() as OutputOptions;
    if (!opts.appId) {
      console.error('--app-id is required');
      process.exit(1);
    }

    const storeIds = opts.store ? [opts.store] : registry.getSupportedStores();
    const results = [];

    for (const storeId of storeIds) {
      const adapter = registry.getAdapter(storeId);
      if (!adapter) continue;
      try {
        const status = await adapter.getStatus(opts.appId);
        results.push(status);
      } catch (err) {
        results.push({
          appId: opts.appId,
          storeName: storeId,
          reviewStatus: 'error',
          liveStatus: 'unknown',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    output(results, parentOpts);
  });

// ─── review command ──────────────────────────────────────────────────

const review = program.command('review').description('Submit apps for review');

review
  .command('submit')
  .description('Submit an app for review on specified stores')
  .requiredOption('--app-id <id>', 'Application ID')
  .requiredOption('--stores <stores>', 'Comma-separated store IDs')
  .action(async (opts: { appId: string; stores: string }) => {
    const parentOpts = program.opts() as OutputOptions & { dryRun?: boolean };
    const storeIds = opts.stores.split(',').map(s => s.trim());

    if (parentOpts.dryRun) {
      console.log(`[dry-run] Would submit ${opts.appId} for review on: ${storeIds.join(', ')}`);
      return;
    }

    const results = [];
    for (const storeId of storeIds) {
      const adapter = registry.getAdapter(storeId);
      if (!adapter) {
        results.push({ store: storeId, success: false, message: 'Unknown store' });
        continue;
      }
      try {
        const result = await adapter.submitForReview({ appId: opts.appId });
        results.push({ store: storeId, ...result });
      } catch (err) {
        results.push({ store: storeId, success: false, message: err instanceof Error ? err.message : String(err) });
      }
    }

    output(results, parentOpts);
  });

// ─── mcp command ─────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    await startMcpServer();
  });

// ─── web command ────────────────────────────────────────────────────

program
  .command('web')
  .description('Start the web dashboard')
  .option('--port <port>', 'Port number', '3456')
  .action(async (opts: { port: string }) => {
    const { startWebServer } = await import('../web/server.js');
    await startWebServer(parseInt(opts.port, 10));
  });

// ─── Parse and run ───────────────────────────────────────────────────

program.parse();
