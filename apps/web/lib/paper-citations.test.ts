import { describe, expect, it } from "bun:test";
import {
  generateBibtex,
  generateCitationKey,
  normalizeArxivId,
  normalizeDoi,
} from "./paper-citations";

describe("paper citation helpers", () => {
  it("normalizes DOI and arXiv identifiers", () => {
    expect(normalizeDoi("https://doi.org/10.1145/123.456")).toBe(
      "10.1145/123.456",
    );
    expect(normalizeArxivId("https://arxiv.org/pdf/2401.12345v2.pdf")).toBe(
      "2401.12345",
    );
    expect(normalizeDoi("not-a-doi")).toBeUndefined();
  });

  it("builds stable citation keys", () => {
    expect(
      generateCitationKey({
        authors: [{ family: "Güneş", given: "Deniz" }],
        title: "The Practical Paper Library",
        year: 2026,
      }),
    ).toBe("gunes2026practical");
  });

  it("renders BibTeX with academic identifiers", () => {
    const bibtex = generateBibtex({
      title: "Research & Notes",
      authors: [{ family: "Güneş", given: "Deniz" }],
      type: "preprint",
      year: 2026,
      isbn: [],
      issn: [],
      citationKey: "gunes2026research",
      arxivId: "2601.01234",
      arxivCategory: "cs.HC",
      doi: "10.1000/example",
      url: "https://arxiv.org/abs/2601.01234",
    });
    expect(bibtex).toContain("@misc{gunes2026research");
    expect(bibtex).toContain("Research \\& Notes");
    expect(bibtex).toContain("archivePrefix = {arXiv}");
  });

  it("escapes backslashes without corrupting the brace group", () => {
    const bibtex = generateBibtex({
      title: "Windows C:\\Users Study",
      authors: [{ literal: "Ada Lovelace" }],
      type: "article",
      year: 2026,
      isbn: [],
      issn: [],
      citationKey: "lovelace2026windows",
    });
    expect(bibtex).toContain("\\textbackslash{}");
    expect(bibtex).not.toContain("\\textbackslash\\{\\}");
  });
});
