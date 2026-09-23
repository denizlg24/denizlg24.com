import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { AGENT_SESSION_HEADER, agentSessionKey } = await import("./service");

describe("agentSessionKey", () => {
  test("is stable, opaque and header-safe", () => {
    const key = agentSessionKey("66f1c0ffee0000000000abcd");
    expect(key).toBe(agentSessionKey("66f1c0ffee0000000000abcd"));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("66f1c0ffee");
    expect(agentSessionKey("other")).not.toBe(key);
    expect(AGENT_SESSION_HEADER).toBe("x-agent-session");
  });
});
