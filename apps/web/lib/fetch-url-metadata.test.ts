import { describe, expect, it } from "bun:test";
import { extractAcademicMetadata } from "./fetch-url-metadata";

describe("academic URL metadata", () => {
  it("detects publisher DOI, arXiv, and PDF citation tags", () => {
    const html = `
      <meta name="citation_doi" content="10.1000/example">
      <meta content="2401.12345" name="citation_arxiv_id">
      <meta name="citation_pdf_url" content="/papers/example.pdf">
    `;

    expect(
      extractAcademicMetadata(html, "https://publisher.example/article/1"),
    ).toEqual({
      doi: "10.1000/example",
      arxivId: "2401.12345",
      pdfUrl: "https://publisher.example/papers/example.pdf",
    });
  });
});
