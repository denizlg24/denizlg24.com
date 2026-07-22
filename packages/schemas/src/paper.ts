import { z } from "zod";

export const paperTypeSchema = z.enum([
  "article",
  "conference",
  "preprint",
  "thesis",
  "book",
  "chapter",
  "report",
  "dataset",
  "other",
]);
export type PaperType = z.infer<typeof paperTypeSchema>;

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

export const paperFileSchema = z.object({
  url: z.url(),
  storageKey: z.string().max(1_000).optional(),
  fileName: z.string().max(500),
  mimeType: z.literal("application/pdf"),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(50 * 1024 * 1024),
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
  noteId: z.string().optional(),
  tags: z.array(z.string()),
  noteIds: z.array(z.string()),
  highlights: z.array(paperHighlightSchema),
  metadataSource: z.enum([
    "manual",
    "crossref",
    "arxiv",
    "semantic_scholar",
    "openalex",
  ]),
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
  tags: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
  noteIds: z.array(z.string().trim().min(1).max(100)).max(1_000).optional(),
  highlights: z.array(paperHighlightSchema).max(10_000).optional(),
  metadataSource: z
    .enum(["manual", "crossref", "arxiv", "semantic_scholar", "openalex"])
    .optional(),
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
});
export type CreatePaperInput = z.infer<typeof createPaperSchema>;

export const resolvePaperMetadataSchema = z.object({
  identifier: z.string().trim().min(1).max(500),
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
