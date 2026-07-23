import { createDb, requiredEnv } from "@repo/cloud-core";
import { createClient } from "redis";

import { createCloudApiApp } from "./app";
import {
  CLOUD_AUTH_TRUSTED_ORIGINS,
  createCloudAuth,
} from "./auth/better-auth";
import { RedisRateLimitStore } from "./auth/redis-rate-limit";

function authSecret(): string {
  const secret = requiredEnv("BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  return secret;
}

export async function createRuntimeApp() {
  const db = createDb(requiredEnv("DATABASE_URL"), {
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });
  const redis = createClient({ url: requiredEnv("REDIS_ADMIN_URL") });
  redis.on("error", (error) => {
    console.error("Redis connection error", error);
  });
  await redis.connect();

  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const auth = createCloudAuth({
    baseURL,
    cookieDomain: process.env.COOKIE_DOMAIN,
    db,
    secret: authSecret(),
    trustedOrigins: CLOUD_AUTH_TRUSTED_ORIGINS,
  });

  return createCloudApiApp({
    auth,
    db,
    isProduction: process.env.NODE_ENV === "production",
    rateLimitStore: new RedisRateLimitStore(redis),
    trustedOrigins: CLOUD_AUTH_TRUSTED_ORIGINS,
  });
}
