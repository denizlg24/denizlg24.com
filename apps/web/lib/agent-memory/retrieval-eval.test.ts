import { describe, expect, test } from "bun:test";
import {
  retrievalEvaluationPasses,
  runRetrievalEvaluation,
} from "./retrieval-eval";

describe("agent memory retrieval evaluation", () => {
  test("passes every initial synthetic Gate C threshold", () => {
    const metrics = runRetrievalEvaluation();
    expect(metrics).toEqual({
      evaluatedQueries: 7,
      provenanceCoverage: 1,
      exclusionCoverage: 1,
      maliciousPromotions: 0,
      recallAt10: 1,
      temporalAccuracy: 1,
      abstentionAccuracy: 1,
      budgetViolations: 0,
    });
    expect(retrievalEvaluationPasses(metrics)).toBe(true);
  });
});
