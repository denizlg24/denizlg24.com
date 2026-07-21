import { describe, expect, it } from "bun:test";
import {
  findMatchingCrossrefWork,
  mapCrossrefWork,
  mapSemanticScholarPaper,
  parseArxivFeed,
} from "./paper-metadata";

describe("paper metadata", () => {
  it("maps Crossref records", () => {
    const result = mapCrossrefWork({
      title: ["A useful paper"],
      author: [{ given: "Ada", family: "Lovelace" }],
      type: "journal-article",
      DOI: "10.1000/Example",
      "container-title": ["Journal of Tests"],
      published: { "date-parts": [[2025, 2, 3]] },
      "is-referenced-by-count": 12,
    });
    expect(result.doi).toBe("10.1000/example");
    expect(result.year).toBe(2025);
    expect(result.venue).toBe("Journal of Tests");
    expect(result.citationCount).toBe(12);
  });

  it("parses arXiv Atom entries", () => {
    const result = parseArxivFeed(`
      <feed xmlns:arxiv="http://arxiv.org/schemas/atom">
        <entry>
          <id>http://arxiv.org/abs/2401.12345v2</id>
          <title>  Paper &amp; Notes </title>
          <summary>A useful abstract.</summary>
          <published>2024-01-20T00:00:00Z</published>
          <author><name>Ada Lovelace</name></author>
          <category term="cs.HC" />
          <arxiv:doi>10.1000/example</arxiv:doi>
        </entry>
      </feed>
    `);
    expect(result.arxivId).toBe("2401.12345");
    expect(result.title).toBe("Paper & Notes");
    expect(result.authors).toEqual([{ literal: "Ada Lovelace" }]);
    expect(result.arxivCategory).toBe("cs.HC");
  });

  it("maps Semantic Scholar records and open-access PDFs", () => {
    const result = mapSemanticScholarPaper({
      paperId: "abc123",
      title: "A semantic paper",
      authors: [{ name: "Ada Lovelace" }],
      abstract: "An abstract",
      year: 2025,
      publicationDate: "2025-02-03",
      venue: "Test Conference",
      citationCount: 7,
      externalIds: { DOI: "10.1000/Example" },
      openAccessPdf: { url: "https://example.com/paper.pdf" },
      publicationTypes: ["Conference"],
    });

    expect(result.metadataSource).toBe("semantic_scholar");
    expect(result.doi).toBe("10.1000/example");
    expect(result.type).toBe("conference");
    expect(result.pdf?.url).toBe("https://example.com/paper.pdf");
  });

  it("accepts exact and acronym title matches but rejects near matches", () => {
    const works = [
      { title: ["A different mapping paper"], DOI: "10.1000/wrong" },
      { title: ["GEML"], DOI: "10.1000/right" },
    ];
    expect(
      findMatchingCrossrefWork(
        "GEML: GNN-Based Efficient Mapping Method for Large Loop Applications",
        works,
      )?.DOI,
    ).toBe("10.1000/right");
    expect(
      findMatchingCrossrefWork("Unrelated architecture research", works),
    ).toBeUndefined();
  });
});
