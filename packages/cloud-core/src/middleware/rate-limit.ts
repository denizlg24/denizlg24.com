import type { Context, MiddlewareHandler } from "hono";

import { ValidationError } from "../errors";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimitStore {
  /**
   * Atomically consumes one request from a shared, TTL-backed counter.
   * Production stores must bound retained keys to the configured window.
   */
  consume(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<RateLimitDecision>;
}

export interface RateLimitOptions {
  /** Sliding time window in milliseconds. */
  windowMs: number;
  /** Maximum requests per window and trusted identity. */
  max: number;
  /** Resolves identity from application-validated proxy or auth context. */
  keyGenerator: (context: Context) => string | Promise<string>;
  /** Shared atomic store used for production enforcement. */
  store: RateLimitStore;
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

  return async (context, next) => {
    const key = await options.keyGenerator(context);
    if (key.length === 0) {
      throw new ValidationError(
        "Rate limit key must not be empty",
        "INVALID_RATE_LIMIT_KEY",
      );
    }

    const decision = await options.store.consume(
      key,
      options.max,
      options.windowMs,
    );
    if (!decision.allowed) {
      context.header(
        "Retry-After",
        String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))),
      );
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

    await next();
  };
}
