import { describe, expect, test } from "bun:test";
import {
  buildConsolidationClusters,
  buildReplaceCandidate,
  needsOwnerNamingRewrite,
  parseConsolidationResult,
} from "./consolidation";

describe("owner naming rewrite detection", () => {
  test("flags 'the user' and the owner's name, case-insensitive", () => {
    expect(needsOwnerNamingRewrite("The user prefers dark mode.")).toBe(true);
    expect(needsOwnerNamingRewrite("Deniz finished the degree at FEUP.")).toBe(
      true,
    );
    expect(needsOwnerNamingRewrite("Notes mention deniz explicitly.")).toBe(
      true,
    );
  });

  test("leaves compliant statements and non-owner tokens alone", () => {
    expect(needsOwnerNamingRewrite("Admin prefers dark mode.")).toBe(false);
    expect(
      needsOwnerNamingRewrite("The site denizlg24.com runs on a Raspberry Pi."),
    ).toBe(false);
    expect(
      needsOwnerNamingRewrite("A user of the public blog commented."),
    ).toBe(false);
  });
});

describe("consolidation cluster building", () => {
  test("groups connected neighbors above the threshold and drops singletons", () => {
    const clusters = buildConsolidationClusters(
      ["a", "b", "z"],
      new Map([
        ["a", [{ memoryId: "b", similarity: 0.9 }]],
        ["b", [{ memoryId: "c", similarity: 0.8 }]],
        ["z", [{ memoryId: "y", similarity: 0.5 }]],
      ]),
      { minSimilarity: 0.75 },
    );
    expect(clusters).toEqual([["a", "b", "c"]]);
  });

  test("ignores self references and caps cluster size", () => {
    const clusters = buildConsolidationClusters(
      ["a"],
      new Map([
        [
          "a",
          [
            { memoryId: "a", similarity: 1 },
            { memoryId: "b", similarity: 0.9 },
            { memoryId: "c", similarity: 0.9 },
            { memoryId: "d", similarity: 0.9 },
          ],
        ],
      ]),
      { minSimilarity: 0.75, maxClusterSize: 2 },
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });
});

describe("replace candidate construction", () => {
  const older = {
    id: "old",
    statement: "Admin is studying at FEUP.",
    memoryType: "semantic" as const,
    explicitness: "explicit" as const,
    confidence: 0.6,
    importance: 0.9,
    trust: "high" as const,
    sensitivity: "personal" as const,
    temporal: { precision: "unknown" as const },
    entityRefs: [
      { entityType: "other" as const, entityId: "feup", label: "FEUP" },
    ],
    evidenceIds: ["11111111-1111-4111-8111-111111111111"],
    createdAt: new Date("2025-01-01"),
  };
  const newer = {
    id: "new",
    statement: "Admin finished the degree at FEUP.",
    memoryType: "core" as const,
    explicitness: "explicit" as const,
    confidence: 0.9,
    importance: 0.5,
    trust: "high" as const,
    sensitivity: "personal" as const,
    temporal: { precision: "day" as const },
    entityRefs: [
      { entityType: "other" as const, entityId: "feup", label: "FEUP" },
      { entityType: "person" as const, entityId: "owner", label: "Admin" },
    ],
    evidenceIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
    createdAt: new Date("2026-06-01"),
  };

  test("survivor inherits the newest shape and pessimistic bounds", () => {
    const candidate = buildReplaceCandidate(
      {
        statement: "Admin finished the degree at FEUP in 2026.",
        reason: "Newer memory supersedes the study-in-progress fact",
      },
      [older, newer],
    );
    expect(candidate.statement).toBe(
      "Admin finished the degree at FEUP in 2026.",
    );
    expect(candidate.memoryType).toBe("core");
    expect(candidate.temporal).toEqual({ precision: "day" });
    expect(candidate.confidence).toBe(0.9);
    expect(candidate.importance).toBe(0.9);
    expect(candidate.evidenceIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(candidate.entityRefs).toHaveLength(2);
    expect(candidate.conflictingMemoryIds).toEqual(["old", "new"]);
    expect(candidate.reviewFlags).toEqual(["consolidation"]);
  });
});

describe("consolidation result parsing", () => {
  test("accepts well-formed actions and rejects unknown verbs", () => {
    expect(
      parseConsolidationResult({
        actions: [
          {
            action: "replace",
            memoryIds: ["a", "b"],
            statement: "Admin finished the degree at FEUP.",
            confidence: 0.95,
            reason: "duplicate",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      parseConsolidationResult({
        actions: [
          {
            action: "delete",
            memoryIds: ["a"],
            statement: "x",
            confidence: 1,
            reason: "nope",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
