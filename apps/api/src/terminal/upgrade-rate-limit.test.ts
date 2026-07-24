import { describe, expect, it } from "bun:test";

import { TerminalUpgradeRateLimiter } from "./upgrade-rate-limit";

describe("terminal upgrade rate limiter", () => {
  it("throttles a trusted client identity without runtime initialization", () => {
    let now = 1_000;
    const limiter = new TerminalUpgradeRateLimiter({
      maxRequests: 2,
      now: () => now,
      windowMs: 10_000,
    });
    const request = new Request("https://api.example.test/ws", {
      headers: { "CF-Connecting-IP": "203.0.113.4" },
    });

    expect(limiter.consume(request).allowed).toBe(true);
    expect(limiter.consume(request).allowed).toBe(true);
    expect(limiter.consume(request)).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });
    now += 10_001;
    expect(limiter.consume(request).allowed).toBe(true);
  });
});
