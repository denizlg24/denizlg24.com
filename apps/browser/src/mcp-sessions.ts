import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createConnection } from "@playwright/mcp";
import type { BrowserPool } from "./browser-pool";

export type PlaywrightMcpConfig = NonNullable<
  Parameters<typeof createConnection>[0]
>;

/** Sent by the agent: an opaque id stable across the turns of one conversation. */
export const AGENT_SESSION_HEADER = "x-agent-session";

const AGENT_SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface McpSessionsOptions {
  pool: BrowserPool;
  playwright: PlaywrightMcpConfig;
  /** An MCP session that made no request for this long is closed. */
  idleMs: number;
  onError?: (error: unknown) => void;
}

interface Entry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Awaited<ReturnType<typeof createConnection>>;
  /** The browser-pool key this MCP session's tools act on. */
  key: string;
  /** Whether that key came from the agent, so the context is shared with later sessions. */
  agentOwned: boolean;
  lastUsedAt: number;
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status },
  );
}

export function agentSessionFrom(request: Request): string | null {
  const value = request.headers.get(AGENT_SESSION_HEADER)?.trim();
  return value && AGENT_SESSION_PATTERN.test(value) ? value : null;
}

/**
 * One Playwright MCP server per MCP session, all of a conversation's sessions
 * sharing one browser context. A turn opens a session, calls tools and
 * DELETEs it; the context stays in the pool under the agent's key, and the
 * next turn's server adopts its open tabs. A session with no agent key gets
 * a context of its own that goes when the session does.
 */
export class McpSessions {
  private readonly entries = new Map<string, Entry>();
  private reaper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: McpSessionsOptions) {}

  start(): void {
    this.reaper ??= setInterval(
      () => void this.reapIdle(),
      Math.min(this.options.idleMs, 60_000),
    );
  }

  get size(): number {
    return this.entries.size;
  }

  async handle(request: Request): Promise<Response> {
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) {
      const entry = this.entries.get(sessionId);
      if (!entry) return jsonRpcError(404, -32001, "Session not found");
      entry.lastUsedAt = Date.now();
      this.options.pool.touch(entry.key);
      return entry.transport.handleRequest(request);
    }
    if (request.method !== "POST") {
      return jsonRpcError(400, -32000, "Bad Request: no session");
    }
    return this.open(request, agentSessionFrom(request));
  }

  /**
   * A session exists once the transport accepts the initialize request. The
   * AI SDK's client first tries a protocol version this SDK refuses with a
   * 400 and only then retries with one it speaks, so a server built for a
   * refused initialize is closed again here rather than left in the map.
   */
  private async open(
    request: Request,
    agentSession: string | null,
  ): Promise<Response> {
    const sessionId = randomUUID();
    const key = agentSession ?? `mcp:${sessionId}`;
    const server = await createConnection(this.options.playwright, () =>
      this.options.pool.acquire(key),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      keepAliveMs: 15_000,
      onsessioninitialized: () => {
        this.entries.set(sessionId, {
          transport,
          server,
          key,
          agentOwned: agentSession !== null,
          lastUsedAt: Date.now(),
        });
      },
      onsessionclosed: () => this.forget(sessionId),
    });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    if (!this.entries.has(sessionId)) {
      await server
        .close()
        .catch((error: unknown) => this.options.onError?.(error));
    }
    return response;
  }

  private forget(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    if (!entry.agentOwned) {
      void this.options.pool
        .release(entry.key)
        .catch((error: unknown) => this.options.onError?.(error));
    }
  }

  private async close(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.forget(sessionId);
    await entry.server
      .close()
      .catch((error: unknown) => this.options.onError?.(error));
  }

  async reapIdle(now = Date.now()): Promise<string[]> {
    const reaped: string[] = [];
    for (const [sessionId, entry] of this.entries) {
      if (now - entry.lastUsedAt < this.options.idleMs) continue;
      await this.close(sessionId);
      reaped.push(sessionId);
    }
    return reaped;
  }

  async closeAll(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
    for (const sessionId of [...this.entries.keys()]) {
      await this.close(sessionId);
    }
  }
}
