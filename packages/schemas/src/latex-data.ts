import { z } from "zod";
import { latexReferenceSuggestionSchema } from "./latex-research";

export const latexDataSearchIntentSchema = z.object({
  metric: z.string().trim().min(1).max(500),
  population: z.string().trim().max(500).nullable(),
  geography: z.string().trim().max(300).nullable(),
  period: z.string().trim().max(200).nullable(),
  comparison: z.string().trim().max(500).nullable(),
  desiredUnit: z.string().trim().max(100).nullable(),
});
export type LatexDataSearchIntent = z.infer<typeof latexDataSearchIntentSchema>;

export const latexDataPointCandidateSchema = z.object({
  id: z.uuid(),
  value: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(100),
  population: z.string().trim().max(500).nullable(),
  geography: z.string().trim().max(300).nullable(),
  period: z.string().trim().max(200).nullable(),
  methodologyQualifier: z.string().trim().max(1_000).nullable(),
  supportingPassage: z.string().trim().min(1).max(4_000),
  page: z.number().int().positive().max(100_000).nullable(),
  section: z.string().trim().max(300).nullable(),
  verified: z.literal(true),
  reference: latexReferenceSuggestionSchema,
});
export type LatexDataPointCandidate = z.infer<
  typeof latexDataPointCandidateSchema
>;

export const latexDataPointSearchSchema = z.object({
  query: z.string().trim().min(3).max(2_000),
  limit: z.number().int().min(1).max(12).default(8),
});
export type LatexDataPointSearchInput = z.infer<
  typeof latexDataPointSearchSchema
>;

export const latexDataPointSearchResponseSchema = z.object({
  intent: latexDataSearchIntentSchema,
  candidates: z.array(latexDataPointCandidateSchema).max(12),
  inspectedPassages: z.number().int().nonnegative(),
  rejectedCandidates: z.number().int().nonnegative(),
});
export type LatexDataPointSearchResponse = z.infer<
  typeof latexDataPointSearchResponseSchema
>;
