import { describe, expect, test } from "bun:test";
import type { Me } from "@repo/schemas/stream";
import { ApiError, NetworkError } from "./errors";
import { memberStatus } from "./member-status";

const me: Me = {
  member: { subject: "u1", name: "Ana", role: "member" },
  profiles: [],
};

describe("memberStatus", () => {
  test("reads the gate answers", () => {
    expect(memberStatus(undefined, new ApiError(403, "not_a_member"))).toBe(
      "not-a-member",
    );
    expect(memberStatus(undefined, new ApiError(409, "needs_setup"))).toBe(
      "needs-setup",
    );
  });

  test("a refusal wins over stale data", () => {
    expect(memberStatus(me, new ApiError(403, "not_a_member"))).toBe(
      "not-a-member",
    );
  });

  test("an outage is a retry, and keeps stale data showing", () => {
    expect(memberStatus(undefined, new ApiError(503, "auth_unavailable"))).toBe(
      "unavailable",
    );
    expect(memberStatus(undefined, new NetworkError())).toBe("unavailable");
    expect(memberStatus(me, new ApiError(503, "auth_unavailable"))).toBe(
      "ready",
    );
  });

  test("loading and ready", () => {
    expect(memberStatus(undefined, null)).toBe("loading");
    expect(memberStatus(me, null)).toBe("ready");
  });
});
