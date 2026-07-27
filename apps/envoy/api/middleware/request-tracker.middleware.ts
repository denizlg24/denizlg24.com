import type { MiddlewareHandler } from "hono";
import { getApiProblemCategory } from "@/api/utils/api-problem-category";
import { prisma } from "@/lib/prisma";

// Paths to exclude from tracking (to avoid recursive logging)
const EXCLUDED_PATHS = ["/api/status/cron", "/api/status/stats", "/api/health"];

export const requestTracker: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const trackedPath = getApiProblemCategory(path, c.req.method);

  // Skip tracking for status endpoints to avoid noise
  if (EXCLUDED_PATHS.some((p) => path.startsWith(p))) {
    return next();
  }

  const start = Date.now();
  let error: string | undefined;

  try {
    await next();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
    throw e;
  } finally {
    const responseTime = Date.now() - start;
    const statusCode = c.res.status;

    // Record async - don't block response
    prisma.apiRequest
      .create({
        data: {
          method: c.req.method,
          path: trackedPath,
          statusCode,
          responseTime,
          error:
            error || (statusCode >= 400 ? `HTTP ${statusCode}` : undefined),
        },
      })
      .catch((err: unknown) => {
        console.error("Failed to record API request:", err);
      });
  }
};
