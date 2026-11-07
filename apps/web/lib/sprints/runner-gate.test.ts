import { describe, expect, test } from "bun:test";
import type { AdminSession } from "@/lib/require-admin";
import { isAgentRunner } from "./runner-gate";

function session(
  email: string,
  via: AdminSession["via"] = "oauth",
): AdminSession {
  return { user: { email, role: "admin" }, via };
}

describe("isAgentRunner", () => {
  test("accepts only the configured machine client", () => {
    expect(isAgentRunner(session("client:runner"), "runner")).toBe(true);
    expect(isAgentRunner(session("client:mcp"), "runner")).toBe(false);
  });

  test("refuses the owner, API keys and an unset client id", () => {
    expect(isAgentRunner(session("owner-subject"), "runner")).toBe(false);
    expect(isAgentRunner(session("client:runner", "session"), "runner")).toBe(
      false,
    );
    expect(isAgentRunner(session("admin-token", "api-key"), "runner")).toBe(
      false,
    );
    expect(isAgentRunner(session("client:runner"), undefined)).toBe(false);
    expect(isAgentRunner(session("client:"), " ")).toBe(false);
    expect(isAgentRunner(null, "runner")).toBe(false);
  });
});
