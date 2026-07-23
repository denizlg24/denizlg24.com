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
  runtimeApp ??= createRuntimeApp();
  return (await runtimeApp).fetch(context.req.raw);
});

export default app;
export { createCloudApiApp } from "./app";
