import { describe, expect, it } from "bun:test";
import {
  type JevAnswer,
  jevConfidence,
  jevIsTrue,
  jevRoundProbabilities,
  jevTopProbability,
} from "./jev";

const choice = (probabilities: Record<string, number>): JevAnswer => ({
  type: "choice",
  choice:
    Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
  probabilities,
});

describe("jevConfidence", () => {
  it("is the gap between the top two options", () => {
    expect(jevConfidence(choice({ a: 0.61, b: 0.35, c: 0.04 }))).toBeCloseTo(
      0.26,
    );
    expect(jevConfidence(choice({ a: 1, b: 0, c: 0 }))).toBe(1);
  });

  it("separates a decided split from an even one at the same top-1", () => {
    // Both peak at 0.45; only the first actually picked something.
    const decided = choice({ a: 0.45, b: 0.1, c: 0.1, d: 0.35 });
    const torn = choice({ a: 0.45, b: 0.44, c: 0.06, d: 0.05 });
    expect(jevTopProbability(decided)).toBe(jevTopProbability(torn));
    expect(jevConfidence(decided)).toBeGreaterThan(jevConfidence(torn));
  });

  it("measures a boolean's distance from the coin flip", () => {
    expect(jevConfidence({ type: "boolean", probability: 0.5 })).toBe(0);
    expect(jevConfidence({ type: "boolean", probability: 0.95 })).toBeCloseTo(
      0.9,
    );
    expect(jevConfidence({ type: "boolean", probability: 0.05 })).toBeCloseTo(
      0.9,
    );
  });

  it("reads a missing distribution as undecided, never as certain", () => {
    expect(jevConfidence({ type: "choice", choice: "a" })).toBe(0);
    expect(jevConfidence({ type: "score", score: 1.4 })).toBe(0);
  });

  it("calls a single option decided", () => {
    expect(jevConfidence(choice({ only: 1 }))).toBe(1);
  });

  it("ranks score levels the same way", () => {
    const answer: JevAnswer = {
      type: "score",
      score: 1.4,
      probabilities: { "0": 0.1, "1": 0.55, "2": 0.35 },
    };
    expect(jevConfidence(answer)).toBeCloseTo(0.2);
  });
});

describe("jevIsTrue", () => {
  it("needs both sides: true, and decided", () => {
    expect(jevIsTrue({ type: "boolean", probability: 0.9 }, 0.5)).toBe(true);
    expect(jevIsTrue({ type: "boolean", probability: 0.6 }, 0.5)).toBe(false);
    expect(jevIsTrue({ type: "boolean", probability: 0.05 }, 0.5)).toBe(false);
  });
});

describe("jevRoundProbabilities", () => {
  it("rounds for storage and passes through nothing", () => {
    expect(jevRoundProbabilities({ a: 0.123456, b: 0.876544 })).toEqual({
      a: 0.123,
      b: 0.877,
    });
    expect(jevRoundProbabilities(undefined)).toBeUndefined();
  });
});
