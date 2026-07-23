import { afterAll, describe, expect, it } from "bun:test";

import { createClient } from "redis";

import { RedisRateLimitStore } from "./redis-rate-limit";

const integrationUrl = process.env.CLOUD_AUTH_TEST_REDIS_URL;
const integrationTest = integrationUrl ? it : it.skip;
let client: ReturnType<typeof createClient> | undefined;

async function connectedClient(): Promise<ReturnType<typeof createClient>> {
  if (!integrationUrl) {
    throw new Error("CLOUD_AUTH_TEST_REDIS_URL is required");
  }
  client ??= createClient({ url: integrationUrl });
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

afterAll(async () => {
  if (client?.isOpen) {
    await client.quit();
  }
});

describe("RedisRateLimitStore", () => {
  integrationTest(
    "atomically enforces a shared sliding window",
    async () => {
      const redis = await connectedClient();
      const prefix = `deniz-cloud:test-auth-rate:${crypto.randomUUID()}`;
      const store = new RedisRateLimitStore(redis, prefix);

      expect(await store.consume("client", 2, 50)).toEqual({
        allowed: true,
        retryAfterMs: 0,
      });
      expect(await store.consume("client", 2, 50)).toEqual({
        allowed: true,
        retryAfterMs: 0,
      });
      const blocked = await store.consume("client", 2, 50);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);

      await Bun.sleep(60);
      expect(await store.consume("client", 2, 50)).toEqual({
        allowed: true,
        retryAfterMs: 0,
      });

      await redis.del(`${prefix}:client`);
    },
    5_000,
  );

  integrationTest(
    "allows exactly max consumers under concurrent contention",
    async () => {
      const redis = await connectedClient();
      const prefix = `deniz-cloud:test-auth-rate:${crypto.randomUUID()}`;
      const store = new RedisRateLimitStore(redis, prefix);

      const results = await Promise.all(
        Array.from({ length: 12 }, () => store.consume("client", 4, 1_000)),
      );
      expect(results.filter(({ allowed }) => allowed)).toHaveLength(4);

      await redis.del(`${prefix}:client`);
    },
    5_000,
  );
});
