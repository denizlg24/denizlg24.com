import type { PaperAuthor, PaperType } from "@repo/schemas";
import type { ILeanPaper } from "@/models/Paper";

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const ARXIV_PATTERN =
  /^(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i;

export function normalizeDoi(input: string): string | undefined {
  let value = input.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the original value when it is not percent-encoded.
  }
  value = value
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .trim();
  return DOI_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

export function normalizeArxivId(input: string): string | undefined {
  const value = input
    .trim()
    .replace(/^arxiv:\s*/i, "")
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/\.pdf$/i, "")
    .trim();
  if (!ARXIV_PATTERN.test(value)) return undefined;
  return value.replace(/v\d+$/i, "").toLowerCase();
}

function authorDisplayName(author: PaperAuthor): string {
  if (author.literal) return author.literal;
  return [author.given, author.family].filter(Boolean).join(" ");
}

function cleanKeyPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function generateCitationKey(input: {
  authors?: PaperAuthor[];
  title: string;
  year?: number;
}): string {
  const firstAuthor = input.authors?.[0];
  const authorPart = firstAuthor
    ? cleanKeyPart(
        firstAuthor.family ||
          firstAuthor.literal ||
          authorDisplayName(firstAuthor),
      )
    : "anon";
  const titleWord = input.title
    .split(/\s+/)
    .map(cleanKeyPart)
    .find(
      (word) =>
        word.length > 2 &&
        !["the", "and", "for", "with", "from"].includes(word),
    );
  return `${authorPart || "anon"}${input.year ?? "nd"}${titleWord || "paper"}`;
}

function escapeBibtex(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&_%#])/g, "\\$1")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\s+/g, " ")
    .trim();
}

function bibtexType(type: PaperType): string {
  switch (type) {
    case "article":
      return "article";
    case "conference":
      return "inproceedings";
    case "preprint":
      return "misc";
    case "thesis":
      return "phdthesis";
    case "book":
      return "book";
    case "chapter":
      return "incollection";
    case "report":
      return "techreport";
    case "dataset":
      return "dataset";
    case "other":
      return "misc";
  }
}

export function generateBibtex(
  paper: Pick<
    ILeanPaper,
    | "title"
    | "authors"
    | "type"
    | "year"
    | "venue"
    | "publisher"
    | "volume"
    | "issue"
    | "pages"
    | "edition"
    | "language"
    | "isbn"
    | "issn"
    | "doi"
    | "arxivId"
    | "arxivCategory"
    | "url"
    | "citationKey"
  >,
): string {
  const fields: Array<[string, string | number | undefined]> = [
    ["title", paper.title],
    [
      "author",
      paper.authors
        .map((author) => {
          if (author.literal) return `{${author.literal}}`;
          return [author.family, author.given].filter(Boolean).join(", ");
        })
        .join(" and "),
    ],
    ["year", paper.year],
    [paper.type === "conference" ? "booktitle" : "journal", paper.venue],
    ["publisher", paper.publisher],
    ["volume", paper.volume],
    ["number", paper.issue],
    ["pages", paper.pages],
    ["edition", paper.edition],
    ["language", paper.language],
    ["isbn", paper.isbn[0]],
    ["issn", paper.issn[0]],
    ["doi", paper.doi],
    ["eprint", paper.arxivId],
    ["archivePrefix", paper.arxivId ? "arXiv" : undefined],
    ["primaryClass", paper.arxivCategory],
    ["url", paper.url],
  ];

  const rendered = fields
    .filter(
      (field): field is [string, string | number] =>
        field[1] !== undefined && field[1] !== "",
    )
    .map(([key, value]) => `  ${key} = {${escapeBibtex(String(value))}}`)
    .join(",\n");

  return `@${bibtexType(paper.type)}{${paper.citationKey},\n${rendered}\n}`;
}

export function serializePaper(paper: ILeanPaper) {
  return {
    ...paper,
    _id: String(paper._id),
    noteId: paper.noteId ? String(paper.noteId) : undefined,
    noteIds: (paper.noteIds ?? []).map(String),
    publishedDate: paper.publishedDate?.toISOString(),
    metadataFetchedAt: paper.metadataFetchedAt?.toISOString(),
    highlights: (paper.highlights ?? []).map((highlight) => ({
      ...highlight,
      createdAt: highlight.createdAt.toISOString(),
    })),
    bibtex: generateBibtex(paper),
  };
}
