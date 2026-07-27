import type { Context } from "hono";
import { getEnv } from "@/lib/env";
import { getStatusStats, runAndRecordHealthCheck } from "./status.service";

export async function cronPing(c: Context) {
  const env = getEnv();
  if (!env.ENVOY_CRON_SECRET) {
    return c.json({ error: "ENVOY_CRON_SECRET not configured" }, 500);
  }

  // Accept token via query param or Authorization header
  const queryToken = c.req.query("token");
  const authHeader = c.req.header("Authorization");
  const headerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const token = queryToken || headerToken;

  if (token !== env.ENVOY_CRON_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Perform health check and record to database
  const result = await runAndRecordHealthCheck();

  return c.json({
    recorded: true,
    healthy: result.healthy,
    responseTime: result.responseTime,
    services: result.services,
  });
}

export async function getStats(c: Context) {
  const stats = await getStatusStats();
  return c.json(stats);
}
