import "server-only";

import type {
  LatexReferenceSuggestion,
  PaperAuthor,
  PaperType,
} from "@repo/schemas";
import { normalizeDoi } from "@/lib/paper-citations";

interface OpenAlexAuthor {
  author?: { display_name?: string; orcid?: string };
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  type?: string;
  cited_by_count?: number;
  is_retracted?: boolean;
  relevance_score?: number;
  authorships?: OpenAlexAuthor[];
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    landing_page_url?: string | null;
    source?: {
      display_name?: string | null;
      host_organization_name?: string | null;
    } | null;
  } | null;
  best_oa_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    is_oa?: boolean;
    license?: string | null;
  } | null;
  open_access?: {
    is_oa?: boolean;
    oa_status?: string | null;
  } | null;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

function shortOpenAlexId(value: string | undefined): string | null {
  if (!value) return null;
  const id = value.split("/").at(-1) ?? "";
  return /^W\d+$/.test(id) ? id : null;
}

function paperType(value: string | undefined): PaperType {
  switch (value) {
    case "article":
      return "article";
    case "book":
      return "book";
    case "dataset":
      return "dataset";
    case "preprint":
      return "preprint";
    case "dissertation":
      return "thesis";
    case "book-chapter":
      return "chapter";
    default:
      return "other";
  }
}

function authors(value: OpenAlexAuthor[] | undefined): PaperAuthor[] {
  return (value ?? []).flatMap((authorship) => {
    const display = authorship.author?.display_name?.trim();
    if (!display) return [];
    return [
      {
        literal: display,
        ...(authorship.author?.orcid ? { orcid: authorship.author.orcid } : {}),
      },
    ];
  });
}

function abstractFromIndex(
  index: Record<string, number[]> | null | undefined,
): string | null {
  if (!index) return null;
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push([position, word]);
  }
  words.sort((left, right) => left[0] - right[0]);
  return (
    words
      .map((entry) => entry[1])
      .join(" ")
      .slice(0, 100_000) || null
  );
}

function validUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export async function searchOpenAlex(
  query: string,
  options?: {
    limit?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<LatexReferenceSuggestion[]> {
  const normalizedQuery = query.trim().slice(0, 2_000);
  if (normalizedQuery.length < 3) return [];
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search.semantic", normalizedQuery);
  url.searchParams.set("filter", "is_retracted:false");
  url.searchParams.set("per_page", String(Math.min(50, options?.limit ?? 20)));
  url.searchParams.set(
    "select",
    [
      "id",
      "doi",
      "title",
      "display_name",
      "publication_year",
      "type",
      "cited_by_count",
      "is_retracted",
      "relevance_score",
      "authorships",
      "abstract_inverted_index",
      "primary_location",
      "best_oa_location",
      "open_access",
    ].join(","),
  );
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const response = await (options?.fetchImpl ?? fetch)(url, {
    headers: { accept: "application/json" },
    signal: options?.signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OpenAlex search failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as OpenAlexResponse;
  return (payload.results ?? []).flatMap((work) => {
    if (work.is_retracted) return [];
    const title = (work.title ?? work.display_name)?.trim();
    const openAlexId = shortOpenAlexId(work.id);
    if (!title || !openAlexId) return [];
    const isOpenAccess = Boolean(
      work.open_access?.is_oa || work.best_oa_location?.is_oa,
    );
    const score = work.relevance_score;
    return [
      {
        source: "openalex" as const,
        paperId: null,
        openAlexId,
        doi: work.doi ? (normalizeDoi(work.doi) ?? null) : null,
        arxivId: null,
        title,
        abstract: abstractFromIndex(work.abstract_inverted_index),
        authors: authors(work.authorships),
        paperType: paperType(work.type),
        year: work.publication_year ?? null,
        venue: work.primary_location?.source?.display_name?.trim() || null,
        publisher:
          work.primary_location?.source?.host_organization_name?.trim() || null,
        citationCount: work.cited_by_count ?? null,
        isOpenAccess,
        openAccessStatus: work.open_access?.oa_status ?? null,
        license: work.best_oa_location?.license ?? null,
        url:
          validUrl(work.best_oa_location?.landing_page_url) ??
          validUrl(work.primary_location?.landing_page_url) ??
          validUrl(work.doi) ??
          validUrl(work.id),
        matchRationale:
          typeof score === "number"
            ? `OpenAlex semantic similarity ${score.toFixed(3)}`
            : "OpenAlex semantic match",
        citationKey: null,
        alreadyInPapers: false,
      },
    ];
  });
}
