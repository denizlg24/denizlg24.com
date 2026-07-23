import type { Context, MiddlewareHandler } from "hono";

import { ValidationError } from "../errors";

export interface RateLimitOptions {
  /** Sliding time window in milliseconds. */
  windowMs: number;
  /** Maximum requests per window and client address. */
  max: number;
}

function getClientIp(context: Context): string {
  return (
    context.req.header("cf-connecting-ip") ??
    context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    context.req.header("x-real-ip") ??
    "unknown"
  );
}

function validateRateLimitOptions(options: RateLimitOptions): void {
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new ValidationError(
      "windowMs must be greater than zero",
      "INVALID_RATE_LIMIT_WINDOW",
    );
  }
  if (!Number.isInteger(options.max) || options.max < 0) {
    throw new ValidationError(
      "max must be a non-negative integer",
      "INVALID_RATE_LIMIT_MAX",
    );
  }
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  validateRateLimitOptions(options);

  const hits = new Map<string, number[]>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const validTimestamps = timestamps.filter(
        (timestamp) => now - timestamp < options.windowMs,
      );
      if (validTimestamps.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, validTimestamps);
      }
    }
  }, options.windowMs);
  cleanup.unref();

  return async (context, next) => {
    const ip = getClientIp(context);
    const now = Date.now();
    const timestamps = (hits.get(ip) ?? []).filter(
      (timestamp) => now - timestamp < options.windowMs,
    );

    if (timestamps.length >= options.max) {
      context.header("Retry-After", String(Math.ceil(options.windowMs / 1000)));
      return context.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests, try again later",
          },
        },
        429,
      );
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    await next();
  };
}
