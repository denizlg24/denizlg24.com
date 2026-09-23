import { describe, expect, test } from "bun:test";
import { bearerMatches } from "./auth";
import { configFromEnv } from "./config";

describe("bearerMatches", () => {
  const token = "a".repeat(40);

  test("accepts the exact token, case-insensitive scheme", () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
    expect(bearerMatches(`bearer ${token}`, token)).toBe(true);
  });

  test("refuses anything else", () => {
    expect(bearerMatches(null, token)).toBe(false);
    expect(bearerMatches("", token)).toBe(false);
    expect(bearerMatches(token, token)).toBe(false);
    expect(bearerMatches(`Bearer ${token}x`, token)).toBe(false);
    expect(bearerMatches(`Bearer ${token.slice(1)}`, token)).toBe(false);
    expect(bearerMatches(`Basic ${token}`, token)).toBe(false);
  });
});

describe("configFromEnv", () => {
  const token = "b".repeat(48);

  test("requires a long token", () => {
    expect(() => configFromEnv({})).toThrow("BROWSER_MCP_TOKEN");
    expect(() => configFromEnv({ BROWSER_MCP_TOKEN: "short" })).toThrow();
  });

  test("reads sizes and minutes with defaults", () => {
    const config = configFromEnv({
      BROWSER_MCP_TOKEN: token,
      BROWSER_VIEWPORT: "1440x900",
      BROWSER_SESSION_IDLE_MINUTES: "5",
      BROWSER_MAX_SESSIONS: "2",
    });
    expect(config.viewport).toEqual({ width: 1440, height: 900 });
    expect(config.sessionIdleMs).toBe(5 * 60_000);
    expect(config.mcpIdleMs).toBe(60 * 60_000);
    expect(config.maxSessions).toBe(2);
    expect(config.port).toBe(3010);
    expect(config.allowPrivateEgress).toBe(false);
  });

  test("a malformed viewport falls back", () => {
    expect(
      configFromEnv({ BROWSER_MCP_TOKEN: token, BROWSER_VIEWPORT: "big" })
        .viewport,
    ).toEqual({ width: 1280, height: 720 });
  });
});
