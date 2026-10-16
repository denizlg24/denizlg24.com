import { describe, expect, test } from "bun:test";
import { dashboardCollapseId } from "./mobile-push";

describe("dashboardCollapseId", () => {
  test("short subjects stay readable; long ones hash under the APNs limit", () => {
    expect(dashboardCollapseId("resource_down", "abc")).toBe(
      "resource_down:abc",
    );
    const long = dashboardCollapseId("triage_urgent", "x".repeat(200));
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(64);
    expect(long).toBe(dashboardCollapseId("triage_urgent", "x".repeat(200)));
    expect(long).not.toBe(
      dashboardCollapseId("triage_urgent", "y".repeat(200)),
    );
  });
});
