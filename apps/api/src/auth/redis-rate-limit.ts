import type {
  RateLimitDecision,
  RateLimitStore,
} from "@repo/cloud-core/middleware";

interface RedisEvalClient {
  eval(
    script: string,
    options: { arguments: string[]; keys: string[] },
  ): Promise<unknown>;
}

const CONSUME_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - window)
local count = redis.call("ZCARD", KEYS[1])
if count >= max then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local retry = window
  if oldest[2] then
    retry = math.max(1, tonumber(oldest[2]) + window - now)
  end
  redis.call("PEXPIRE", KEYS[1], window)
  return {0, retry}
end
redis.call("ZADD", KEYS[1], now, ARGV[4])
redis.call("PEXPIRE", KEYS[1], window)
return {1, 0}
`;

function redisInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Redis rate-limit ${label} was not numeric`);
  }
  return parsed;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: RedisEvalClient,
    private readonly prefix = "deniz-cloud:auth-rate",
  ) {}

  async consume(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const reply = await this.client.eval(CONSUME_SCRIPT, {
      arguments: [
        String(now),
        String(windowMs),
        String(max),
        `${now}:${crypto.randomUUID()}`,
      ],
      keys: [`${this.prefix}:${key}`],
    });
    if (
      !Array.isArray(reply) ||
      reply.length !== 2 ||
      (typeof reply[0] !== "number" && typeof reply[0] !== "string") ||
      (typeof reply[1] !== "number" && typeof reply[1] !== "string")
    ) {
      throw new Error("Redis rate-limit script returned an invalid response");
    }

    return {
      allowed: redisInteger(reply[0], "decision") === 1,
      retryAfterMs: Math.max(0, redisInteger(reply[1], "TTL")),
    };
  }
}
