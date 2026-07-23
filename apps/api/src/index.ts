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

export default app;
export { createCloudApiApp } from "./app";
