import type {
  ActivityActorType,
  ActivityCategory,
  ActivitySeverity,
} from "@repo/schemas/cloud";
import type { Context, MiddlewareHandler } from "hono";

import type { ActivityEntryInput } from "../ops/activity";
import type { AuthVariables } from "./auth";

const MUTATING_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  // WebDAV's own mutations. PROPFIND and LOCK are deliberately absent: Finder
  // issues both constantly — a PROPFIND per directory it draws, a LOCK before
  // every save — and neither changes stored state, so they are recorded only
  // when they fail. PROPPATCH is absent for the same reason; the handler
  // accepts the client's timestamps and discards them, and the PUT it
  // accompanies is already the record of that save.
  "MKCOL",
  "MOVE",
  "COPY",
]);

/**
 * Polled by the dashboard every 30s. Logging their successes would bury every
 * real event under thousands of rows a day; only a 5xx from one is news.
 */
const NEVER_LOG_PATHS = new Set([
  "/healthz",
  "/api/me",
  "/api/ops/overview",
  "/api/ops/health",
  "/api/ops/metrics",
  "/api/ops/activity",
  "/api/ops/activity/facets",
]);

/**
 * S3 is the one surface where mutations are also high-volume — every multipart
 * part is a PUT — so only failures are recorded. Those are the interesting ones
 * anyway: AccessDenied for a wrong bucket, NoSuchBucket for one never created.
 */
const S3_PREFIX = "/v2";

/**
 * The mounted drive. Unlike S3 its mutations are worth keeping — a PUT here is
 * a person saving a file, not one part of a multipart upload — so it uses the
 * ordinary rule and only its read verbs are filtered out, in MUTATING_METHODS.
 */
const DAV_PREFIX = "/dav";

const DEFAULT_SLOW_REQUEST_MS = 3_000;

interface CategoryRule {
  prefix: string;
  category: ActivityCategory;
}

// Longest prefix wins, so the list is ordered most specific first.
const CATEGORY_RULES: readonly CategoryRule[] = [
  { prefix: "/api/auth/admin", category: "admin" },
  { prefix: "/api/auth", category: "auth" },
  { prefix: "/api/ops/terminal", category: "terminal" },
  { prefix: "/api/ops/tasks", category: "tasks" },
  { prefix: "/api/ops", category: "ops" },
  { prefix: "/api/storage", category: "storage" },
  { prefix: "/api/search", category: "storage" },
  { prefix: "/api/projects", category: "projects" },
  { prefix: "/api/db", category: "database" },
  { prefix: S3_PREFIX, category: "s3" },
  { prefix: DAV_PREFIX, category: "dav" },
];

export function categoryForPath(path: string): ActivityCategory {
  for (const rule of CATEGORY_RULES) {
    if (path === rule.prefix || path.startsWith(`${rule.prefix}/`)) {
      return rule.category;
    }
  }
  return "system";
}

export function severityForStatus(status: number): ActivitySeverity {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export interface ActivityCaptureDecision {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  slowRequestMs: number;
}

/**
 * Mutations, failures and slow requests only. A successful GET is the one thing
 * this deliberately does not record — it is the overwhelming majority of
 * traffic and the least useful thing to look at afterwards.
 */
export function shouldCapture(decision: ActivityCaptureDecision): boolean {
  if (
    decision.path === S3_PREFIX ||
    decision.path.startsWith(`${S3_PREFIX}/`)
  ) {
    return decision.status >= 400;
  }
  if (NEVER_LOG_PATHS.has(decision.path)) {
    return decision.status >= 500;
  }
  if (decision.status >= 400) return true;
  if (MUTATING_METHODS.has(decision.method)) return true;
  return decision.durationMs >= decision.slowRequestMs;
}

export interface ActivityMiddlewareOptions {
  record(entry: ActivityEntryInput): void;
  slowRequestMs?: number;
  /** Overridable so tests do not depend on the wall clock. */
  now?: () => number;
}

function clientIp(headers: Headers): string | null {
  return (
    headers.get("CF-Connecting-IP")?.trim() ||
    headers.get("X-Real-IP")?.trim() ||
    null
  );
}

function actorFrom(context: Context<{ Variables: AuthVariables }>): {
  actorType: ActivityActorType;
  actorId: string | null;
  actorLabel: string | null;
} {
  const user = context.get("user");
  if (user) {
    return {
      actorType: context.req.header("X-API-Key") ? "api_key" : "user",
      actorId: user.id,
      actorLabel: user.username,
    };
  }
  if (context.req.header("Authorization")?.startsWith("AWS4-HMAC-SHA256")) {
    return { actorType: "s3_credential", actorId: null, actorLabel: null };
  }
  return { actorType: "anonymous", actorId: null, actorLabel: null };
}

/**
 * Records one row per interesting request.
 *
 * Never reads `context.res` before `await next()`: doing so makes Hono rebuild
 * the response as `new Response(res.body, res)`, which turns a `Bun.file()`
 * blob into a stream, drops Content-Length and loses the sendfile() path. A
 * slow client downloading a large file then buffers in userspace until the
 * process is OOM-killed. See `middleware/cors.ts` for the same hazard.
 */
export function activityCapture(
  options: ActivityMiddlewareOptions,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  const slowRequestMs = options.slowRequestMs ?? DEFAULT_SLOW_REQUEST_MS;
  const now = options.now ?? (() => Date.now());

  return async (context, next) => {
    const startedAt = now();
    const method = context.req.method;
    const path = context.req.path;

    try {
      await next();
    } finally {
      const durationMs = now() - startedAt;
      // Only the status line is read, never the body. Hono's compose already
      // routed any throw through app.onError by this point, so `res.status` is
      // what the client actually receives and `context.error` carries the cause.
      const status = context.res.status;
      const error = context.error;
      if (shouldCapture({ method, path, status, durationMs, slowRequestMs })) {
        options.record({
          category: categoryForPath(path),
          action: "http.request",
          severity: severityForStatus(status),
          ...actorFrom(context),
          method,
          path,
          statusCode: status,
          durationMs,
          ip: clientIp(context.req.raw.headers),
          userAgent: context.req.header("User-Agent") ?? null,
          message: error?.message ?? null,
          metadata: error ? { errorName: error.name } : null,
        });
      }
    }
  };
}
