import { z } from "zod";
import { kanbanPrioritySchema } from "./kanban";

export const paperTypeSchema = z.enum([
  "article",
  "conference",
  "preprint",
  "thesis",
  "book",
  "chapter",
  "report",
  "notes",
  "slides",
  "dataset",
  "other",
]);
export type PaperType = z.infer<typeof paperTypeSchema>;

export const paperMetadataSourceSchema = z.enum([
  "manual",
  "crossref",
  "arxiv",
  "semantic_scholar",
  "openalex",
  "google_books",
  "open_library",
]);
export type PaperMetadataSource = z.infer<typeof paperMetadataSourceSchema>;

/**
 * Which family of sources a lookup should reach for. A DOI and an ISBN are
 * both plausible free text, so the tab the owner is on disambiguates rather
 * than the resolver guessing.
 */
export const paperLookupKindSchema = z.enum(["academic", "book"]);
export type PaperLookupKind = z.infer<typeof paperLookupKindSchema>;

export const paperReadingStatusSchema = z.enum(["unread", "reading", "read"]);
export type PaperReadingStatus = z.infer<typeof paperReadingStatusSchema>;

export const paperAuthorSchema = z
  .object({
    family: z.string().trim().max(200).optional(),
    given: z.string().trim().max(200).optional(),
    literal: z.string().trim().max(300).optional(),
    orcid: z.string().trim().max(100).optional(),
  })
  .refine(
    (author) => Boolean(author.literal || author.family || author.given),
    {
      message: "Author name is required",
    },
  );
export type PaperAuthor = z.infer<typeof paperAuthorSchema>;

export const paperHighlightColorSchema = z.enum([
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
]);
export type PaperHighlightColor = z.infer<typeof paperHighlightColorSchema>;

export const paperHighlightSchema = z.object({
  id: z.string().trim().min(1).max(100),
  page: z.number().int().positive().max(100_000).optional(),
  text: z.string().trim().min(1).max(20_000),
  note: z.string().max(20_000).optional(),
  color: paperHighlightColorSchema.default("yellow"),
  createdAt: z.iso.datetime(),
});
export type PaperHighlight = z.infer<typeof paperHighlightSchema>;

const withinDocument = (progress: {
  currentPage: number;
  totalPages?: number;
}) =>
  progress.totalPages === undefined ||
  progress.currentPage <= progress.totalPages;

const beyondEnd = {
  message: "Page is beyond the end of the document",
  path: ["currentPage"] as PropertyKey[],
};

export const paperProgressSchema = z
  .object({
    currentPage: z.number().int().positive().max(100_000),
    totalPages: z.number().int().positive().max(100_000).optional(),
    updatedAt: z.iso.datetime(),
  })
  .refine(withinDocument, beyondEnd);
export type PaperProgress = z.infer<typeof paperProgressSchema>;

/**
 * Ceiling for a stored reading PDF. Scanned books and lecture-slide decks run
 * to hundreds of megabytes, so this is the storage limit, not the transport
 * one — see the upload route for what a single request can actually carry.
 */
export const MAX_PAPER_PDF_BYTES = 500 * 1024 * 1024;

export const paperFileSchema = z.object({
  url: z.url(),
  storageKey: z.string().max(1_000).optional(),
  fileName: z.string().max(500),
  mimeType: z.literal("application/pdf"),
  sizeBytes: z.number().int().nonnegative().max(MAX_PAPER_PDF_BYTES),
});
export type PaperFile = z.infer<typeof paperFileSchema>;

