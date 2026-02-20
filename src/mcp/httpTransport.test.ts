/**
 * MCP HTTP Transport tests.
 *
 * Tests the McpSessionManager that routes HTTP requests to per-session
 * StreamableHTTPServerTransport instances.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpSessionManager } from './httpTransport.js';

// ─── Helpers ─────────────────────────────────────────────────────────

let server: Server;
let manager: McpSessionManager;
let baseUrl: string;

async function startTestServer(): Promise<void> {
  manager = new McpSessionManager();
  manager.start();

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    await manager.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
}

async function stopTestServer(): Promise<void> {
  await manager.stop();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function mcpRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function initializeRequest() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  };
}

function extractSessionId(res: Response): string | null {
  return res.headers.get('mcp-session-id');
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('McpSessionManager', () => {
  beforeEach(async () => {
    process.env.SHIPKIT_DB_PATH = ':memory:';
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('rejects POST without session ID when not an initialize request', async () => {
    const res = await mcpRequest('POST', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('missing session ID');
  });

  it('rejects GET with unknown session ID', async () => {
    const res = await mcpRequest('GET', undefined, {
      'Mcp-Session-Id': 'nonexistent-session',
    });
    expect(res.status).toBe(404);
  });

  it('creates a session on initialize request', async () => {
    const res = await mcpRequest('POST', initializeRequest());
    // The response should be SSE or JSON containing the initialize result
    expect(res.status).toBe(200);
    const sessionId = extractSessionId(res);
    expect(sessionId).toBeTruthy();
    expect(manager.activeSessionCount).toBe(1);
  });

  it('handles subsequent requests on existing session', async () => {
    // Initialize
    const initRes = await mcpRequest('POST', initializeRequest());
    expect(initRes.status).toBe(200);
    const sessionId = extractSessionId(initRes);
    expect(sessionId).toBeTruthy();

    // Consume the SSE body to release the connection
    await initRes.text();

    // Send initialized notification
    const notifRes = await mcpRequest('POST', {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, { 'Mcp-Session-Id': sessionId! });
    // Notifications get 202 Accepted (no response body expected)
    expect([200, 202, 204]).toContain(notifRes.status);
  });

  it('supports multiple concurrent sessions', async () => {
    // Create session 1
    const res1 = await mcpRequest('POST', initializeRequest());
    const sid1 = extractSessionId(res1);
    await res1.text();

    // Create session 2
    const res2 = await mcpRequest('POST', initializeRequest());
    const sid2 = extractSessionId(res2);
    await res2.text();

    expect(sid1).toBeTruthy();
    expect(sid2).toBeTruthy();
    expect(sid1).not.toBe(sid2);
    expect(manager.activeSessionCount).toBe(2);
  });

  it('closes session on DELETE', async () => {
    // Initialize
    const initRes = await mcpRequest('POST', initializeRequest());
    const sessionId = extractSessionId(initRes);
    await initRes.text();
    expect(manager.activeSessionCount).toBe(1);

    // Delete session
    const delRes = await mcpRequest('DELETE', undefined, {
      'Mcp-Session-Id': sessionId!,
    });
    expect([200, 202, 204]).toContain(delRes.status);

    // Session should be removed after transport closes
    // Give it a tick to propagate
    await new Promise((r) => setTimeout(r, 50));
    expect(manager.activeSessionCount).toBe(0);
  });

  it('rejects malformed JSON body', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: '{ invalid json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it('returns tools/list with registered tools', async () => {
    // Initialize session
    const initRes = await mcpRequest('POST', initializeRequest());
    const sessionId = extractSessionId(initRes);
    await initRes.text();

    // Send initialized notification
    const notifRes = await mcpRequest('POST', {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, { 'Mcp-Session-Id': sessionId! });
    await notifRes.text();

    // List tools
    const toolsRes = await mcpRequest('POST', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, { 'Mcp-Session-Id': sessionId! });
    expect(toolsRes.status).toBe(200);

    // Response is SSE — parse the event data
    const text = await toolsRes.text();
    const dataLines = text.split('\n').filter((l) => l.startsWith('data: '));
    expect(dataLines.length).toBeGreaterThan(0);

    const payload = JSON.parse(dataLines[0].replace('data: ', ''));
    expect(payload.result).toBeDefined();
    expect(payload.result.tools).toBeDefined();
    expect(Array.isArray(payload.result.tools)).toBe(true);

    // Verify our registered tools are present
    const toolNames = payload.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('store.list');
    expect(toolNames).toContain('app.status');
    expect(toolNames).toContain('app.publish');
  });
});
