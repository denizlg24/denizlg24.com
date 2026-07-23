import { afterAll, describe, expect, it } from "bun:test";

import { createClient } from "redis";

import { RedisRateLimitStore } from "./redis-rate-limit";

const integrationUrl = process.env.CLOUD_AUTH_TEST_REDIS_URL;
const integrationTest = integrationUrl ? it : it.skip;
let client: ReturnType<typeof createClient> | undefined;

afterAll(async () => {
  if (client?.isOpen) {
    await client.quit();
  }
});

describe("RedisRateLimitStore", () => {
  integrationTest(
    "atomically enforces a shared sliding window",
    async () => {
      if (!integrationUrl) {
        throw new Error("CLOUD_AUTH_TEST_REDIS_URL is required");
      }
      client = createClient({ url: integrationUrl });
      await client.connect();
      const prefix = `deniz-cloud:test-auth-rate:${crypto.randomUUID()}`;
      const store = new RedisRateLimitStore(client, prefix);

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

      await client.del(`${prefix}:client`);
    },
    5_000,
  );
});
