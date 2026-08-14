import { Hono } from "hono";
import * as controller from "./status.controller";

export const statusRoutes = new Hono();

// Driven by an external cron, authenticated with ENVOY_CRON_SECRET as either a
// `token` query param or a bearer header. Pings /api/health and stores the result.
statusRoutes.get("/cron", controller.cronPing);

statusRoutes.get("/stats", controller.getStats);
