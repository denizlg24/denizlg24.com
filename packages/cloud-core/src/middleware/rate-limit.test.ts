import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { ValidationError } from "../errors";
import { rateLimit } from "./rate-limit";

function createApp(options: { windowMs: number; max: number }) {
  const app = new Hono();
  app.use(rateLimit(options));
  app.get("/test", (context) => context.json({ ok: true }));
  return app;
}

function requestFrom(ip: string): RequestInit {
  return {
    headers: {
      "cf-connecting-ip": ip,
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

  it("tracks client addresses independently and honors header priority", async () => {
    const app = createApp({ windowMs: 60_000, max: 1 });

    expect(
      (
        await app.request("/test", {
          headers: {
            "cf-connecting-ip": "1.1.1.1",
            "x-forwarded-for": "2.2.2.2, 3.3.3.3",
          },
        })
      ).status,
    ).toBe(200);
    expect((await app.request("/test", requestFrom("4.4.4.4"))).status).toBe(
      200,
    );
    expect((await app.request("/test", requestFrom("1.1.1.1"))).status).toBe(
      429,
    );
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
    expect(() => rateLimit({ windowMs: 0, max: 1 })).toThrow(ValidationError);
    expect(() => rateLimit({ windowMs: 1000, max: -1 })).toThrow(
      ValidationError,
    );
  });
});
