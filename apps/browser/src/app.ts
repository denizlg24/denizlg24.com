import { Hono } from "hono";
import pkg from "../package.json";
import { bearerMatches } from "./auth";
import type { BrowserPool } from "./browser-pool";
import type { BrowserConfig } from "./config";
import type { McpSessions } from "./mcp-sessions";

export interface BrowserAppOptions {
  config: BrowserConfig;
  pool: BrowserPool;
  sessions: McpSessions;
}

export function createBrowserApp({
  config,
  pool,
  sessions,
}: BrowserAppOptions) {
  const app = new Hono();

  app.get("/healthz", async (c) =>
    c.json({
      ok: true,
      version: process.env.APP_VERSION ?? pkg.version,
      browser: (await pool.connected()) ? "connected" : "idle",
      contexts: pool.size,
      mcpSessions: sessions.size,
    }),
  );

  app.use("/mcp", async (c, next) => {
    if (!bearerMatches(c.req.header("authorization"), config.token)) {
      return c.json({ error: "unauthorized" }, 401, {
        "www-authenticate": 'Bearer realm="browser"',
      });
    }
    await next();
  });
  app.all("/mcp", (c) => sessions.handle(c.req.raw));

  return app;
}
