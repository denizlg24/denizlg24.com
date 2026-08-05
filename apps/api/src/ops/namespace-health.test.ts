import { describe, expect, it } from "bun:test";

import { collectNamespaceHealth } from "./namespace-health";

/**
 * Minimal drizzle-shaped stub. Each query is awaited, so the chain is a real
 * promise subclass rather than a thenable object — a bare `then` property makes
 * anything holding the object await it by accident.
 */
class QueryStub<T> extends Promise<T> {
  from(): this {
    return this;
  }
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
}

function db(rows: Record<string, unknown[]>) {
  const order = ["state", "problems", "candidates", "lastComplete"];
  let call = 0;
  return {
    select: () => {
      const key = order[call] as string;
      call += 1;
      return QueryStub.resolve(rows[key] ?? []) as QueryStub<unknown[]>;
    },
  } as never;
}

describe("ops namespace health", () => {
  it("reports nothing in legacy mode", async () => {
    const report = await collectNamespaceHealth({
      db: db({}),
      enabled: false,
      metadata: null,
    });
    expect(report).toMatchObject({ enabled: false, status: "ok" });
  });

  it("is critical when no metadata client is configured", async () => {
    // Broker mode with no way to ask whether the namespace is mounted cannot
    // honestly report healthy.
    const report = await collectNamespaceHealth({
      db: db({
        candidates: [{ count: 0 }],
        lastComplete: [{ finishedAt: new Date(), generation: 4 }],
        problems: [{ count: 0 }],
        state: [{ dirty: false, dirtySince: null, watcherOverflows: 0 }],
      }),
      enabled: true,
      metadata: null,
    });
    expect(report.status).toBe("critical");
    expect(report.reasons).toContain("namespace-not-mounted");
  });

  it("surfaces counts alongside the status", async () => {
    const report = await collectNamespaceHealth({
      db: db({
        candidates: [{ count: 3 }],
        lastComplete: [{ finishedAt: new Date(), generation: 9 }],
        problems: [{ count: 2 }],
        state: [{ dirty: false, dirtySince: null, watcherOverflows: 1 }],
      }),
      enabled: true,
      metadata: null,
    });
    expect(report).toMatchObject({
      lastCompleteGeneration: 9,
      reapCandidates: 3,
      unrepairedProblems: 2,
      watcherOverflows: 1,
    });
  });
});
