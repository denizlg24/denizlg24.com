import { describe, expect, test } from "bun:test";
import type {
  RunResult,
  SprintSlotKind,
  SprintSlotStatus,
} from "@repo/schemas";
import {
  buildSprintContext,
  defaultDependsOn,
  type EvaluableSlot,
  evaluateSlot,
  findDependencyCycle,
  latestUpstreamFindings,
  resolveRunConfig,
  sprintBranchName,
} from "./sprints";

const T0 = new Date("2026-11-04T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

let order = 0;
function slot(
  id: string,
  kind: SprintSlotKind,
  status: SprintSlotStatus,
  at: Date,
  dependsOn: string[] = [],
  result?: RunResult,
): EvaluableSlot & { title: string } {
  order += 1;
  return {
    id,
    kind,
    status,
    at,
    dependsOn,
    waitMinutes: 240,
    order,
    title: id,
    ...(result ? { result } : {}),
  };
}

const map = (...slots: EvaluableSlot[]) => new Map(slots.map((s) => [s.id, s]));

const approve: RunResult = {
  kind: "review",
  summary: "Fine",
  verdict: "approve",
  findings: [],
};
const changes: RunResult = {
  kind: "review",
  summary: "Issues",
  verdict: "changes",
  findings: [
    {
      id: "F1",
      severity: "blocker",
      file: "a.ts",
      line: 4,
      title: "Null",
      detail: "x can be null",
    },
  ],
};

describe("evaluateSlot", () => {
  const now = minutes(10);
  const ctx = { now, hasPr: true };

  test("a slot in the future is not due", () => {
    const a = slot("a", "implement", "scheduled", minutes(20));
    expect(evaluateSlot(a, map(a), ctx)).toEqual({ type: "not-due" });
  });

  test("a slot with no upstream is eligible once due", () => {
    const a = slot("a", "implement", "scheduled", T0);
    expect(evaluateSlot(a, map(a), ctx)).toEqual({ type: "eligible" });
  });

  test("only scheduled or waiting slots are evaluated", () => {
    const a = slot("a", "implement", "queued", T0);
    expect(evaluateSlot(a, map(a), ctx)).toEqual({ type: "not-due" });
  });

  test("every upstream succeeded → eligible", () => {
    const a = slot("a", "implement", "succeeded", T0);
    const b = slot("b", "review", "scheduled", minutes(5), ["a"]);
    expect(evaluateSlot(b, map(a, b), ctx)).toEqual({ type: "eligible" });
  });

  for (const [status, reason] of [
    ["failed", "upstream-failed"],
    ["skipped", "upstream-skipped"],
    ["cancelled", "upstream-cancelled"],
  ] as const) {
    test(`an upstream ${status} skips with ${reason}`, () => {
      const a = slot("a", "implement", status, T0);
      const b = slot("b", "review", "scheduled", minutes(5), ["a"]);
      expect(evaluateSlot(b, map(a, b), ctx)).toEqual({
        type: "skip",
        reason,
      });
    });
  }

  test("a running upstream waits until the wait runs out, then skips", () => {
    const a = slot("a", "implement", "running", T0);
    const b = slot("b", "review", "scheduled", minutes(5), ["a"]);
    expect(evaluateSlot(b, map(a, b), ctx)).toEqual({ type: "wait" });
    expect(
      evaluateSlot(b, map(a, b), { now: minutes(5 + 239), hasPr: true }),
    ).toEqual({ type: "wait" });
    expect(
      evaluateSlot(b, map(a, b), { now: minutes(5 + 240), hasPr: true }),
    ).toEqual({ type: "skip", reason: "upstream-timeout" });
  });

  test("a queued or not-yet-fired upstream also holds a slot", () => {
    const a = slot("a", "implement", "queued", T0);
    const later = slot("later", "implement", "scheduled", minutes(30));
    const b = slot("b", "review", "waiting", minutes(5), ["a", "later"]);
    expect(evaluateSlot(b, map(a, later, b), ctx)).toEqual({ type: "wait" });
  });

  test("a dangling dependency is ignored", () => {
    const b = slot("b", "review", "scheduled", T0, ["gone"]);
    expect(evaluateSlot(b, map(b), ctx)).toEqual({ type: "eligible" });
  });

  test("a cycle is skipped rather than waited on forever", () => {
    const a = slot("a", "implement", "scheduled", T0, ["b"]);
    const b = slot("b", "review", "scheduled", T0, ["a"]);
    expect(evaluateSlot(a, map(a, b), ctx)).toEqual({
      type: "skip",
      reason: "dependency-cycle",
    });
  });

  describe("release", () => {
    test("an approved chain with a PR is eligible", () => {
      const a = slot("a", "implement", "succeeded", T0);
      const r = slot("r", "review", "succeeded", minutes(1), ["a"], approve);
      const rel = slot("rel", "release", "scheduled", minutes(2), ["r"]);
      expect(evaluateSlot(rel, map(a, r, rel), ctx)).toEqual({
        type: "eligible",
      });
    });

    test("a transitive upstream that failed blocks it", () => {
      const a = slot("a", "implement", "failed", T0);
      const r = slot("r", "review", "succeeded", minutes(1), ["a"], approve);
      const rel = slot("rel", "release", "scheduled", minutes(2), ["r"]);
      expect(evaluateSlot(rel, map(a, r, rel), ctx)).toEqual({
        type: "skip",
        reason: "upstream-failed",
      });
    });

    test("a review asking for changes blocks it", () => {
      const a = slot("a", "implement", "succeeded", T0);
      const r = slot("r", "review", "succeeded", minutes(1), ["a"], changes);
      const rel = slot("rel", "release", "scheduled", minutes(2), ["r"]);
      expect(evaluateSlot(rel, map(a, r, rel), ctx)).toEqual({
        type: "skip",
        reason: "release-unapproved",
      });
    });

    test("a succeeded fix-review after the review approves it", () => {
      const a = slot("a", "implement", "succeeded", T0);
      const r = slot("r", "review", "succeeded", minutes(1), ["a"], changes);
      const f = slot("f", "fix-review", "succeeded", minutes(2), ["r"]);
      const rel = slot("rel", "release", "scheduled", minutes(3), ["f"]);
      expect(evaluateSlot(rel, map(a, r, f, rel), ctx)).toEqual({
        type: "eligible",
      });
    });

    test("a later review asking for changes overrides an earlier fix", () => {
      const a = slot("a", "implement", "succeeded", T0);
      const r1 = slot("r1", "review", "succeeded", minutes(1), ["a"], changes);
      const f = slot("f", "fix-review", "succeeded", minutes(2), ["r1"]);
      const r2 = slot("r2", "review", "succeeded", minutes(3), ["f"], changes);
      const rel = slot("rel", "release", "scheduled", minutes(4), ["r2"]);
      expect(evaluateSlot(rel, map(a, r1, f, r2, rel), ctx)).toEqual({
        type: "skip",
        reason: "release-unapproved",
      });
    });

    test("a chain with no review is not approved", () => {
      const a = slot("a", "implement", "succeeded", T0);
      const rel = slot("rel", "release", "scheduled", minutes(2), ["a"]);
      expect(evaluateSlot(rel, map(a, rel), ctx)).toEqual({
        type: "skip",
        reason: "release-unapproved",
      });
    });

    test("no PR, no release", () => {
      const a = slot("a", "implement", "succeeded", T0);
      const r = slot("r", "review", "succeeded", minutes(1), ["a"], approve);
      const rel = slot("rel", "release", "scheduled", minutes(2), ["r"]);
      expect(evaluateSlot(rel, map(a, r, rel), { now, hasPr: false })).toEqual({
        type: "skip",
        reason: "release-no-pr",
      });
    });
  });
});

describe("findDependencyCycle", () => {
  test("finds a cycle and names its path", () => {
    expect(
      findDependencyCycle([
        { id: "a", dependsOn: ["c"] },
        { id: "b", dependsOn: ["a"] },
        { id: "c", dependsOn: ["b"] },
      ]),
    ).toEqual(["a", "c", "b", "a"]);
  });

  test("a DAG with shared ancestors has none", () => {
    expect(
      findDependencyCycle([
        { id: "a", dependsOn: [] },
        { id: "b", dependsOn: ["a"] },
        { id: "c", dependsOn: ["a", "b"] },
      ]),
    ).toBeNull();
  });
});

describe("helpers", () => {
  test("slot overrides win over sprint defaults, undefined inherits", () => {
    expect(
      resolveRunConfig(
        { model: "sonnet", timeoutMinutes: 60 },
        { timeoutMinutes: 120, effort: undefined },
      ),
    ).toMatchObject({
      model: "sonnet",
      timeoutMinutes: 120,
      effort: "high",
      credential: "subscription",
    });
  });

  test("a new slot depends on the one before it in time", () => {
    const slots = [
      { id: "a", at: T0, order: 1 },
      { id: "b", at: minutes(60), order: 2 },
      { id: "c", at: minutes(120), order: 3 },
    ];
    expect(defaultDependsOn(slots, minutes(90))).toEqual(["b"]);
    expect(defaultDependsOn(slots, T0)).toEqual([]);
  });

  test("branch names are slugged", () => {
    expect(sprintBranchName("Auth: polish & Passkeys!", "1a2b")).toBe(
      "sprint/auth-polish-passkeys-1a2b",
    );
    expect(sprintBranchName("!!!", "ffff")).toBe("sprint/sprint-ffff");
  });

  test("a fix-review gets the latest review's findings", () => {
    const a = slot("a", "implement", "succeeded", T0);
    const r = slot("r", "review", "succeeded", minutes(1), ["a"], changes);
    const f = slot("f", "fix-review", "scheduled", minutes(2), ["r"]);
    expect(latestUpstreamFindings("f", map(a, r, f))).toEqual(
      changes.kind === "review" ? changes.findings : [],
    );
  });
});

describe("buildSprintContext", () => {
  test("includes the goal, every slot and upstream findings in full", () => {
    const a = slot("a", "implement", "succeeded", T0, [], {
      kind: "implement",
      summary: "Built the importer",
      changedAreas: ["apps/web"],
      testsRun: ["bun test"],
    });
    const r = slot("r", "review", "succeeded", minutes(60), ["a"], changes);
    const f = slot("f", "fix-review", "queued", minutes(120), ["r"]);
    const unrelated = slot("u", "custom", "succeeded", minutes(30), [], {
      kind: "custom",
      summary: "Side quest",
    });
    const markdown = buildSprintContext({
      sprint: {
        title: "Importer",
        goal: "Import **everything**.",
        repo: "denizlg24/x",
        branch: "sprint/importer-0001",
        baseBranch: "main",
        prUrl: "https://github.com/denizlg24/x/pull/7",
      },
      slots: [a, r, f, unrelated],
      currentSlotId: "f",
    });
    expect(markdown).toContain("Import **everything**.");
    expect(markdown).toContain("https://github.com/denizlg24/x/pull/7");
    expect(markdown).toContain("← this run");
    expect(markdown).toContain("Built the importer");
    expect(markdown).toContain("**F1** [blocker] Null (a.ts:4)");
    expect(markdown).toContain("x can be null");
    expect(markdown).not.toContain("Side quest");
    expect(markdown).toContain("CLAUDE.md");
  });
});
