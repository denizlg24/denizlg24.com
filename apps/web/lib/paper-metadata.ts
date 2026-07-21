import type {
  PaperAuthor,
  PaperType,
  ResolvedPaperMetadata,
} from "@repo/schemas";
import { normalizeArxivId, normalizeDoi } from "@/lib/paper-citations";

interface CrossrefPerson {
  family?: string;
  given?: string;
  name?: string;
  ORCID?: string;
}

interface CrossrefDateParts {
  "date-parts"?: number[][];
}

const ACADEMIC_PROVIDER_HOSTS = [
  "ieeexplore.ieee.org",
  "semanticscholar.org",
  "dl.acm.org",
  "link.springer.com",
  "nature.com",
  "sciencedirect.com",
  "onlinelibrary.wiley.com",
  "jstor.org",
  "pubmed.ncbi.nlm.nih.gov",
  "biorxiv.org",
  "medrxiv.org",
  "openreview.net",
  "papers.ssrn.com",
] as const;

export function isAcademicPaperProviderUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ACADEMIC_PROVIDER_HOSTS.some(
      (provider) => hostname === provider || hostname.endsWith(`.${provider}`),
    );
  } catch {
    return false;
  }
}

export interface CrossrefWork {
  title?: string[];
  author?: CrossrefPerson[];
  abstract?: string;
  type?: string;
  published?: CrossrefDateParts;
  "published-print"?: CrossrefDateParts;
  "published-online"?: CrossrefDateParts;
  "container-title"?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  language?: string;
  ISBN?: string[];
  ISSN?: string[];
  DOI?: string;
  URL?: string;
  "is-referenced-by-count"?: number;
}

export interface SemanticScholarPaper {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  venue?: string | null;
  citationCount?: number | null;
  url?: string | null;
  authors?: Array<{ authorId?: string | null; name?: string }>;
  externalIds?: { ArXiv?: string; DOI?: string } | null;
  openAccessPdf?: { url?: string | null } | null;
  publicationTypes?: string[] | null;
  journal?: {
    name?: string | null;
    pages?: string | null;
    volume?: string | null;
  } | null;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function mapCrossrefType(value?: string): PaperType {
  switch (value) {
    case "journal-article":
    case "posted-content":
      return "article";
    case "proceedings-article":
    case "proceedings":
      return "conference";
    case "book":
    case "monograph":
    case "edited-book":
      return "book";
    case "book-chapter":
    case "reference-entry":
      return "chapter";
    case "dissertation":
      return "thesis";
    case "report":
    case "report-series":
      return "report";
    case "dataset":
      return "dataset";
    default:
      return "other";
  }
}

function mapSemanticScholarType(values?: string[] | null): PaperType {
  if (values?.includes("JournalArticle")) return "article";
  if (values?.includes("Conference")) return "conference";
  if (values?.includes("Book")) return "book";
  if (values?.includes("BookSection")) return "chapter";
  if (values?.includes("Dataset")) return "dataset";
  return "other";
}

function datePartsToIso(parts?: number[]): string | undefined {
  if (!parts?.[0]) return undefined;
  const year = parts[0];
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const value = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

function crossrefAuthors(people: CrossrefPerson[] | undefined): PaperAuthor[] {
  return (people ?? []).flatMap((person) => {
    const author = {
      family: person.family?.trim() || undefined,
      given: person.given?.trim() || undefined,
      literal: person.name?.trim() || undefined,
      orcid: person.ORCID?.replace(/^https?:\/\/orcid\.org\//, "") || undefined,
    };
    return author.family || author.given || author.literal ? [author] : [];
  });
}

export function mapCrossrefWork(work: CrossrefWork): ResolvedPaperMetadata {
  const dateParts =
    work["published-print"]?.["date-parts"]?.[0] ??
    work["published-online"]?.["date-parts"]?.[0] ??
    work.published?.["date-parts"]?.[0];
  const title = stripMarkup(work.title?.[0] ?? "");
  if (!title) throw new Error("Crossref record has no title");
  const doi = work.DOI ? normalizeDoi(work.DOI) : undefined;

  return {
    title,
    authors: crossrefAuthors(work.author),
    abstract: work.abstract ? stripMarkup(work.abstract) : undefined,
    type: mapCrossrefType(work.type),
    year: dateParts?.[0],
    publishedDate: datePartsToIso(dateParts),
    venue: work["container-title"]?.[0]?.trim() || undefined,
    publisher: work.publisher?.trim() || undefined,
    volume: work.volume?.trim() || undefined,
    issue: work.issue?.trim() || undefined,
    pages: work.page?.trim() || undefined,
    language: work.language?.trim() || undefined,
    isbn: work.ISBN ?? [],
    issn: work.ISSN ?? [],
    doi,
    citationCount: work["is-referenced-by-count"],
    url: doi ? `https://doi.org/${doi}` : work.URL,
    metadataSource: "crossref",
    metadataFetchedAt: new Date().toISOString(),
  };
}

function decodeXml(value: string): string {
  return stripMarkup(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(\d+);/g, (_match, code: string) =>
        String.fromCodePoint(Number(code)),
      )
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
        String.fromCodePoint(Number.parseInt(code, 16)),
      ),
  );
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match?.[1] ? decodeXml(match[1]) : undefined;
}

function attributeValue(
  fragment: string,
  attribute: string,
): string | undefined {
  const match = fragment.match(
    new RegExp(`${attribute}=["']([^"']+)["']`, "i"),
  );
  return match?.[1] ? decodeXml(match[1]) : undefined;
}

export function parseArxivFeed(xml: string): ResolvedPaperMetadata {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];
  if (!entry) throw new Error("arXiv record not found");

