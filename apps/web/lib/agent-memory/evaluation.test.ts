import { describe, expect, it } from "bun:test";
import { applyMemoryEvaluation, type MemoryEvaluation } from "./evaluation";

const candidate = {
  confidence: 0.95,
  memoryType: "semantic" as const,
  explicitness: "explicit" as const,
  sensitivity: "standard" as const,
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
  it("replaces the self-reported confidence with the measured one", () => {
    const applied = applyMemoryEvaluation(
      candidate,
      evaluation({ supported: 0.42 }),
    );
    expect(applied.confidence).toBe(0.42);
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

  it("keeps the flags it was given", () => {
    const applied = applyMemoryEvaluation(
      { ...candidate, reviewFlags: ["conflict"] },
      evaluation({}),
    );
    expect(applied.reviewFlags).toEqual(["conflict"]);
  });
});
