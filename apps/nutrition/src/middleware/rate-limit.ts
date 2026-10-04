import type Redis from "ioredis";

import { ApiError } from "../shared/errors";

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

const rateLimitScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

const parseRedisResult = (value: unknown) => {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "Rate limiter failed");
  }

  const [count, ttl] = value;

  if (typeof count !== "number" || typeof ttl !== "number") {
    throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "Rate limiter failed");
  }

  return { count, ttl };
};

export class RedisRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly options: RateLimitOptions,
  ) {}

  async check(identifier: string): Promise<RateLimitResult> {
    const key = `rate-limit:${identifier}`;
    const result = await this.redis.eval(
      rateLimitScript,
      1,
      key,
      String(this.options.windowMs),
    );
    const { count, ttl } = parseRedisResult(result);
    const remaining = Math.max(this.options.maxRequests - count, 0);

    return {
      allowed: count <= this.options.maxRequests,
      limit: this.options.maxRequests,
      remaining,
      resetSeconds: Math.max(Math.ceil(ttl / 1_000), 1),
    };
  }
}

export const getClientIdentifier = (request: Request) => {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
};
