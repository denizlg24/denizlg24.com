import { Hono } from "hono";

import pkg from "../package.json";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/healthz", (c) => {
  return c.json({
    status: "ok",
    version: process.env.APP_VERSION ?? pkg.version,
  });
});

export default app;
