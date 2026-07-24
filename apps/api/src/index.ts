import { Hono } from "hono";

import pkg from "../package.json";
import { createRuntimeApp } from "./runtime";

const app = new Hono();
let runtimeApp: ReturnType<typeof createRuntimeApp> | undefined;

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

// Bun's default 10-second idle timeout aborts slow or paused large downloads;
// 240s keeps stalled sockets bounded (Bun caps the option at 255). Paused
// clients past that resume via HTTP Range. Object.assign preserves Hono's
// request helper for tests while exposing the Bun.serve option on the
// default export.
export default Object.assign(app, { idleTimeout: 240 as const });
export { createCloudApiApp } from "./app";
