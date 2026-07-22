import { z } from "zod";
import { paperAuthorSchema, paperTypeSchema } from "./paper";

export const latexReferenceSuggestionSchema = z.object({
  source: z.enum(["papers", "openalex"]),
  paperId: z.string().nullable(),
  openAlexId: z.string().nullable(),
  doi: z.string().nullable(),
  arxivId: z.string().nullable(),
  title: z.string().min(1).max(1_000),
  abstract: z.string().max(100_000).nullable(),
  authors: z.array(paperAuthorSchema).max(100),
  paperType: paperTypeSchema,
  year: z.number().int().min(1000).max(3000).nullable(),
  venue: z.string().max(1_000).nullable(),
  publisher: z.string().max(1_000).nullable(),
  citationCount: z.number().int().nonnegative().nullable(),
  isOpenAccess: z.boolean(),
  openAccessStatus: z.string().max(100).nullable(),
  license: z.string().max(200).nullable(),
  url: z.string().url().nullable(),
  matchRationale: z.string().max(500),
  citationKey: z.string().max(200).nullable(),
  alreadyInPapers: z.boolean(),
});
export type LatexReferenceSuggestion = z.infer<
  typeof latexReferenceSuggestionSchema
>;

export const latexReferenceSearchSchema = z.object({
  query: z.string().trim().min(3).max(2_000),
  limit: z.number().int().min(1).max(30).default(20),
});
export type LatexReferenceSearchInput = z.infer<
  typeof latexReferenceSearchSchema
>;

export const latexReferenceSearchResponseSchema = z.object({
  suggestions: z.array(latexReferenceSuggestionSchema),
});
export type LatexReferenceSearchResponse = z.infer<
  typeof latexReferenceSearchResponseSchema
>;

export const acceptLatexReferenceSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  suggestion: latexReferenceSuggestionSchema,
  bibliographyFile: z.string().min(1).max(240),
});
export type AcceptLatexReferenceInput = z.infer<
  typeof acceptLatexReferenceSchema
>;
