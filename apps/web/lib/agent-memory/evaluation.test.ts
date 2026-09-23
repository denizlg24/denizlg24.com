import { describe, expect, it } from "bun:test";
import { applyMemoryEvaluation, type MemoryEvaluation } from "./evaluation";

const candidate = {
  confidence: 0.95,
  memoryType: "semantic" as const,
  explicitness: "explicit" as const,
  sensitivity: "standard" as const,
  trust: "high" as const,
  reviewFlags: [] as never[],
};

const evaluation = (
  overrides: Partial<MemoryEvaluation>,
): MemoryEvaluation => ({
  model: "typesafe-ai/jev",
  supported: 0.8,
  memoryType: null,
  explicitness: null,
  sensitivity: null,
  permissionLike: false,
  ...overrides,
});

describe("applyMemoryEvaluation", () => {
  it("takes the measured confidence when it is lower", () => {
    const applied = applyMemoryEvaluation(
      candidate,
      evaluation({ supported: 0.42 }),
    );
    expect(applied.confidence).toBe(0.42);
  });

  it("never lets a measurement raise the confidence", () => {
    // The extraction model was unsure; Jev being certain must not push the
    // candidate over a promotion threshold on its own.
    const applied = applyMemoryEvaluation(
      { ...candidate, confidence: 0.4 },
      evaluation({ supported: 0.99 }),
    );
    expect(applied.confidence).toBe(0.4);
  });

  it("adopts a decided memory type", () => {
    expect(
      applyMemoryEvaluation(candidate, evaluation({ memoryType: "episodic" }))
        .memoryType,
    ).toBe("episodic");
  });

  it("keeps the extraction model's type when the choice was undecided", () => {
    expect(
      applyMemoryEvaluation(candidate, evaluation({ memoryType: null }))
        .memoryType,
    ).toBe("semantic");
  });

  it("moves explicitness down but never up", () => {
    expect(
      applyMemoryEvaluation(
        candidate,
        evaluation({ explicitness: "hypothesis" }),
      ).explicitness,
    ).toBe("hypothesis");
    expect(
      applyMemoryEvaluation(
        { ...candidate, explicitness: "hypothesis" },
        evaluation({ explicitness: "explicit" }),
      ).explicitness,
    ).toBe("hypothesis");
  });

  it("moves sensitivity up but never down", () => {
    expect(
      applyMemoryEvaluation(candidate, evaluation({ sensitivity: "sensitive" }))
        .sensitivity,
    ).toBe("sensitive");
    expect(
      applyMemoryEvaluation(
        { ...candidate, sensitivity: "sensitive" },
        evaluation({ sensitivity: "standard" }),
      ).sensitivity,
    ).toBe("sensitive");
  });

  it("flags a downgrade from explicit as a weak inference", () => {
    const applied = applyMemoryEvaluation(
      candidate,
      evaluation({ explicitness: "inferred" }),
    );
    expect(applied.reviewFlags).toContain("weak-inference");
  });

  it("flags permission-like content the regex would miss", () => {
    const applied = applyMemoryEvaluation(
      candidate,
      evaluation({ permissionLike: true }),
    );
    expect(applied.reviewFlags).toContain("permission-like");
  });

  it("re-flags an untrusted candidate that Jev moves to core", () => {
    const applied = applyMemoryEvaluation(
      { ...candidate, trust: "untrusted" },
      evaluation({ memoryType: "core" }),
    );
    expect(applied.memoryType).toBe("core");
    expect(applied.reviewFlags).toContain("weak-inference");
  });

  it("does not flag a trusted candidate moved to core", () => {
    const applied = applyMemoryEvaluation(
      candidate,
      evaluation({ memoryType: "core" }),
    );
    expect(applied.reviewFlags).not.toContain("weak-inference");
  });

  it("keeps the flags it was given", () => {
    const applied = applyMemoryEvaluation(
      { ...candidate, reviewFlags: ["conflict"] },
      evaluation({}),
    );
    expect(applied.reviewFlags).toEqual(["conflict"]);
  });
});
