import { z } from "zod";

export const macrosVisionBasisSchema = z.enum([
  "per_100g",
  "per_100ml",
  "per_serving",
  "unknown",
]);
export const macrosVisionFieldSchema = z.object({
  value: z.number().nullable(),
  unit: z.enum(["kcal", "kj", "g", "mg", "mcg"]),
  confidence: z.number().min(0).max(1),
});
export const macrosVisionLabelResponseSchema = z.object({
  version: z.literal("v1"),
  basis: macrosVisionBasisSchema,
  servingQuantity: z.number().positive().nullable(),
  servingUnit: z.string().nullable(),
  servingsPerContainer: z.number().positive().nullable(),
  fields: z.record(z.string(), macrosVisionFieldSchema),
  rawText: z.string(),
  warnings: z.array(z.string()),
});
export const macrosVisionCandidateSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1),
});
export const macrosVisionClassifyResponseSchema = z.object({
  version: z.literal("v1"),
  candidates: z.array(macrosVisionCandidateSchema),
  rawText: z.string().default(""),
});
export type MacrosVisionLabelResponse = z.infer<
  typeof macrosVisionLabelResponseSchema
>;
export type MacrosVisionClassifyResponse = z.infer<
  typeof macrosVisionClassifyResponseSchema
>;
