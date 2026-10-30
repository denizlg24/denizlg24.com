import { describe, expect, test } from "bun:test";
import { callerFrom } from "./actor";

describe("callerFrom", () => {
  test("every human credential is the owner, whatever it claims", () => {
    for (const via of ["session", "oauth", "api-key"] as const) {
      expect(
        callerFrom(
          { user: { email: "user-1", role: "admin" }, via },
          "conversation:abc",
        ),
      ).toEqual({ actor: "owner", via, agent: false });
    }
  });

  test("a service client is mcp:<clientId> unless it names an agent run", () => {
    const session = {
      user: { email: "client:svc-1", role: "admin" as const },
      via: "oauth" as const,
    };
    expect(callerFrom(session, null)).toEqual({
      actor: "mcp:svc-1",
      via: null,
      agent: true,
    });
    expect(callerFrom(session, "task-run:66f1")).toEqual({
      actor: "task-run:66f1",
      via: "mcp:svc-1",
      agent: true,
    });
    expect(callerFrom(session, "owner")).toMatchObject({ actor: "mcp:svc-1" });
  });
});
