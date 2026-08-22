import { describe, expect, it } from "bun:test";
import { normalizeIsbn } from "./paper-citations";
import {
  findMatchingCrossrefWork,
  isSemanticScholarPaperUrl,
  mapCrossrefWork,
  mapGoogleBooksVolume,
  mapOpenLibraryBook,
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

  it("normalizes ISBNs and rejects bad check digits", () => {
    expect(normalizeIsbn("ISBN 978-0-262-03384-8")).toBe("9780262033848");
    expect(normalizeIsbn("0-13-110362-8")).toBe("0131103628");
    expect(normalizeIsbn("080442957X")).toBe("080442957X");
    expect(normalizeIsbn("978-0-262-03384-7")).toBeUndefined();
    expect(normalizeIsbn("10.1000/example")).toBeUndefined();
  });

  it("maps Google Books volumes, joining the subtitle into the title", () => {
    const result = mapGoogleBooksVolume({
      volumeInfo: {
        title: "Deep Learning",
        subtitle: "Adaptive Computation and Machine Learning",
        authors: ["Ian Goodfellow", "Bourbaki"],
        publisher: "MIT Press",
        publishedDate: "2016-11-18",
        description: "A textbook.",
        pageCount: 800,
        language: "en",
        industryIdentifiers: [
          { type: "ISBN_13", identifier: "9780262035613" },
          { type: "OTHER", identifier: "OCLC:955778308" },
        ],
      },
    });

    expect(result.title).toBe(
      "Deep Learning: Adaptive Computation and Machine Learning",
    );
    expect(result.type).toBe("book");
    expect(result.year).toBe(2016);
    expect(result.pages).toBe("800");
    expect(result.isbn).toEqual(["9780262035613"]);
    expect(result.authors).toEqual([
      { family: "Goodfellow", given: "Ian" },
      { literal: "Bourbaki" },
    ]);
    expect(result.metadataSource).toBe("google_books");
  });

  it("takes a bare year from Open Library without inventing a date", () => {
    const result = mapOpenLibraryBook({
      title: "Structure and Interpretation of Computer Programs",
      authors: [{ name: "Harold Abelson" }],
      publishers: [{ name: "MIT Press" }],
      publish_date: "1996",
      number_of_pages: 657,
      identifiers: { isbn_13: ["9780262510875"], isbn_10: ["0262510871"] },
    });

    expect(result.year).toBe(1996);
    expect(result.publishedDate).toBeUndefined();
    expect(result.isbn).toEqual(["9780262510875", "0262510871"]);
    expect(result.metadataSource).toBe("open_library");
  });

  it("matches Semantic Scholar hosts on a domain boundary, rejecting spoofs", () => {
    expect(
      isSemanticScholarPaperUrl("https://www.semanticscholar.org/paper/abc123"),
    ).toBe(true);
    expect(
      isSemanticScholarPaperUrl("https://semanticscholar.org/paper/abc123"),
    ).toBe(true);
    expect(
      isSemanticScholarPaperUrl("https://notsemanticscholar.org/paper/abc123"),
    ).toBe(false);
  });
});
