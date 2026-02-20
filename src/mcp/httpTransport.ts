/**
 * MCP HTTP Transport Manager
 *
 * Manages multiple concurrent MCP sessions over HTTP using StreamableHTTPServerTransport.
 * Each client connection gets its own transport + McpServer instance, keyed by session ID.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('mcp:http');

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class McpSessionManager {
  private sessions = new Map<string, SessionEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Start the periodic session cleanup. */
  start(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /** Stop the manager and close all sessions. */
  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [sid, entry] of this.sessions) {
      try {
        await entry.transport.close();
      } catch {
        // ignore close errors during shutdown
      }
      this.sessions.delete(sid);
    }
  }

  /** Route an incoming HTTP request to the correct transport. */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase();

    // Parse JSON body for POST requests
    let parsedBody: unknown;
    if (method === 'POST') {
      try {
        parsedBody = await readJsonBody(req);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
          id: null,
        }));
        return;
      }
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // ── Existing session ──────────────────────────────────────────────
    if (sessionId) {
      const entry = this.sessions.get(sessionId);
      if (!entry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Session not found' },
          id: null,
        }));
        return;
      }
      entry.lastActivity = Date.now();
      await entry.transport.handleRequest(req, res, parsedBody);
      return;
    }

    // ── New session (POST + initialize) ───────────────────────────────
    if (method === 'POST' && isInitializeRequest(parsedBody)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          log.info(`MCP HTTP session created: ${sid}`);
          this.sessions.set(sid, {
            transport,
            createdAt: Date.now(),
            lastActivity: Date.now(),
          });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && this.sessions.has(sid)) {
          log.info(`MCP HTTP session closed: ${sid}`);
          this.sessions.delete(sid);
        }
      };

      transport.onerror = (error: Error) => {
        log.error(`MCP HTTP transport error: ${error.message}`);
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    // ── Bad request ───────────────────────────────────────────────────
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: missing session ID or not an initialization request' },
      id: null,
    }));
  }

  /** Remove sessions that have been idle beyond the TTL. */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [sid, entry] of this.sessions) {
      if (now - entry.lastActivity > SESSION_TTL_MS) {
        log.info(`Expiring idle MCP HTTP session: ${sid}`);
        entry.transport.close().catch(() => {});
        this.sessions.delete(sid);
      }
    }
  }

  /** Number of active sessions (for health check / monitoring). */
  get activeSessionCount(): number {
    return this.sessions.size;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        resolve(body);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ─── Singleton ────────────────────────────────────────────────────────

let _manager: McpSessionManager | null = null;

export function getSessionManager(): McpSessionManager {
  if (!_manager) {
    _manager = new McpSessionManager();
  }
  return _manager;
}
