import { describe, expect, it } from "bun:test";
import type { LatexReferenceSuggestion } from "@repo/schemas";
import {
  type LatexEvidencePassage,
  verifyLatexDataCandidate,
} from "./latex-data-point-validation";

const reference: LatexReferenceSuggestion = {
  source: "openalex",
  paperId: null,
  openAlexId: "W123",
  doi: "10.1000/test",
  arxivId: null,
  title: "Measured system performance",
  abstract: "The system reached 98% accuracy on the held-out benchmark.",
  authors: [{ literal: "A. Researcher" }],
  paperType: "article",
  year: 2025,
  venue: "Journal of Tests",
  publisher: "Test Publisher",
  citationCount: 10,
  isOpenAccess: true,
  openAccessStatus: "gold",
  license: "cc-by",
  url: "https://example.com/paper",
  matchRationale: "OpenAlex semantic match",
  citationKey: null,
  alreadyInPapers: false,
};

const passage: LatexEvidencePassage = {
  id: "source-1",
  text: reference.abstract as string,
  page: null,
  section: "Abstract",
  reference,
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "source-1",
    value: "98",
    unit: "%",
    population: "held-out benchmark",
    geography: null,
    period: null,
    methodologyQualifier: null,
    supportingPassage:
      "The system reached 98% accuracy on the held-out benchmark.",
    ...overrides,
  };
}

describe("LaTeX data-point evidence validation", () => {
  it("accepts a value and unit copied from an exact source passage", () => {
    const result = verifyLatexDataCandidate(
      candidate(),
      new Map([[passage.id, passage]]),
    );
    expect(result).toMatchObject({ value: "98", unit: "%", verified: true });
    expect(result?.reference.openAlexId).toBe("W123");
  });

  it("rejects a fabricated value even when the supporting quote is exact", () => {
    expect(
      verifyLatexDataCandidate(
        candidate({ value: "99" }),
        new Map([[passage.id, passage]]),
      ),
    ).toBeNull();
  });

  it("rejects paraphrased evidence and unit mismatches", () => {
    expect(
      verifyLatexDataCandidate(
        candidate({ supportingPassage: "Accuracy was 98% on the benchmark." }),
        new Map([[passage.id, passage]]),
      ),
    ).toBeNull();
    expect(
      verifyLatexDataCandidate(
        candidate({ unit: "percent" }),
        new Map([[passage.id, passage]]),
      ),
    ).toBeNull();
  });
});
