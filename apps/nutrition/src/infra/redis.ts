import Redis from "ioredis";

import { env } from "../config/env";

export const redis = new Redis(env.redisUrl, {
  keyPrefix: env.redisKeyPrefix ? `${env.redisKeyPrefix}:` : undefined,
  enableReadyCheck: true,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

export const connectRedis = async () => {
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
};
