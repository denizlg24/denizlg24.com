import type { Server } from "bun";
import { Hono } from "hono";

import pkg from "../package.json";
import { createRuntimeApp } from "./runtime";
import {
  type TerminalProxySocketData,
  terminalProxyWebsocket,
} from "./terminal/proxy";

const app = new Hono();
const honoFetch = app.fetch.bind(app);
let runtimeApp: ReturnType<typeof createRuntimeApp> | undefined;
let shuttingDown = false;

app.get("/", (c) => {
  return c.text("Deniz Cloud API");
});

app.get("/healthz", (c) => {
  return c.json({
    status: "ok",
    version: process.env.APP_VERSION ?? pkg.version,
  });
});

app.all("*", async (context) => {
  if (!runtimeApp) {
    const pending = createRuntimeApp();
    runtimeApp = pending;
    // Drop a rejected init from the cache so the next request can retry
    // instead of replaying the same cold-start failure forever.
    pending.catch(() => {
      if (runtimeApp === pending) {
        runtimeApp = undefined;
      }
    });
  }
  return (await runtimeApp).fetch(context.req.raw);
});

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const pending = runtimeApp;
    if (pending) {
      const runtime = await pending.catch(() => null);
      await runtime?.closeRuntime();
    }
    process.exit(0);
  } catch (error) {
    console.error("API shutdown failed", error);
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

// Bun's default 10-second idle timeout aborts slow or paused large downloads;
// 240s keeps stalled sockets bounded (Bun caps the option at 255). Paused
// clients past that resume via HTTP Range. Object.assign preserves Hono's
// request helper for tests while exposing the Bun.serve option on the
// default export.
async function serverFetch(
  request: Request,
  server?: Server<TerminalProxySocketData>,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === "/api/ops/terminal/ws") {
    if (!server || typeof server.upgrade !== "function") {
      return Response.json(
        {
          error: {
            code: "WEBSOCKET_UPGRADE_REQUIRED",
            message: "A WebSocket upgrade is required",
          },
        },
        { status: 426 },
      );
    }
    if (!runtimeApp) {
      const pending = createRuntimeApp();
      runtimeApp = pending;
      pending.catch(() => {
        if (runtimeApp === pending) runtimeApp = undefined;
      });
    }
    return (await runtimeApp).terminalProxy.upgrade(request, server);
  }
  return honoFetch(request);
}

export default Object.assign(app, {
  fetch: serverFetch,
  idleTimeout: 240 as const,
  websocket: terminalProxyWebsocket,
});
export { createCloudApiApp } from "./app";
