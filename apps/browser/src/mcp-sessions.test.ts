import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createMCPClient } from "@ai-sdk/mcp";
import { chromium } from "playwright";
import { createBrowserApp } from "./app";
import { BrowserPool } from "./browser-pool";
import type { BrowserConfig } from "./config";
import { type EgressProxy, startEgressProxy } from "./egress-proxy";
import { AGENT_SESSION_HEADER, McpSessions } from "./mcp-sessions";

const chromiumInstalled = existsSync(chromium.executablePath());
const token = "t".repeat(40);

let origin: ReturnType<typeof Bun.serve>;
let proxy: EgressProxy;
let pool: BrowserPool;
let sessions: McpSessions;
let app: ReturnType<typeof createBrowserApp>;

const config: BrowserConfig = {
  port: 0,
  token,
  proxyPort: 0,
  allowPrivateEgress: true,
  viewport: { width: 800, height: 600 },
  maxSessions: 3,
  sessionIdleMs: 60_000,
  mcpIdleMs: 60_000,
  outputDir: `${import.meta.dir}/../.test-output`,
};

beforeAll(() => {
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new Response(
        `<html><head><title>Fixture ${new URL(request.url).pathname}</title></head><body><h1>Fixture page</h1></body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
  });
  proxy = startEgressProxy({ port: 0, allowPrivate: true });
  pool = new BrowserPool({
    proxyServer: `http://127.0.0.1:${proxy.port}`,
    viewport: config.viewport,
    maxSessions: config.maxSessions,
    sessionIdleMs: config.sessionIdleMs,
  });
  sessions = new McpSessions({
    pool,
    playwright: {
      browser: { browserName: "chromium", isolated: false },
      capabilities: ["vision"],
      imageResponses: "allow",
      outputDir: config.outputDir,
      saveSession: false,
    },
    idleMs: config.mcpIdleMs,
  });
  app = createBrowserApp({ config, pool, sessions });
});

afterAll(async () => {
  await sessions.closeAll();
  await pool.close();
  await proxy.close();
  origin.stop(true);
});

const appFetch: typeof fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) =>
    app.fetch(new Request(input, init)),
  { preconnect: fetch.preconnect },
);

function open(agentSession?: string) {
  return createMCPClient({
    transport: {
      type: "http",
      url: "http://browser.test/mcp",
      headers: {
        authorization: `Bearer ${token}`,
        ...(agentSession ? { [AGENT_SESSION_HEADER]: agentSession } : {}),
      },
      fetch: appFetch,
    },
    clientName: "test",
  });
}

function textOf(result: unknown): string {
  const content =
    typeof result === "object" && result !== null && "content" in result
      ? result.content
      : [];
  return (Array.isArray(content) ? content : [])
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("\n");
}

describe("browser app", () => {
  test("refuses /mcp without the bearer", async () => {
    const response = await app.request("/mcp", { method: "POST" });
    expect(response.status).toBe(401);
  });

  test("reports health without touching the browser", async () => {
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, browser: "idle" });
  });

  test("a refused initialize leaves no session behind", async () => {
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(400);
    expect(sessions.size).toBe(0);
  });
});

describe.skipIf(!chromiumInstalled)("browser sessions", () => {
  test("a conversation's next MCP session adopts the tabs the last one left", async () => {
    const first = await open("conversation-a");
    const listed = await first.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_snapshot");
    expect(names).toContain("browser_take_screenshot");
    expect(names).toContain("browser_mouse_click_xy");

    const navigated = await first.callTool({
      name: "browser_navigate",
      arguments: { url: `http://127.0.0.1:${origin.port}/one` },
    });
    expect(navigated.isError).toBeFalsy();
    expect(textOf(navigated)).toContain("Fixture /one");
    await first.close();
    expect(sessions.size).toBe(0);
    expect(pool.keys()).toEqual(["conversation-a"]);

    const second = await open("conversation-a");
    const snapshot = await second.callTool({
      name: "browser_snapshot",
      arguments: {},
    });
    expect(textOf(snapshot)).toContain("Fixture /one");

    const screenshot = await second.callTool({
      name: "browser_take_screenshot",
      arguments: { type: "jpeg" },
    });
    const image = (
      "content" in screenshot && Array.isArray(screenshot.content)
        ? screenshot.content
        : []
    ).find((part) => part.type === "image");
    expect(image?.mimeType).toBe("image/jpeg");
    expect(typeof image?.data).toBe("string");
    await second.close();

    const other = await open("conversation-b");
    const blank = await other.callTool({
      name: "browser_snapshot",
      arguments: {},
    });
    expect(textOf(blank)).toContain("about:blank");
    await other.close();
    expect(pool.keys().sort()).toEqual(["conversation-a", "conversation-b"]);
  }, 60_000);

  test("a session with no agent key takes its context with it", async () => {
    const anonymous = await open();
    await anonymous.callTool({ name: "browser_snapshot", arguments: {} });
    expect(pool.keys().some((key) => key.startsWith("mcp:"))).toBe(true);
    await anonymous.close();
    await Bun.sleep(50);
    expect(pool.keys().some((key) => key.startsWith("mcp:"))).toBe(false);
    expect(sessions.size).toBe(0);
  }, 30_000);

  test("idle contexts are reaped and the next call gets a fresh one", async () => {
    expect(await pool.reapIdle(Date.now() + config.sessionIdleMs + 1)).toEqual(
      expect.arrayContaining(["conversation-a", "conversation-b"]),
    );
    expect(pool.size).toBe(0);
    const again = await open("conversation-a");
    const snapshot = await again.callTool({
      name: "browser_snapshot",
      arguments: {},
    });
    expect(textOf(snapshot)).toContain("about:blank");
    await again.close();
  }, 30_000);
});
