import { fromTypes, openapi } from "@elysia/openapi";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { env } from "./config/env";
import { db } from "./db/client";
import { serveFrontend } from "./frontend/static";
import { redis } from "./infra/redis";
import { getClientIdentifier, RedisRateLimiter } from "./middleware/rate-limit";
import { hasValidApiKey } from "./modules/api-keys/auth";
import { foodIconsRoutes } from "./modules/food-icons/routes";
import { itemsRoutes } from "./modules/items/routes";
import { sourcesRoutes } from "./modules/sources/routes";
import { ApiError, isApiError, toError } from "./shared/errors";
import { fail, ok } from "./shared/http";
import { logger } from "./shared/logger";
import { getRequestContext, setRequestContext } from "./shared/request-context";

const rateLimiter = new RedisRateLimiter(redis, {
  maxRequests: env.rateLimitMax,
  windowMs: env.rateLimitWindowMs,
});

const shouldSkipRateLimit = (request: Request) => {
  const { pathname } = new URL(request.url);

  if (
    pathname === "/health" ||
    pathname === "/ready" ||
    pathname === "/api/health" ||
    pathname === "/api/ready"
  ) {
    return true;
  }

  return (
    !pathname.startsWith("/api/") &&
    pathname !== "/items" &&
    !pathname.startsWith("/items/") &&
    pathname !== "/food-icons" &&
    !pathname.startsWith("/food-icons/")
  );
};

const getErrorResponse = (error: unknown, code?: unknown) => {
  if (isApiError(error)) {
    return {
      status: error.statusCode,
      body: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  if (code === "VALIDATION") {
    return {
      status: 400,
      body: {
        code: "VALIDATION_FAILED",
        message: "Request validation failed",
        details: toError(error).message,
      },
    };
  }

  if (code === "NOT_FOUND") {
    return {
      status: 404,
      body: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    };
  }

  return {
    status: 500,
    body: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    },
  };
};

export const app = new Elysia()
  .use(
    openapi({
      path: "/docs",
      specPath: "/docs/json",
      references: fromTypes("src/app.ts", {
        instanceName: "app",
        tsconfigPath: "tsconfig.json",
        silent: true,
      }),
      documentation: {
        info: {
          title: "Deniz's Nutrition API",
          version: "1.0.50",
          description:
            "Food item search, barcode lookup, contribution, and detailed nutrition data.",
        },
        tags: [
          {
            name: "System",
            description: "Health, readiness, and service metadata endpoints.",
          },
          {
            name: "Items",
            description:
              "Search, lookup, create, update, and nutrition endpoints.",
          },
          {
            name: "Food icons",
            description: "Reusable food icon assets referenced by items.",
          },
        ],
      },
    }),
  )
  .onRequest(({ request, set }) => {
    const requestId =
      request.headers.get("x-request-id") ?? crypto.randomUUID();
    set.headers["x-request-id"] = requestId;
    setRequestContext(request, {
      requestId,
      startedAt: Date.now(),
    });
    const { pathname } = new URL(request.url);
    logger.info("request.start", {
      requestId,
      method: request.method,
      path: pathname,
    });
  })
  .onBeforeHandle(async ({ request, set }) => {
    if (shouldSkipRateLimit(request)) {
      return;
    }

    if (await hasValidApiKey(request)) {
      set.headers["x-ratelimit-bypass"] = "api-key";
      return;
    }

    const result = await rateLimiter.check(getClientIdentifier(request));

    set.headers["x-ratelimit-limit"] = String(result.limit);
    set.headers["x-ratelimit-remaining"] = String(result.remaining);
    set.headers["x-ratelimit-reset"] = String(result.resetSeconds);

    if (!result.allowed) {
      throw new ApiError(429, "RATE_LIMIT_EXCEEDED", "Rate limit exceeded", {
        resetSeconds: result.resetSeconds,
      });
    }
  })
  .get(
    "/api",
    ({ request }) =>
      ok(
        {
          name: "deniz-nutrition-api",
        },
        getRequestContext(request)?.requestId ?? "unknown",
      ),
    {
      detail: {
        summary: "Service metadata",
        tags: ["System"],
      },
    },
  )
  .get(
    "/api/health",
    ({ request }) =>
      ok(
        {
          status: "ok",
          uptimeSeconds: process.uptime(),
        },
        getRequestContext(request)?.requestId ?? "unknown",
      ),
    {
      detail: {
        summary: "Health check",
        tags: ["System"],
      },
    },
  )
  .get(
    "/health",
    ({ request }) =>
      ok(
        {
          status: "ok",
          uptimeSeconds: process.uptime(),
        },
        getRequestContext(request)?.requestId ?? "unknown",
      ),
    {
      detail: {
        summary: "Health check",
        tags: ["System"],
      },
    },
  )
  .get(
    "/api/ready",
    async ({ request }) => {
      await db.execute(sql`select 1`);
      await redis.ping();

      return ok(
        {
          status: "ready",
        },
        getRequestContext(request)?.requestId ?? "unknown",
      );
    },
    {
      detail: {
        summary: "Readiness check",
        description: "Checks PostgreSQL and Redis connectivity.",
        tags: ["System"],
      },
    },
  )
  .get(
    "/ready",
    async ({ request }) => {
      await db.execute(sql`select 1`);
      await redis.ping();

      return ok(
        {
          status: "ready",
        },
        getRequestContext(request)?.requestId ?? "unknown",
      );
    },
    {
      detail: {
        summary: "Readiness check",
        description: "Checks PostgreSQL and Redis connectivity.",
        tags: ["System"],
      },
    },
  )
  .group("/api", (api) =>
    api.use(itemsRoutes).use(foodIconsRoutes).use(sourcesRoutes),
  )
  .use(itemsRoutes)
  .use(foodIconsRoutes)
  .use(sourcesRoutes)
  .get("*", ({ request }) => serveFrontend(request))
  .onAfterHandle(({ request, set }) => {
    const context = getRequestContext(request);

    if (!context) {
      return;
    }

    const { pathname } = new URL(request.url);
    logger.info("request.finish", {
      requestId: context.requestId,
      method: request.method,
      path: pathname,
      status: typeof set.status === "number" ? set.status : undefined,
      durationMs: Date.now() - context.startedAt,
    });
  })
  .onError(({ code, error, request, set }) => {
    const context = getRequestContext(request);
    const response = getErrorResponse(error, code);
    const { pathname } = new URL(request.url);

    set.status = response.status;

    if (response.status >= 500) {
      logger.error("request.error", toError(error), {
        requestId: context?.requestId,
        method: request.method,
        path: pathname,
        status: response.status,
        durationMs: context ? Date.now() - context.startedAt : undefined,
      });
    } else {
      logger.warn("request.rejected", {
        requestId: context?.requestId,
        method: request.method,
        path: pathname,
        status: response.status,
        durationMs: context ? Date.now() - context.startedAt : undefined,
        code: response.body.code,
      });
    }

    return fail(response.body, context?.requestId ?? "unknown");
  });
