import { z } from "zod";
import { macrosIsoDateSchema } from "./common";

export const macrosUpsertWeighInBodySchema = z.object({
  logDate: macrosIsoDateSchema,
  weightKg: z.number().finite().positive().max(999),
  bodyFatPct: z.number().finite().min(0).max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});
export const macrosWeighInItemSchema = z.object({
  id: z.uuid(),
  logDate: macrosIsoDateSchema,
  measuredAt: z.string(),
  weightKg: z.number(),
  bodyFatPct: z.number().nullable(),
  notes: z.string().nullable(),
});
export const macrosWeightPointSchema = z.object({
  date: macrosIsoDateSchema,
  weightKg: z.number(),
});
export const macrosWeightTrendPointSchema = z.object({
  date: macrosIsoDateSchema,
  trendWeightKg: z.number(),
  scaleWeightKg: z.number().nullable(),
  varianceKg2: z.number(),
  slopeKgPerWeek: z.number().nullable(),
  hasObservation: z.boolean(),
  algorithmVersion: z.string(),
});
export const macrosWeightSummarySchema = z.object({
  latestWeightKg: z.number().nullable(),
  latestLogDate: macrosIsoDateSchema.nullable(),
  weekAverageKg: z.number().nullable(),
  weekDifferenceKg: z.number().nullable(),
  weekPoints: z.array(macrosWeightPointSchema),
  lastSevenEntries: z.array(macrosWeightPointSchema),
  weighInsThisWeek: z.number().int().nonnegative(),
  last30Days: z.array(macrosIsoDateSchema),
  trackedLast30Days: z.array(macrosIsoDateSchema),
  streakDays: z.number().int().nonnegative(),
});
export const macrosWeightOverviewSchema = z.object({
  today: macrosIsoDateSchema,
  timezone: z.string(),
  entries: z.array(macrosWeighInItemSchema),
  trend: z.array(macrosWeightTrendPointSchema),
  summary: macrosWeightSummarySchema,
});
export type MacrosUpsertWeighInBody = z.infer<
  typeof macrosUpsertWeighInBodySchema
>;
export type MacrosWeighInItem = z.infer<typeof macrosWeighInItemSchema>;
export type MacrosWeightPoint = z.infer<typeof macrosWeightPointSchema>;
export type MacrosWeightTrendPoint = z.infer<
  typeof macrosWeightTrendPointSchema
>;
export type MacrosWeightSummary = z.infer<typeof macrosWeightSummarySchema>;
export type MacrosWeightOverview = z.infer<typeof macrosWeightOverviewSchema>;