export const paperSchema = z.object({
  _id: z.string(),
  title: z.string(),
  authors: z.array(paperAuthorSchema),
  abstract: z.string().optional(),
  type: paperTypeSchema,
  readingStatus: paperReadingStatusSchema,
  year: z.number().int().optional(),
  publishedDate: z.string().optional(),
  venue: z.string().optional(),
  publisher: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  edition: z.string().optional(),
  language: z.string().optional(),
  isbn: z.array(z.string()),
  issn: z.array(z.string()),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
  arxivCategory: z.string().optional(),
  openAlexId: z.string().optional(),
  isRetracted: z.boolean().optional(),
  openAccessStatus: z.string().optional(),
  license: z.string().optional(),
  citationKey: z.string(),
  citationCount: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
  pdf: paperFileSchema.optional(),
  /**
   * Whether this belongs in a bibliography. The LaTeX reference panel reads
   * the same collection, so an uploaded lecture PDF with no bibliographic
   * identity must not be offered as something to \cite.
   */
  citable: z.boolean(),
  courseIds: z.array(z.string()),
  progress: paperProgressSchema.optional(),
  dueAt: z.string().optional(),
  priority: kanbanPrioritySchema.optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  noteId: z.string().optional(),
  tags: z.array(z.string()),
  noteIds: z.array(z.string()),
  highlights: z.array(paperHighlightSchema),
  metadataSource: paperMetadataSourceSchema,
  metadataFetchedAt: z.string().optional(),
  bibtex: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IPaper = z.infer<typeof paperSchema>;

export const paperNoteRefSchema = z.object({
  _id: z.string(),
  title: z.string(),
  url: z.string().optional(),
});
export type PaperNoteRef = z.infer<typeof paperNoteRefSchema>;

const optionalTrimmedString = (max: number) =>
  z.string().trim().max(max).optional();

export const paperMutationSchema = z.object({
  title: z.string().trim().min(1).max(1_000).optional(),
  authors: z.array(paperAuthorSchema).max(500).optional(),
  abstract: optionalTrimmedString(100_000),
  type: paperTypeSchema.optional(),
  readingStatus: paperReadingStatusSchema.optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  publishedDate: z.iso.datetime().nullable().optional(),
  venue: optionalTrimmedString(1_000),
  publisher: optionalTrimmedString(1_000),
  volume: optionalTrimmedString(100),
  issue: optionalTrimmedString(100),
  pages: optionalTrimmedString(100),
  edition: optionalTrimmedString(100),
  language: optionalTrimmedString(100),
  isbn: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  issn: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  doi: optionalTrimmedString(500),
  arxivId: optionalTrimmedString(100),
  arxivCategory: optionalTrimmedString(100),
  openAlexId: optionalTrimmedString(100),
  isRetracted: z.boolean().optional(),
  openAccessStatus: optionalTrimmedString(100),
  license: optionalTrimmedString(200),
  citationKey: optionalTrimmedString(200),
  citationCount: z.number().int().nonnegative().nullable().optional(),
  url: z.string().trim().url().max(2_000).or(z.literal("")).optional(),
  pdf: paperFileSchema.nullable().optional(),
  citable: z.boolean().optional(),
  courseIds: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  progress: paperProgressSchema.nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  priority: kanbanPrioritySchema.nullable().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  completedAt: z.iso.datetime().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
  noteIds: z.array(z.string().trim().min(1).max(100)).max(1_000).optional(),
  highlights: z.array(paperHighlightSchema).max(10_000).optional(),
  metadataSource: paperMetadataSourceSchema.optional(),
  metadataFetchedAt: z.iso.datetime().nullable().optional(),
});
export type PaperMutation = z.infer<typeof paperMutationSchema>;

export const createPaperSchema = paperMutationSchema.extend({
  title: z.string().trim().min(1).max(1_000),
  year: z.number().int().min(1000).max(3000).optional(),
  publishedDate: z.iso.datetime().optional(),
  citationCount: z.number().int().nonnegative().optional(),
  pdf: paperFileSchema.optional(),
  metadataFetchedAt: z.iso.datetime().optional(),
  progress: paperProgressSchema.optional(),
  dueAt: z.iso.datetime().optional(),
  priority: kanbanPrioritySchema.optional(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
});
export type CreatePaperInput = z.infer<typeof createPaperSchema>;

/**
 * Page turns are frequent enough that revalidating the whole mutation schema
 * per turn is wasteful, and the status transitions they imply are decided on
 * the server so two devices reading the same PDF cannot disagree.
 */
export const paperProgressUpdateSchema = z
  .object({
    currentPage: z.number().int().positive().max(100_000),
    totalPages: z.number().int().positive().max(100_000).optional(),
  })
  .refine(withinDocument, beyondEnd);
export type PaperProgressUpdate = z.infer<typeof paperProgressUpdateSchema>;

/**
 * Page count learned from loading the PDF. It carries no position, so it never
 * implies the document was opened to be read and never moves the status.
 */
export const paperProgressMetadataSchema = z.object({
  totalPages: z.number().int().positive().max(100_000),
});
export type PaperProgressMetadata = z.infer<typeof paperProgressMetadataSchema>;

export const paperCourseRefSchema = z.object({
  _id: z.string(),
  name: z.string(),
  code: z.string().optional(),
  color: z.string().optional(),
  /**
   * Archived classes are still returned so a reading from a past semester
   * keeps its chip; only active ones are offered in the link picker.
   */
  status: z.enum(["active", "archived"]),
});
export type PaperCourseRef = z.infer<typeof paperCourseRefSchema>;

export const resolvePaperMetadataSchema = z.object({
  identifier: z.string().trim().min(1).max(500),
  kind: paperLookupKindSchema.default("academic"),
});

export const resolvedPaperMetadataSchema = createPaperSchema.pick({
  title: true,
  authors: true,
  abstract: true,
  type: true,
  year: true,
  publishedDate: true,
  venue: true,
  publisher: true,
  volume: true,
  issue: true,
  pages: true,
  edition: true,
  language: true,
  isbn: true,
  issn: true,
  doi: true,
  arxivId: true,
  arxivCategory: true,
  openAlexId: true,
  isRetracted: true,
  openAccessStatus: true,
  license: true,
  citationCount: true,
  url: true,
  metadataSource: true,
  metadataFetchedAt: true,
  pdf: true,
});
export type ResolvedPaperMetadata = z.infer<typeof resolvedPaperMetadataSchema>;
