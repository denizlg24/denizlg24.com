import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { ValidationError } from "../errors";
import {
  type RateLimitDecision,
  type RateLimitStore,
  rateLimit,
} from "./rate-limit";

class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();

  async consume(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const timestamps = (this.hits.get(key) ?? []).filter(
      (timestamp) => now - timestamp < windowMs,
    );
    if (timestamps.length >= max) {
      return {
        allowed: false,
        retryAfterMs: windowMs - (now - (timestamps[0] ?? now)),
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }
}

function createApp(options: { windowMs: number; max: number }) {
  const app = new Hono();
  app.use(
    rateLimit({
      ...options,
      keyGenerator: (context) =>
        context.req.header("x-trusted-client-id") ?? "trusted-default",
      store: new MemoryRateLimitStore(),
    }),
  );
  app.get("/test", (context) => context.json({ ok: true }));
  return app;
}

function requestFrom(clientId: string, forwardedIp?: string): RequestInit {
  return {
    headers: {
      "x-trusted-client-id": clientId,
      ...(forwardedIp ? { "x-forwarded-for": forwardedIp } : {}),
    },
  };
}

describe("rateLimit", () => {
  it("allows up to the limit and then returns the stable 429 shape", async () => {
    const app = createApp({ windowMs: 30_000, max: 2 });

    expect((await app.request("/test", requestFrom("1.2.3.4"))).status).toBe(
      200,
    );
    expect((await app.request("/test", requestFrom("1.2.3.4"))).status).toBe(
      200,
    );

    const blocked = await app.request("/test", requestFrom("1.2.3.4"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("30");
    expect(await blocked.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests, try again later",
      },
    });
  });

  it("uses trusted keys and ignores spoofed forwarding headers", async () => {
    const app = createApp({ windowMs: 60_000, max: 1 });

    expect(
      (
        await app.request("/test", {
          headers: {
            "x-trusted-client-id": "client-a",
            "x-forwarded-for": "2.2.2.2, 3.3.3.3",
          },
        })
      ).status,
    ).toBe(200);
    expect((await app.request("/test", requestFrom("client-b"))).status).toBe(
      200,
    );
    expect(
      (await app.request("/test", requestFrom("client-a", "9.9.9.9"))).status,
    ).toBe(429);
  });

  it("expires requests outside the sliding window", async () => {
    const app = createApp({ windowMs: 20, max: 1 });
    expect((await app.request("/test", requestFrom("5.5.5.5"))).status).toBe(
      200,
    );
    expect((await app.request("/test", requestFrom("5.5.5.5"))).status).toBe(
      429,
    );

    await Bun.sleep(30);
    expect((await app.request("/test", requestFrom("5.5.5.5"))).status).toBe(
      200,
    );
  });

  it("rejects invalid limiter configuration", () => {
    const baseOptions = {
      keyGenerator: () => "client",
      store: new MemoryRateLimitStore(),
    };
    expect(() => rateLimit({ ...baseOptions, windowMs: 0, max: 1 })).toThrow(
      ValidationError,
    );
    expect(() =>
      rateLimit({ ...baseOptions, windowMs: 1000, max: -1 }),
    ).toThrow(ValidationError);
  });
});
