import { describe, expect, it } from "bun:test";
import { matchBranchPattern, matchBranchRule } from "@repo/schemas/cloud";

import type { DeployBranchRuleRow } from "../db/schema";
import { environmentMemory, resolveBranchRoute } from "./environments";

function rule(overrides: Partial<DeployBranchRuleRow>): DeployBranchRuleRow {
  return {
    id: crypto.randomUUID(),
    targetId: "00000000-0000-0000-0000-000000000001",
    environmentId: "00000000-0000-0000-0000-0000000000aa",
    matchType: "exact",
    pattern: "staging",
    priority: 100,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("matchBranchPattern", () => {
  it("matches exactly when the type says exact", () => {
    expect(matchBranchPattern("staging", "exact", "staging")).toBe(true);
    expect(matchBranchPattern("staging", "exact", "staging-2")).toBe(false);
    // A glob character in an exact pattern is a literal, not a wildcard.
    expect(matchBranchPattern("release/*", "exact", "release/1.2")).toBe(false);
  });

  it("spans slashes, because branch names are paths", () => {
    expect(matchBranchPattern("release/*", "glob", "release/1.2")).toBe(true);
    expect(matchBranchPattern("release/*", "glob", "release/2026/01")).toBe(
      true,
    );
    expect(matchBranchPattern("release/*", "glob", "hotfix/1.2")).toBe(false);
  });

  it("anchors both ends", () => {
    expect(matchBranchPattern("qa-*", "glob", "qa-one")).toBe(true);
    expect(matchBranchPattern("qa-*", "glob", "pre-qa-one")).toBe(false);
  });

  it("treats regex metacharacters as literals", () => {
    expect(matchBranchPattern("v1.0", "glob", "v1.0")).toBe(true);
    expect(matchBranchPattern("v1.0", "glob", "v1x0")).toBe(false);
    expect(matchBranchPattern("feat+x", "glob", "feat+x")).toBe(true);
  });

  it("matches one character with ?", () => {
    expect(matchBranchPattern("v?", "glob", "v1")).toBe(true);
    expect(matchBranchPattern("v?", "glob", "v12")).toBe(false);
  });
});

describe("matchBranchRule", () => {
  it("prefers the lowest priority number", () => {
    const specific = rule({
      pattern: "release/hotfix-*",
      matchType: "glob",
      priority: 10,
      environmentId: "hotfix",
    });
    const broad = rule({
      pattern: "release/*",
      matchType: "glob",
      priority: 20,
      environmentId: "staging",
    });
    expect(matchBranchRule([broad, specific], "release/hotfix-1")?.id).toBe(
      specific.id,
    );
  });

  it("skips disabled rules", () => {
    expect(matchBranchRule([rule({ enabled: false })], "staging")).toBeNull();
  });

  it("keeps the caller's order when priorities tie", () => {
    const first = rule({ pattern: "staging", priority: 100 });
    const second = rule({
      pattern: "stagin?",
      matchType: "glob",
      priority: 100,
    });
    expect(matchBranchRule([first, second], "staging")?.id).toBe(first.id);
  });
});

describe("resolveBranchRoute", () => {
  const config = {
    productionBranch: "main",
    previewDeploys: true,
    rules: [rule({ pattern: "staging", environmentId: "env-staging" })],
  };

  it("sends the production branch to production", () => {
    expect(resolveBranchRoute("main", config)).toEqual({
      kind: "production",
      environmentId: null,
      ruleId: null,
    });
  });

  it("refuses to let a rule divert the production branch", () => {
    const hijack = {
      ...config,
      rules: [rule({ pattern: "main", environmentId: "env-staging" })],
    };
    expect(resolveBranchRoute("main", hijack)?.kind).toBe("production");
  });

  it("sends a matched branch to its environment", () => {
    const route = resolveBranchRoute("staging", config);
    expect(route?.kind).toBe("environment");
    expect(route?.environmentId).toBe("env-staging");
    expect(route?.ruleId).not.toBeNull();
  });

  it("sends everything else to a preview", () => {
    expect(resolveBranchRoute("feat/thing", config)?.kind).toBe("preview");
  });

  it("builds nothing unmatched when previews are off", () => {
    expect(
      resolveBranchRoute("feat/thing", { ...config, previewDeploys: false }),
    ).toBeNull();
    // The rule still applies: previews being off is not "build only main".
    expect(
      resolveBranchRoute("staging", { ...config, previewDeploys: false })?.kind,
    ).toBe("environment");
  });
});

describe("environmentMemory", () => {
  const target = { memoryReservationMb: 512, memoryLimitMb: 2048 };

  it("inherits the target when the environment sets nothing", () => {
    expect(environmentMemory(target, null)).toEqual({
      reservationMb: 512,
      ceilingMb: 2048,
    });
  });

  it("derives a ceiling from the environment's own reservation", () => {
    // The target's explicit 2048 ceiling belongs to the target's 512; carrying
    // it onto a 256 MB environment would leave the rope where it was.
    const memory = environmentMemory(target, {
      memoryReservationMb: 256,
      memoryLimitMb: null,
    });
    expect(memory.reservationMb).toBe(256);
    expect(memory.ceilingMb).toBeLessThan(2048);
  });

  it("takes an explicit environment ceiling", () => {
    expect(
      environmentMemory(target, {
        memoryReservationMb: 256,
        memoryLimitMb: 700,
      }),
    ).toEqual({ reservationMb: 256, ceilingMb: 700 });
  });
});
