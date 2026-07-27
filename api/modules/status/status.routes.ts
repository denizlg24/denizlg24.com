import { Hono } from "hono";
import * as controller from "./status.controller";

export const statusRoutes = new Hono();

// GET /status/cron?token=<CRON_SECRET> - Called by external cron to trigger health check
// The endpoint pings /api/health internally and records the result
statusRoutes.get("/cron", controller.cronPing);

// GET /status/stats - Get aggregated status statistics
statusRoutes.get("/stats", controller.getStats);
