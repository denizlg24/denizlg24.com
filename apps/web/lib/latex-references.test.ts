import { describe, expect, it, mock } from "bun:test";
import type { ILatexProject, LatexReferenceSuggestion } from "@repo/schemas";

mock.module("server-only", () => ({}));

const { isAlreadyCited, projectCitationIndex } = await import(
  "./latex-reference-citations"
);

function suggestion(
  overrides: Partial<LatexReferenceSuggestion> = {},
): LatexReferenceSuggestion {
  return {
    source: "openalex",
    paperId: null,
    openAlexId: "W123",
    doi: "10.1000/example",
    arxivId: null,
    title: "A useful cited paper",
    abstract: null,
    authors: [],
    paperType: "article",
    year: 2024,
    venue: "Useful Journal",
    publisher: "Useful Publisher",
    citationCount: 12,
    isOpenAccess: true,
    openAccessStatus: "gold",
    license: null,
    url: "https://example.com/paper",
    matchRationale: "OpenAlex semantic match",
    citationKey: null,
    alreadyInPapers: false,
    ...overrides,
  };
}

function project(tex: string): ILatexProject {
  return {
    version: 1,
    name: "Citation test",
    mainFile: "main.tex",
    entries: [
      {
        id: "8c43fcf9-acb4-420c-a975-e50589498f9b",
        path: "main.tex",
        kind: "file",
        encoding: "utf8",
        content: tex,
      },
      {
        id: "2e28c2cc-2ac1-486d-82ca-38ee972123be",
        path: "references.bib",
        kind: "file",
        encoding: "utf8",
        content: `@article{known2024,
  title = {A useful cited paper},
  doi = {10.1000/example},
  year = {2024}
}`,
      },
    ],
  };
}

describe("LaTeX cited reference detection", () => {
  it("matches cited bibliography entries by DOI or citation key", () => {
    const index = projectCitationIndex(project("Evidence \\cite{known2024}."));

    expect(isAlreadyCited(suggestion(), index)).toBe(true);
    expect(
      isAlreadyCited(
        suggestion({
          doi: null,
          openAlexId: null,
          title: "Different title",
          citationKey: "known2024",
        }),
        index,
      ),
    ).toBe(true);
  });

  it("ignores citations inside LaTeX comments", () => {
    const index = projectCitationIndex(
      project("Visible prose. % \\cite{known2024}"),
    );

    expect(isAlreadyCited(suggestion(), index)).toBe(false);
  });
});