  const idUrl = tagValue(entry, "id") ?? "";
  const arxivId = normalizeArxivId(idUrl);
  const title = tagValue(entry, "title");
  if (!arxivId || !title) throw new Error("Invalid arXiv record");

  const authorFragments = [...entry.matchAll(/<author>([\s\S]*?)<\/author>/gi)];
  const authors = authorFragments.flatMap((match) => {
    const literal = match[1] ? tagValue(match[1], "name") : undefined;
    return literal ? [{ literal }] : [];
  });
  const published = tagValue(entry, "published");
  const publishedDate = published
    ? new Date(published).toISOString()
    : undefined;
  const categoryFragment = entry.match(/<category\s[^>]*\/>/i)?.[0];
  const arxivCategory = categoryFragment
    ? attributeValue(categoryFragment, "term")
    : undefined;
  const doi = tagValue(entry, "arxiv:doi");

  return {
    title,
    authors,
    abstract: tagValue(entry, "summary"),
    type: "preprint",
    year: publishedDate ? new Date(publishedDate).getUTCFullYear() : undefined,
    publishedDate,
    doi: doi ? normalizeDoi(doi) : undefined,
    arxivId,
    arxivCategory,
    url: `https://arxiv.org/abs/${arxivId}`,
    metadataSource: "arxiv",
    metadataFetchedAt: new Date().toISOString(),
  };
}

export function isSemanticScholarPaperUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname.toLowerCase().endsWith("semanticscholar.org") &&
      url.pathname.toLowerCase().startsWith("/paper/")
    );
  } catch {
    return false;
  }
}

function semanticScholarPaperId(value: string): string | undefined {
  if (!isSemanticScholarPaperUrl(value)) return undefined;
  try {
    return new URL(value).pathname.match(/\/([a-f0-9]{40})\/?$/i)?.[1];
  } catch {
    return undefined;
  }
}

