import { describe, expect, it } from "bun:test";

import { type NamespaceHealthInput, namespaceHealth } from "./namespace-health";

const now = new Date("2026-08-05T12:00:00Z");

function health(overrides: Partial<NamespaceHealthInput> = {}) {
  return namespaceHealth({
    branchesValid: true,
    dirty: false,
    dirtySince: null,
    lastCompleteAt: new Date("2026-08-05T11:55:00Z"),
    lastCompleteGeneration: 7,
    metadataServiceReachable: true,
    namespaceMounted: true,
    now,
    reapCandidates: 0,
    unrepairedProblems: 0,
    watcherOverflows: 0,
    ...overrides,
  });
}

describe("namespace health", () => {
  it("is ok when everything holds", () => {
    expect(health()).toMatchObject({ reasons: [], status: "ok" });
  });

  it("treats a partial namespace as critical, not degraded", () => {
    // A missing branch means entries are absent from listings while their bytes
    // still exist — a wrong view, not a stale one.
    expect(health({ namespaceMounted: false }).status).toBe("critical");
    expect(health({ branchesValid: false }).status).toBe("critical");
    expect(health({ metadataServiceReachable: false }).status).toBe("critical");
  });

  it("escalates a dirty projection once it exceeds its budget", () => {
    expect(
      health({
        dirty: true,
        dirtySince: new Date("2026-08-05T11:59:00Z"),
      }),
    ).toMatchObject({ status: "degraded" });
    expect(
      health({
        dirty: true,
        dirtySince: new Date("2026-08-05T11:00:00Z"),
      }),
    ).toMatchObject({ status: "critical" });
  });

  it("reports dirty age so drift is measurable", () => {
    expect(
      health({ dirty: true, dirtySince: new Date("2026-08-05T11:58:00Z") })
        .dirtyAgeSeconds,
    ).toBe(120);
  });

  it("degrades on unrepaired problems, overflows and a stale scan", () => {
    expect(health({ unrepairedProblems: 3 }).status).toBe("degraded");
    expect(health({ watcherOverflows: 1 }).status).toBe("degraded");
    expect(
      health({ lastCompleteAt: new Date("2026-08-01T12:00:00Z") }).status,
    ).toBe("degraded");
    expect(health({ lastCompleteGeneration: null }).status).toBe("degraded");
  });

  it("does not escalate on pending reap candidates alone", () => {
    // They are a queue awaiting evidence, not a fault.
    expect(health({ reapCandidates: 25 })).toMatchObject({ status: "ok" });
  });

  it("keeps critical when a degraded condition is also present", () => {
    const result = health({
      dirty: true,
      dirtySince: new Date("2026-08-05T11:59:00Z"),
      namespaceMounted: false,
      unrepairedProblems: 2,
    });
    expect(result.status).toBe("critical");
    expect(result.reasons).toContain("namespace-not-mounted");
    expect(result.reasons).toContain("unrepaired-projection-errors");
  });
});
