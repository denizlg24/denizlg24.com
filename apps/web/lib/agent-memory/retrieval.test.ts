import { describe, expect, test } from "bun:test";
import type { RetrievalMemory } from "./retrieval";
import {
  collectRetrievalSourceSignals,
  hardFilterMemory,
  rankAndBudgetRetrieval,
  retrievalQueryContainsDeniedContent,
  scoreRetrievalCandidate,
} from "./retrieval";

const NOW = new Date("2026-07-13T12:00:00.000Z");

function memory(overrides: Partial<RetrievalMemory> = {}): RetrievalMemory {
  return {
    id: "memory-a",
    revisionId: "000000000000000000000001",
    statement: "Deniz prefers concise technical explanations.",
    memoryType: "semantic",
    status: "active",
    explicitness: "explicit",
    confidence: 0.95,
    importance: 0.8,
    trust: "high",
    sensitivity: "personal",
    evidenceIds: ["evidence-a"],
    contradictionIds: [],
    pinned: false,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("agent memory retrieval", () => {
  test("hard filters inactive, expired, future, and denied memories", () => {
    expect(hardFilterMemory(memory({ status: "deleted" }), { now: NOW })).toBe(
      "status:deleted",
    );
    expect(
      hardFilterMemory(
        memory({ validUntil: new Date("2026-07-13T11:00:00Z") }),
        {
          now: NOW,
        },
      ),
    ).toBe("expired");
    expect(
      hardFilterMemory(
        memory({ validFrom: new Date("2026-07-14T00:00:00Z") }),
        {
          now: NOW,
        },
      ),
    ).toBe("not-yet-valid");
    expect(
      hardFilterMemory(memory({ sensitivity: "denied" }), { now: NOW }),
    ).toBe("sensitivity:denied");
  });

  test("penalizes conflicts, weak trust, and hypotheses deterministically", () => {
    const explicit = scoreRetrievalCandidate(memory(), { vector: 0.9 }, NOW);
    const weak = scoreRetrievalCandidate(
      memory({
        explicitness: "hypothesis",
        trust: "untrusted",
        contradictionIds: ["conflict"],
      }),
      { vector: 0.9 },
      NOW,
    );
    expect(explicit.score).toBeGreaterThan(weak.score);
    expect(weak.components.conflictPenalty).toBe(0.18);
    expect(weak.components.hypothesisPenalty).toBe(0.12);
  });

  test("deduplicates revisions and enforces item and token budgets", () => {
    const result = rankAndBudgetRetrieval(
      [
        { memory: memory(), signals: { vector: 1 } },
        {
          memory: memory({ id: "duplicate" }),
          signals: { vector: 0.9 },
        },
        {
          memory: memory({
            id: "memory-b",
            revisionId: "000000000000000000000002",
            statement: "A".repeat(200),
          }),
          signals: { vector: 0.8 },
        },
      ],
      { maxItems: 2, maxTokens: 60, now: NOW },
    );
    expect(result.selected).toHaveLength(1);
    expect(result.estimatedTokens).toBeLessThanOrEqual(60);
    expect(result.exclusions.map((item) => item.reason)).toContain(
      "duplicate-revision",
    );
    expect(result.exclusions.map((item) => item.reason)).toContain(
      "token-budget",
    );
  });

  test("abstains below the configured relevance threshold", () => {
    const result = rankAndBudgetRetrieval(
      [
        {
          memory: memory({
            confidence: 0,
            importance: 0,
            trust: "untrusted",
            explicitness: "inferred",
            updatedAt: new Date("2020-01-01T00:00:00Z"),
          }),
          signals: { vector: 0.05 },
        },
      ],
      { maxItems: 12, maxTokens: 2_500, now: NOW },
    );
    expect(result.selected).toHaveLength(0);
    expect(result.exclusions[0]?.reason).toBe("below-score-threshold");
  });

  test("excludes relevance-free memories unless they earn a core slot", () => {
    const result = rankAndBudgetRetrieval(
      [
        {
          memory: memory({
            id: "core-1",
            revisionId: "000000000000000000000011",
            memoryType: "core",
          }),
          signals: { structured: 0.8 },
        },
        {
          memory: memory({
            id: "core-2",
            revisionId: "000000000000000000000012",
            memoryType: "core",
          }),
          signals: { structured: 0.8 },
        },
        {
          memory: memory({
            id: "plain",
            revisionId: "000000000000000000000013",
          }),
          signals: { structured: 0.25 },
        },
      ],
      { maxItems: 12, maxTokens: 2_500, now: NOW, maxCoreItems: 1 },
    );
    expect(result.selected.map((item) => item.memory.id)).toEqual(["core-1"]);
    const reasons = result.exclusions.map((item) => item.reason);
    expect(reasons).toContain("core-item-budget");
    expect(reasons).toContain("no-relevance-signal");
  });

  test("suppresses near-duplicates of already-selected memories", () => {
    const result = rankAndBudgetRetrieval(
      [
        { memory: memory(), signals: { vector: 0.9 } },
        {
          memory: memory({
            id: "duplicate-of-a",
            revisionId: "000000000000000000000022",
          }),
          signals: { vector: 0.85 },
        },
        {
          memory: memory({
            id: "distinct",
            revisionId: "000000000000000000000023",
            statement: "Deniz uses bun for every workspace.",
          }),
          signals: { vector: 0.5 },
        },
      ],
      {
        maxItems: 12,
        maxTokens: 2_500,
        now: NOW,
        nearDuplicateStrengths: new Map([
          ["duplicate-of-a", new Map([["memory-a", 0.92]])],
        ]),
      },
    );
    expect(result.selected.map((item) => item.memory.id)).toEqual([
      "memory-a",
      "distinct",
    ]);
    expect(result.exclusions).toContainEqual({
      memoryId: "duplicate-of-a",
      reason: "near-duplicate",
    });
  });

  test("keeps structured and lexical candidates during a vector outage", async () => {
    const result = await collectRetrievalSourceSignals({
      structured: async () => [{ memoryId: "memory-a", score: 0.8 }],
      lexical: async () => [{ memoryId: "memory-b", score: 0.7 }],
      vector: async () => {
        throw new Error("vector backend unavailable");
      },
    });
    expect([...result.signals.keys()]).toEqual(["memory-a", "memory-b"]);
    expect(result.exclusions).toEqual([
      { source: "vector", reason: "backend-unavailable" },
    ]);
  });

  test("detects credential-like retrieval queries for redaction", () => {
    expect(
      retrievalQueryContainsDeniedContent(
        "my api key is sk_1234567890abcdefghijklmnop",
      ),
    ).toBe(true);
    expect(
      retrievalQueryContainsDeniedContent("what project am I building?"),
    ).toBe(false);
  });
});
