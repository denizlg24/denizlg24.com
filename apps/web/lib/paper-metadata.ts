import type {
  PaperAuthor,
  PaperLookupKind,
  PaperType,
  ResolvedPaperMetadata,
} from "@repo/schemas";
import {
  normalizeArxivId,
  normalizeDoi,
  normalizeIsbn,
} from "@/lib/paper-citations";

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
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
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
    const hostname = url.hostname.toLowerCase();
    return (
      (hostname === "semanticscholar.org" ||
        hostname.endsWith(".semanticscholar.org")) &&
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

export interface GoogleBooksVolume {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    language?: string;
    infoLink?: string;
    canonicalVolumeLink?: string;
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
  };
}

export interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_date?: string;
  number_of_pages?: number;
  url?: string;
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
  notes?: string | { value?: string };
  excerpts?: Array<{ text?: string }>;
}

/**
 * Book APIs return one display name per author, so the split is heuristic:
 * everything after the last space is the family name. A single-word name
 * ("Bourbaki", "MIT OpenCourseWare") stays literal rather than becoming a
 * family name with no given name.
 */
function splitDisplayName(value: string): PaperAuthor | undefined {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return undefined;
  const lastSpace = name.lastIndexOf(" ");
  if (lastSpace < 0) return { literal: name };
  return {
    family: name.slice(lastSpace + 1),
    given: name.slice(0, lastSpace),
  };
}

function displayNameAuthors(values: string[] | undefined): PaperAuthor[] {
  return (values ?? []).flatMap((value) => {
    const author = splitDisplayName(value);
    return author ? [author] : [];
  });
}

/**
 * Both APIs date a book to anything from a bare year to a full date. Parsing
 * the year separately keeps "1998" usable when there is no month or day to
 * build an instant from.
 */
function bookPublishedYear(value: string | undefined): number | undefined {
  const year = value?.match(/\b(1\d{3}|2\d{3})\b/)?.[1];
  return year ? Number(year) : undefined;
}

function bookPublishedDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}(-\d{2})?$/.test(value.trim())) return undefined;
  const date = new Date(
    value.trim().length === 7 ? `${value.trim()}-01` : value.trim(),
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function joinTitle(title: string, subtitle?: string): string {
  const main = stripMarkup(title);
  const sub = subtitle ? stripMarkup(subtitle) : "";
  return sub ? `${main}: ${sub}` : main;
}

export function mapGoogleBooksVolume(
  volume: GoogleBooksVolume,
): ResolvedPaperMetadata {
  const info = volume.volumeInfo;
  if (!info?.title) throw new Error("Google Books record has no title");
  const isbn = (info.industryIdentifiers ?? []).flatMap((identifier) => {
    if (!identifier.identifier) return [];
    if (identifier.type !== "ISBN_10" && identifier.type !== "ISBN_13")
      return [];
    return [identifier.identifier];
  });

  return {
    title: joinTitle(info.title, info.subtitle),
    authors: displayNameAuthors(info.authors),
    abstract: info.description ? stripMarkup(info.description) : undefined,
    type: "book",
    year: bookPublishedYear(info.publishedDate),
    publishedDate: bookPublishedDate(info.publishedDate),
    publisher: info.publisher?.trim() || undefined,
    pages: info.pageCount ? String(info.pageCount) : undefined,
    language: info.language?.trim() || undefined,
    isbn,
    issn: [],
    url: info.canonicalVolumeLink || info.infoLink || undefined,
    metadataSource: "google_books",
    metadataFetchedAt: new Date().toISOString(),
  };
}

export function mapOpenLibraryBook(
  book: OpenLibraryBook,
): ResolvedPaperMetadata {
  if (!book.title) throw new Error("Open Library record has no title");
  const notes = typeof book.notes === "string" ? book.notes : book.notes?.value;
  const abstract = notes || book.excerpts?.[0]?.text;

  return {
    title: joinTitle(book.title, book.subtitle),
    authors: displayNameAuthors(
      (book.authors ?? []).flatMap((author) =>
        author.name ? [author.name] : [],
      ),
    ),
    abstract: abstract ? stripMarkup(abstract) : undefined,
    type: "book",
    year: bookPublishedYear(book.publish_date),
    publisher: book.publishers?.[0]?.name?.trim() || undefined,
    pages: book.number_of_pages ? String(book.number_of_pages) : undefined,
    isbn: [
      ...(book.identifiers?.isbn_13 ?? []),
      ...(book.identifiers?.isbn_10 ?? []),
    ],
    issn: [],
    url: book.url || undefined,
    metadataSource: "open_library",
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

function googleBooksUrl(query: string): string {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  return `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10${key ? `&key=${encodeURIComponent(key)}` : ""}`;
}

async function fetchGoogleBooksVolumes(
  query: string,
): Promise<GoogleBooksVolume[]> {
  const response = await fetchWithTimeout(
    googleBooksUrl(query),
    "application/json",
  );
  if (!response.ok) throw new Error("Google Books lookup failed");
  const payload = (await response.json()) as { items?: GoogleBooksVolume[] };
  return payload.items ?? [];
}

async function fetchOpenLibraryBook(
  isbn: string,
): Promise<OpenLibraryBook | undefined> {
  const response = await fetchWithTimeout(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`,
    "application/json",
  );
  if (!response.ok) throw new Error("Open Library lookup failed");
  const payload = (await response.json()) as Record<
    string,
    OpenLibraryBook | undefined
  >;
  return payload[`ISBN:${isbn}`];
}

/**
 * Google Books first because it carries a description, a page count and a
 * language; Open Library is the fallback for anything it has never indexed.
 * A record from either keeps the ISBN that was searched for, since Google
 * sometimes returns the edition without echoing the identifier back.
 */
export async function resolveBookMetadata(
  identifier: string,
): Promise<ResolvedPaperMetadata> {
  const isbn = normalizeIsbn(identifier);
  if (!isbn) {
    const volumes = await fetchGoogleBooksVolumes(identifier);
    const match = volumes.find((volume) =>
      volume.volumeInfo?.title
        ? titleMatches(identifier, volume.volumeInfo.title)
        : false,
    );
    if (!match) throw new Error("No exact book title match");
    return mapGoogleBooksVolume(match);
  }

  const withSearchedIsbn = (metadata: ResolvedPaperMetadata) => ({
    ...metadata,
    isbn: [...new Set([isbn, ...(metadata.isbn ?? [])])],
  });

  const volumes = await fetchGoogleBooksVolumes(`isbn:${isbn}`);
  if (volumes[0]) return withSearchedIsbn(mapGoogleBooksVolume(volumes[0]));

  const book = await fetchOpenLibraryBook(isbn);
  if (!book) throw new Error("ISBN not found");
  return withSearchedIsbn(mapOpenLibraryBook(book));
}

export async function resolvePaperMetadata(
  identifier: string,
  kind: PaperLookupKind = "academic",
): Promise<ResolvedPaperMetadata> {
  if (kind === "book") return resolveBookMetadata(identifier);

  const doi = normalizeDoi(identifier);
  if (doi) {
    const response = await fetchWithTimeout(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      "application/json",
    );
    if (response.status === 404) throw new Error("DOI not found");
    if (!response.ok) throw new Error("Crossref lookup failed");
    const payload = (await response.json()) as { message?: CrossrefWork };
    if (!payload.message) throw new Error("Crossref returned an empty record");
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

  // Anything that is not an identifier is treated as a title, so the lookup
  // box is usable for the common case of having the name and nothing else.
  return resolvePaperMetadataByTitle(identifier);
}
