import type { CreatePaperInput, PaperMutation } from "@repo/schemas";
import mongoose from "mongoose";
import {
  generateCitationKey,
  normalizeArxivId,
  normalizeDoi,
} from "@/lib/paper-citations";
import { Note } from "@/models/Note";
import { Paper } from "@/models/Paper";

export async function prunePaperNoteIds(noteIds: string[] | undefined) {
  if (!noteIds) return undefined;
  const ids = [
    ...new Set(noteIds.filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];
  if (ids.length === 0) return [];
  const existing = await Note.find({ _id: { $in: ids } })
    .select("_id")
    .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
    .exec();
  return existing.map((note) => note._id);
}

export async function availableCitationKey(base: string): Promise<string> {
  const normalized = base.trim() || "paper";
  let candidate = normalized;
  let suffix = 2;
  while (await Paper.exists({ citationKey: candidate })) {
    candidate = `${normalized}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeIdentifier(
  input: string | undefined,
  kind: "doi" | "arxiv",
): string | undefined {
  if (input === undefined || input === "") return undefined;
  const normalized =
    kind === "doi" ? normalizeDoi(input) : normalizeArxivId(input);
  if (!normalized) {
    throw new Error(`Invalid ${kind === "doi" ? "DOI" : "arXiv identifier"}`);
  }
  return normalized;
}

function dedupeStrings(values: string[] | undefined): string[] | undefined {
  return values
    ? [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    : undefined;
}

export async function prepareNewPaper(input: CreatePaperInput) {
  const doi = normalizeIdentifier(input.doi, "doi");
  const arxivId = normalizeIdentifier(input.arxivId, "arxiv");
  const noteIds = await prunePaperNoteIds(input.noteIds);
  const baseCitationKey =
    input.citationKey?.trim() ||
    generateCitationKey({
      authors: input.authors,
      title: input.title,
      year: input.year ?? undefined,
    });

  return {
    ...input,
    doi,
    arxivId,
    citationKey: await availableCitationKey(baseCitationKey),
    authors: input.authors ?? [],
    type: input.type ?? "article",
    readingStatus: input.readingStatus ?? "unread",
    isbn: dedupeStrings(input.isbn) ?? [],
    issn: dedupeStrings(input.issn) ?? [],
    tags: dedupeStrings(input.tags) ?? [],
    noteIds: noteIds ?? [],
    highlights: input.highlights ?? [],
    metadataSource: input.metadataSource ?? "manual",
    publishedDate: input.publishedDate
      ? new Date(input.publishedDate)
      : undefined,
    metadataFetchedAt: input.metadataFetchedAt
      ? new Date(input.metadataFetchedAt)
      : undefined,
  };
}

const OPTIONAL_STRING_FIELDS = [
  "abstract",
  "venue",
  "publisher",
  "volume",
  "issue",
  "pages",
  "edition",
  "language",
  "arxivCategory",
  "openAlexId",
  "openAccessStatus",
  "license",
  "url",
] as const satisfies ReadonlyArray<keyof PaperMutation>;

export async function preparePaperUpdate(input: PaperMutation) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};

  if (input.title !== undefined) set.title = input.title;
  if (input.authors !== undefined) set.authors = input.authors;
  if (input.type !== undefined) set.type = input.type;
  if (input.readingStatus !== undefined)
    set.readingStatus = input.readingStatus;
  if (input.metadataSource !== undefined)
    set.metadataSource = input.metadataSource;
  if (input.isRetracted !== undefined) set.isRetracted = input.isRetracted;

  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === "") unset[field] = 1;
    else set[field] = value;
  }

  if (input.doi !== undefined) {
    const value = normalizeIdentifier(input.doi, "doi");
    if (value) set.doi = value;
    else unset.doi = 1;
  }
  if (input.arxivId !== undefined) {
    const value = normalizeIdentifier(input.arxivId, "arxiv");
    if (value) set.arxivId = value;
    else unset.arxivId = 1;
  }
  if (input.citationKey !== undefined) {
    if (!input.citationKey) throw new Error("Citation key cannot be blank");
    set.citationKey = input.citationKey;
  }

  for (const field of ["year", "citationCount"] as const) {
    const value = input[field];
    if (value === null) unset[field] = 1;
    else if (value !== undefined) set[field] = value;
  }

  for (const field of ["publishedDate", "metadataFetchedAt"] as const) {
    const value = input[field];
    if (value === null) unset[field] = 1;
    else if (value !== undefined) set[field] = new Date(value);
  }

  if (input.pdf === null) unset.pdf = 1;
  else if (input.pdf !== undefined) set.pdf = input.pdf;

  if (input.isbn !== undefined) set.isbn = dedupeStrings(input.isbn);
  if (input.issn !== undefined) set.issn = dedupeStrings(input.issn);
  if (input.tags !== undefined) set.tags = dedupeStrings(input.tags);
  if (input.noteIds !== undefined) {
    set.noteIds = await prunePaperNoteIds(input.noteIds);
  }
  if (input.highlights !== undefined) {
    const ids = new Set(input.highlights.map((highlight) => highlight.id));
    if (ids.size !== input.highlights.length) {
      throw new Error("Highlight ids must be unique");
    }
    set.highlights = input.highlights.map((highlight) => ({
      ...highlight,
      createdAt: new Date(highlight.createdAt),
    }));
  }

  const mutation: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) mutation.$set = set;
  if (Object.keys(unset).length > 0) mutation.$unset = unset;
  return mutation;
}

export function isDuplicatePaperError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}
