import { describe, expect, spyOn, test } from "bun:test";
import {
  acceptsStatusToken,
  probeService,
  statusProbeSchema,
} from "./status-monitoring";

describe("status monitoring boundary", () => {
  test("rejects missing, short, and same-character-count multibyte credentials", () => {
    const token = "a".repeat(32);
    expect(acceptsStatusToken(undefined, token)).toBe(false);
    expect(acceptsStatusToken("a", "a")).toBe(false);
    expect(acceptsStatusToken(token, "é".repeat(32))).toBe(false);
    expect(acceptsStatusToken(token, token)).toBe(true);
  });
  test("readiness respects an unhealthy upstream even when HTTP and process are up", async () => {
    const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ status: "ok", upstream: "disconnected" }),
    );
    try {
      expect(
        (
          await probeService({
            id: "markets-relay",
            url: "https://example.test/healthz",
            upstream: "connected",
          })
        ).status,
      ).toBe("down");
    } finally {
      fetcher.mockRestore();
    }
  });
  test("an HTML success page is not a passing readiness check", async () => {
    const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Sign in</html>"),
    );
    try {
      expect(
        (
          await probeService({
            id: "terminal",
            url: "https://example.test/healthz",
          })
        ).status,
      ).toBe("unknown");
    } finally {
      fetcher.mockRestore();
    }
  });
  test("only HTTP service probes are accepted", () => {
    expect(
      statusProbeSchema.safeParse({ id: "file", url: "file:///etc/passwd" })
        .success,
    ).toBe(false);
  });
});
