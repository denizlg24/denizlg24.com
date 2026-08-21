import type { CreatePaperInput, PaperMutation } from "@repo/schemas";
import mongoose from "mongoose";
import {
  generateCitationKey,
  normalizeArxivId,
  normalizeDoi,
} from "@/lib/paper-citations";
import { Course } from "@/models/Course";
import { Note } from "@/models/Note";
import { Paper } from "@/models/Paper";

/**
 * A record only belongs in a bibliography once it has an identity something
 * else could resolve. A dropped lecture PDF has none, and the LaTeX reference
 * panel reads the same collection, so it must not be offered as a citation.
 */
export function hasBibliographicIdentity(input: {
  doi?: string;
  arxivId?: string;
  openAlexId?: string;
  metadataSource?: CreatePaperInput["metadataSource"];
}): boolean {
  return Boolean(
    input.doi ||
      input.arxivId ||
      input.openAlexId ||
      (input.metadataSource && input.metadataSource !== "manual"),
  );
}

export async function prunePaperCourseIds(courseIds: string[] | undefined) {
  if (!courseIds) return undefined;
  const ids = [
    ...new Set(courseIds.filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];
  if (ids.length === 0) return [];
  const existing = await Course.find({ _id: { $in: ids } })
    .select("_id")
    .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
    .exec();
  return existing.map((course) => course._id);
}

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
  const courseIds = await prunePaperCourseIds(input.courseIds);
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
    courseIds: courseIds ?? [],
    citable:
      input.citable ??
      hasBibliographicIdentity({
        doi,
        arxivId,
        openAlexId: input.openAlexId,
        metadataSource: input.metadataSource,
      }),
    highlights: input.highlights ?? [],
    metadataSource: input.metadataSource ?? "manual",
    publishedDate: input.publishedDate
      ? new Date(input.publishedDate)
      : undefined,
    metadataFetchedAt: input.metadataFetchedAt
      ? new Date(input.metadataFetchedAt)
      : undefined,
    progress: input.progress
      ? { ...input.progress, updatedAt: new Date(input.progress.updatedAt) }
      : undefined,
    dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
    startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
    completedAt: input.completedAt ? new Date(input.completedAt) : undefined,
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

export interface PaperLifecycleState {
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Reaching a status stamps the date it was first reached, never re-stamps it.
 * Flipping back to "reading" to re-read something must not erase when it was
 * originally started, and an explicit date in the mutation always wins.
 */
function lifecycleStamps(
  status: NonNullable<PaperMutation["readingStatus"]>,
  input: PaperMutation,
  previous: PaperLifecycleState,
): Record<string, Date> {
  const stamps: Record<string, Date> = {};
  const now = new Date();
  if (
    (status === "reading" || status === "read") &&
    input.startedAt === undefined &&
    !previous.startedAt
  ) {
    stamps.startedAt = now;
  }
  if (
    status === "read" &&
    input.completedAt === undefined &&
    !previous.completedAt
  ) {
    stamps.completedAt = now;
  }
  return stamps;
}

export async function preparePaperUpdate(
  input: PaperMutation,
  previous?: PaperLifecycleState,
) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};

  if (input.title !== undefined) set.title = input.title;
  if (input.authors !== undefined) set.authors = input.authors;
  if (input.type !== undefined) set.type = input.type;
  if (input.readingStatus !== undefined) {
    set.readingStatus = input.readingStatus;
    Object.assign(
      set,
      lifecycleStamps(input.readingStatus, input, previous ?? {}),
    );
  }
  if (input.metadataSource !== undefined)
    set.metadataSource = input.metadataSource;
  if (input.isRetracted !== undefined) set.isRetracted = input.isRetracted;
  if (input.citable !== undefined) set.citable = input.citable;

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

  for (const field of [
    "publishedDate",
    "metadataFetchedAt",
    "dueAt",
    "startedAt",
    "completedAt",
  ] as const) {
    const value = input[field];
    if (value === null) unset[field] = 1;
    else if (value !== undefined) set[field] = new Date(value);
  }

  if (input.priority === null) unset.priority = 1;
  else if (input.priority !== undefined) set.priority = input.priority;

  if (input.progress === null) unset.progress = 1;
  else if (input.progress !== undefined) {
    set.progress = {
      ...input.progress,
      updatedAt: new Date(input.progress.updatedAt),
    };
  }

  if (input.courseIds !== undefined) {
    set.courseIds = await prunePaperCourseIds(input.courseIds);
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