function normalizedTitle(value: string): string {
  return stripMarkup(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function titleMatches(query: string, candidate: string): boolean {
  const normalizedQuery = normalizedTitle(query);
  const normalizedCandidate = normalizedTitle(candidate);
  return (
    normalizedQuery === normalizedCandidate ||
    (normalizedCandidate.length >= 3 &&
      normalizedCandidate.length <= 12 &&
      normalizedQuery.startsWith(normalizedCandidate))
  );
}

export function findMatchingCrossrefWork(
  title: string,
  works: CrossrefWork[],
): CrossrefWork | undefined {
  return works.find((work) =>
    work.title?.[0] ? titleMatches(title, work.title[0]) : false,
  );
}

export function mapSemanticScholarPaper(
  paper: SemanticScholarPaper,
): ResolvedPaperMetadata {
  const title = paper.title?.trim();
  if (!title) throw new Error("Semantic Scholar record has no title");
  const doi = paper.externalIds?.DOI
    ? normalizeDoi(paper.externalIds.DOI)
    : undefined;
  const arxivId = paper.externalIds?.ArXiv
    ? normalizeArxivId(paper.externalIds.ArXiv)
    : undefined;
  const pdfUrl = paper.openAccessPdf?.url || undefined;
  const publishedDate = paper.publicationDate
    ? new Date(paper.publicationDate).toISOString()
    : undefined;

  return {
    title,
    authors: (paper.authors ?? []).flatMap((author) =>
      author.name?.trim() ? [{ literal: author.name.trim() }] : [],
    ),
    abstract: paper.abstract?.trim() || undefined,
    type: mapSemanticScholarType(paper.publicationTypes),
    year:
      paper.year ??
      (publishedDate ? new Date(publishedDate).getUTCFullYear() : undefined),
    publishedDate,
    venue: paper.venue?.trim() || paper.journal?.name?.trim() || undefined,
    volume: paper.journal?.volume?.trim() || undefined,
    pages: paper.journal?.pages?.trim() || undefined,
    doi,
    arxivId,
    citationCount: paper.citationCount ?? undefined,
    url:
      paper.url ||
      (paper.paperId
        ? `https://www.semanticscholar.org/paper/${paper.paperId}`
        : undefined),
    pdf: pdfUrl
      ? {
          url: pdfUrl,
          fileName: `${paper.paperId || "paper"}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 0,
        }
      : undefined,
    metadataSource: "semantic_scholar",
    metadataFetchedAt: new Date().toISOString(),
  };
}

async function fetchWithTimeout(
  url: string,
  accept: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "denizlg24-paper-library/1.0 (https://denizlg24.com)",
  };
  if (
    url.startsWith("https://api.semanticscholar.org/") &&
    process.env.SEMANTIC_SCHOLAR_API_KEY
  ) {
    headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  return fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
}

export async function resolvePaperMetadataByTitle(
  title: string,
): Promise<ResolvedPaperMetadata> {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=10`;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetchWithTimeout(url, "application/json");
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  if (!response?.ok) throw new Error("Crossref title lookup failed");
  const payload = (await response.json()) as {
    message?: { items?: CrossrefWork[] };
  };
  const match = findMatchingCrossrefWork(title, payload.message?.items ?? []);
  if (!match) throw new Error("No exact Crossref title match");
  return mapCrossrefWork(match);
}

export async function resolvePaperMetadata(
  identifier: string,
): Promise<ResolvedPaperMetadata> {
  const doi = normalizeDoi(identifier);
  if (doi) {
    const response = await fetchWithTimeout(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      "application/json",
    );
    if (response.status === 404) throw new Error("DOI not found");
    if (!response.ok) throw new Error("Crossref lookup failed");
    const payload = (await response.json()) as { message?: CrossrefWork };
    if (!payload.message) throw new Error("Invalid Crossref response");
    return mapCrossrefWork(payload.message);
  }

  const arxivId = normalizeArxivId(identifier);
  if (arxivId) {
    const response = await fetchWithTimeout(
      `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
      "application/atom+xml",
    );
    if (!response.ok) throw new Error("arXiv lookup failed");
    return parseArxivFeed(await response.text());
  }

  if (isSemanticScholarPaperUrl(identifier)) {
    const fields = [
      "title",
      "authors",
      "abstract",
      "year",
      "publicationDate",
      "venue",
      "citationCount",
      "externalIds",
      "url",
      "openAccessPdf",
      "publicationTypes",
      "journal",
    ].join(",");
    const response = await fetchWithTimeout(
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(semanticScholarPaperId(identifier) ?? `URL:${identifier}`)}?fields=${fields}`,
      "application/json",
    );
    if (response.status === 404)
      throw new Error("Semantic Scholar paper not found");
    if (!response.ok) throw new Error("Semantic Scholar lookup failed");
    return mapSemanticScholarPaper(
      (await response.json()) as SemanticScholarPaper,
    );
  }

  throw new Error("Enter a DOI, arXiv identifier, or Semantic Scholar URL");
}
