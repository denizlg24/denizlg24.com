import { describe, expect, test } from "bun:test";
import {
  createSprintSchema,
  createSprintSlotSchema,
  DEFAULT_RUN_CONFIG,
  gitBranchSchema,
  runConfigOverrideSchema,
  runConfigSchema,
  runnerCompleteRequestSchema,
  runResultSchema,
  sprintRepoSchema,
  updateSprintSchema,
  updateSprintSlotSchema,
} from "./sprints";

describe("sprint contracts", () => {
  test("the default run config is itself valid", () => {
    expect(runConfigSchema.parse(DEFAULT_RUN_CONFIG)).toEqual(
      DEFAULT_RUN_CONFIG,
    );
  });

  test("an interactive permission mode is refused", () => {
    expect(
      runConfigOverrideSchema.safeParse({ permissionMode: "default" }).success,
    ).toBe(false);
  });

  test("timeouts are bounded to five minutes and six hours", () => {
    expect(
      runConfigOverrideSchema.safeParse({ timeoutMinutes: 4 }).success,
    ).toBe(false);
    expect(
      runConfigOverrideSchema.safeParse({ timeoutMinutes: 361 }).success,
    ).toBe(false);
    expect(
      runConfigOverrideSchema.safeParse({ timeoutMinutes: 360 }).success,
    ).toBe(true);
  });

  test("repos are owner/name", () => {
    expect(sprintRepoSchema.safeParse("denizlg24/denizlg24.com").success).toBe(
      true,
    );
    expect(sprintRepoSchema.safeParse("denizlg24").success).toBe(false);
    expect(sprintRepoSchema.safeParse("a/b/c").success).toBe(false);
    expect(sprintRepoSchema.safeParse("../etc").success).toBe(false);
  });

  test("branch names git or a shell would misread are refused", () => {
    for (const bad of [
      "-rf",
      "a..b",
      "x.lock",
      "/lead",
      "trail/",
      "a b",
      "$(id)",
    ]) {
      expect(gitBranchSchema.safeParse(bad).success).toBe(false);
    }
    expect(gitBranchSchema.safeParse("sprint/auth-polish-1a2b").success).toBe(
      true,
    );
  });

  test("a created sprint defaults to main, UTC and no overrides", () => {
    expect(
      createSprintSchema.parse({ title: "Polish", repo: "denizlg24/x" }),
    ).toMatchObject({
      baseBranch: "main",
      timeZone: "UTC",
      defaults: {},
      goal: "",
    });
  });

  test("updates never carry create-time defaults", () => {
    expect(updateSprintSchema.parse({ title: "Renamed" })).toEqual({
      title: "Renamed",
    });
    expect(updateSprintSlotSchema.parse({ title: "Renamed" })).toEqual({
      title: "Renamed",
    });
  });

  test("a slot waits four hours on a running upstream by default", () => {
    const slot = createSprintSlotSchema.parse({
      at: "2026-11-04T09:00:00Z",
      kind: "implement",
      title: "Build it",
    });
    expect(slot.onUpstreamRunning.waitMinutes).toBe(240);
    expect(slot.dependsOn).toBeUndefined();
  });

  test("results round trip per kind", () => {
    const results = [
      {
        kind: "implement",
        summary: "Added the thing",
        changedAreas: ["apps/web"],
        testsRun: ["bun test"],
      },
      {
        kind: "review",
        summary: "Two issues",
        verdict: "changes",
        findings: [
          {
            id: "F1",
            severity: "blocker",
            file: "a.ts",
            line: 3,
            title: "Null deref",
            detail: "x is null",
          },
        ],
      },
      {
        kind: "fix-review",
        summary: "Fixed F1",
        addressed: ["F1"],
        declined: [{ id: "F2", reason: "Out of scope" }],
      },
      {
        kind: "release",
        summary: "Bumped",
        version: "1.2.0",
        steps: ["bump"],
        ciRequired: true,
      },
      { kind: "custom", summary: "Done" },
    ];
    for (const result of results) {
      expect(runResultSchema.parse(result)).toEqual(
        result as ReturnType<typeof runResultSchema.parse>,
      );
    }
  });

  test("a release result must say whether CI gates it", () => {
    expect(
      runResultSchema.safeParse({
        kind: "release",
        summary: "Bumped",
        steps: [],
      }).success,
    ).toBe(false);
  });

  test("a result without a summary is not a result", () => {
    expect(
      runResultSchema.safeParse({ kind: "custom", summary: " " }).success,
    ).toBe(false);
  });

  test("completion carries a result on success and a failure on failure", () => {
    expect(
      runnerCompleteRequestSchema.safeParse({ status: "succeeded" }).success,
    ).toBe(false);
    expect(
      runnerCompleteRequestSchema.safeParse({ status: "failed" }).success,
    ).toBe(false);
    expect(
      runnerCompleteRequestSchema.safeParse({
        status: "failed",
        failure: { code: "no-result", message: "missing" },
      }).success,
    ).toBe(true);
  });
});
