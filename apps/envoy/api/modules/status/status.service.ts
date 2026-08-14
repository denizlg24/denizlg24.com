import type { EnvoyHealthCheckResult } from "@repo/schemas/envoy";
import { getApiProblemCategory } from "@/api/utils/api-problem-category";
import {
  isHealthyForStatus,
  isServerError,
} from "@/api/utils/request-severity";
import { performHealthCheck } from "@/lib/health";
import { prisma } from "@/lib/prisma";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function recordHealthCheck(result: EnvoyHealthCheckResult) {
  return prisma.healthCheck.create({
    data: {
      healthy: result.healthy,
      responseTime: result.responseTime,
      dbHealthy: result.services.database.healthy,
      dbResponseTime: result.services.database.responseTime,
      r2Healthy: result.services.storage.healthy,
      r2ResponseTime: result.services.storage.responseTime,
      ghHealthy: result.services.github.healthy,
      ghResponseTime: result.services.github.responseTime,
    },
  });
}

export async function runAndRecordHealthCheck() {
  const result = await performHealthCheck();
  await recordHealthCheck(result);
  return result;
}

type DayStatus = "operational" | "degraded" | "down" | "no-data";

export async function getStatusStats() {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - NINETY_DAYS_MS);
  const twentyFourHoursAgo = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);

  const healthChecks = await prisma.healthCheck.findMany({
    where: { timestamp: { gte: ninetyDaysAgo } },
    orderBy: { timestamp: "asc" },
  });

  // Two windows over the same table: 24h drives the headline stats, 90d only
  // ever feeds the timeline, so it selects the two columns that needs.
  const recentRequests = await prisma.apiRequest.findMany({
    where: { timestamp: { gte: twentyFourHoursAgo } },
  });

  const allRequests = await prisma.apiRequest.findMany({
    where: { timestamp: { gte: ninetyDaysAgo } },
    select: {
      timestamp: true,
      statusCode: true,
    },
  });

  const latestHealth = healthChecks[healthChecks.length - 1];

  const uptimePercent =
    healthChecks.length > 0
      ? (healthChecks.filter((c) => c.healthy).length / healthChecks.length) *
        100
      : null;

  // Client errors (4xx, e.g. unauthorized access) mean the API behaved
  // correctly, so they never count against the service error rate.
  const errorCount = recentRequests.filter((r) =>
    isServerError(r.statusCode),
  ).length;
  const errorRate =
    recentRequests.length > 0
      ? (errorCount / recentRequests.length) * 100
      : null;

  const avgResponseTime =
    recentRequests.length > 0
      ? Math.round(
          recentRequests.reduce((sum, r) => sum + r.responseTime, 0) /
            recentRequests.length,
        )
      : null;

  const timeline = buildTimeline(healthChecks, allRequests, ninetyDaysAgo, now);
  const errorsByCategory = getErrorsByCategory(recentRequests);

  return {
    currentStatus: latestHealth
      ? {
          healthy: latestHealth.healthy,
          services: {
            database: {
              healthy: latestHealth.dbHealthy,
              responseTime: latestHealth.dbResponseTime,
            },
            storage: {
              healthy: latestHealth.r2Healthy,
              responseTime: latestHealth.r2ResponseTime,
            },
            github: {
              healthy: latestHealth.ghHealthy,
              responseTime: latestHealth.ghResponseTime,
            },
          },
        }
      : null,

    uptime:
      uptimePercent !== null ? Math.round(uptimePercent * 100) / 100 : null,
    errorRate: errorRate !== null ? Math.round(errorRate * 100) / 100 : null,
    avgResponseTime,
    totalRequests24h: recentRequests.length,
    timeline,
    errorsByCategory,
    lastCheck: latestHealth?.timestamp || null,
  };
}

function buildTimeline(
  healthChecks: Array<{ timestamp: Date; healthy: boolean }>,
  requests: Array<{ timestamp: Date; statusCode: number }>,
  startDate: Date,
  endDate: Date,
) {
  const dayMap = new Map<
    string,
    {
      healthyChecks: number;
      totalChecks: number;
      successRequests: number;
      totalRequests: number;
    }
  >();

  // Seed every day in the window so a day nothing was recorded on comes back
  // as an explicit "no-data" bar rather than being missing from the series.
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split("T")[0];
    dayMap.set(key, {
      healthyChecks: 0,
      totalChecks: 0,
      successRequests: 0,
      totalRequests: 0,
    });
  }

  for (const check of healthChecks) {
    const key = check.timestamp.toISOString().split("T")[0];
    const day = dayMap.get(key);
    if (day) {
      day.totalChecks++;
      if (check.healthy) day.healthyChecks++;
    }
  }

  for (const req of requests) {
    const key = req.timestamp.toISOString().split("T")[0];
    const day = dayMap.get(key);
    if (day) {
      day.totalRequests++;
      if (isHealthyForStatus(req.statusCode)) day.successRequests++;
    }
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({
      date,
      status: getStatusForDay(stats),
      healthChecks: stats.totalChecks,
      requests: stats.totalRequests,
      errorRate:
        stats.totalRequests > 0
          ? Math.round(
              ((stats.totalRequests - stats.successRequests) /
                stats.totalRequests) *
                100,
            )
          : 0,
    }));
}

function getStatusForDay(stats: {
  healthyChecks: number;
  totalChecks: number;
  successRequests: number;
  totalRequests: number;
}): DayStatus {
  if (stats.totalChecks === 0 && stats.totalRequests === 0) return "no-data";

  // A day with one signal but not the other scores on the one it has: the
  // absent side defaults to 1 so it cannot drag an otherwise clean day down.
  const healthRatio =
    stats.totalChecks > 0 ? stats.healthyChecks / stats.totalChecks : 1;
  const successRatio =
    stats.totalRequests > 0 ? stats.successRequests / stats.totalRequests : 1;
  const score = (healthRatio + successRatio) / 2;

  if (score >= 0.99) return "operational";
  if (score >= 0.95) return "degraded";
  return "down";
}

function getErrorsByCategory(
  requests: Array<{
    method: string;
    path: string;
    statusCode: number;
    error: string | null;
  }>,
) {
  const errorMap = new Map<string, { count: number; errors: string[] }>();

  for (const req of requests) {
    if (isServerError(req.statusCode)) {
      const category = getApiProblemCategory(req.path, req.method);
      const existing = errorMap.get(category) || { count: 0, errors: [] };
      existing.count++;
      if (req.error && !existing.errors.includes(req.error)) {
        existing.errors.push(req.error);
      }
      errorMap.set(category, existing);
    }
  }

  return Array.from(errorMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}
