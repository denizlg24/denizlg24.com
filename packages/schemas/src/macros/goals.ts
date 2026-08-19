import { z } from "zod";
import { macrosIsoDateSchema } from "./common";

export const macrosGoalTypeSchema = z.enum(["lose", "maintain", "gain"]);
export const macrosGoalOutcomeSchema = z.enum(["loss", "gain", "maintain"]);
export const macrosUpsertGoalBodySchema = z.object({
  goalType: macrosGoalTypeSchema,
  startWeightKg: z.number().finite().positive().max(999).optional(),
  targetWeightKg: z.number().finite().positive().max(999).optional(),
  targetDate: macrosIsoDateSchema.optional(),
  weeklyRateKg: z.number().finite().min(0).max(2).optional(),
});
export const macrosActiveGoalSchema = z.object({
  id: z.uuid(),
  goalType: macrosGoalTypeSchema,
  startDate: macrosIsoDateSchema,
  startWeightKg: z.number().nullable(),
  targetWeightKg: z.number().nullable(),
  targetDate: macrosIsoDateSchema.nullable(),
  weeklyRateKg: z.number().nullable(),
});
export const macrosGoalHistoryEntrySchema = z.object({
  id: z.uuid(),
  goalType: macrosGoalTypeSchema,
  startDate: macrosIsoDateSchema,
  closedAt: z.string().nullable(),
  endDate: macrosIsoDateSchema.nullable(),
  startWeightKg: z.number().nullable(),
  endWeightKg: z.number().nullable(),
  targetWeightKg: z.number().nullable(),
  outcome: macrosGoalOutcomeSchema.nullable(),
  achieved: z.boolean().nullable(),
  isActive: z.boolean(),
});
export type MacrosGoalType = z.infer<typeof macrosGoalTypeSchema>;
export type MacrosGoalOutcome = z.infer<typeof macrosGoalOutcomeSchema>;
export type MacrosUpsertGoalBody = z.infer<typeof macrosUpsertGoalBodySchema>;
export type MacrosActiveGoal = z.infer<typeof macrosActiveGoalSchema>;
export type MacrosGoalHistoryEntry = z.infer<
  typeof macrosGoalHistoryEntrySchema
>;
