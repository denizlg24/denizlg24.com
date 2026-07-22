import { describe, expect, it } from "bun:test";
import {
  latexDataPointSearchResponseSchema,
  restoreLatexProjectHistorySchema,
} from "./index";

describe("LaTeX data and history contracts", () => {
  it("requires evidence candidates to be explicitly verified", () => {
    const result = latexDataPointSearchResponseSchema.safeParse({
      intent: {
        metric: "accuracy",
        population: null,
        geography: null,
        period: null,
        comparison: null,
        desiredUnit: "%",
      },
      inspectedPassages: 1,
      rejectedCandidates: 0,
      candidates: [
        {
          id: "e771ae31-2bd7-41f4-b6af-d56459b93a57",
          value: "98",
          unit: "%",
          population: null,
          geography: null,
          period: null,
          methodologyQualifier: null,
          supportingPassage: "The method achieved 98% accuracy.",
          page: null,
          section: "Abstract",
          verified: false,
          reference: {},
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires an optimistic base revision when restoring history", () => {
    expect(
      restoreLatexProjectHistorySchema.safeParse({
        baseRevision: 7,
        snapshotId: "snapshot-id",
      }).success,
    ).toBe(true);
    expect(
      restoreLatexProjectHistorySchema.safeParse({ snapshotId: "snapshot-id" })
        .success,
    ).toBe(false);
  });
});
