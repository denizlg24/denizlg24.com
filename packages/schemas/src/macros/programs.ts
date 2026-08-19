import { z } from "zod";
import { macrosGoalTypeSchema } from "./goals";

export const macrosProgramModeSchema = z.enum([
  "coached",
  "collaborative",
  "manual",
]);
export const macrosDietPhaseSchema = z.enum([
  "cut",
  "maintain",
  "bulk",
  "diet_break",
]);
export const macrosProgramStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "archived",
]);
export const macrosPlanReasonSchema = z.enum([
  "check_in",
  "program_change",
  "goal_change",
  "diet_break",
  "manual",
  "onboarding",
]);
export const macrosCalorieCyclingSchema = z.object({
  highDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  highDayAdjustment: z.number().finite().min(0).max(500).default(0),
});
export const macrosUpsertProgramBodySchema = z
  .object({
    activeWeightGoalId: z.uuid().nullable().optional(),
    goalType: macrosGoalTypeSchema,
    proteinGramsPerKg: z.number().finite().min(0.8).max(4),
    fatGramsPerKg: z.number().finite().min(0.3).max(3).nullable().optional(),
    fatPercent: z.number().finite().min(10).max(60).nullable().optional(),
    distributionProfile: z.string().trim().min(1).max(40),
    calorieCycling: macrosCalorieCyclingSchema.default({
      highDays: [],
      highDayAdjustment: 0,
    }),
    checkInWeekday: z.number().int().min(0).max(6),
    mode: macrosProgramModeSchema,
    dietPhase: macrosDietPhaseSchema,
    manualCalorieTarget: z
      .number()
      .finite()
      .min(800)
      .max(10000)
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.mode !== "manual" || value.manualCalorieTarget != null,
    {
      message: "Manual mode requires a calorie target",
      path: ["manualCalorieTarget"],
    },
  );
export const macrosProgramSchema = macrosUpsertProgramBodySchema.extend({
  id: z.uuid(),
  userId: z.string(),
  status: macrosProgramStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const macrosTargetIssueSchema = z.object({
  id: z.uuid(),
  programId: z.uuid().nullable(),
  status: z.enum(["active", "pending_acceptance", "archived"]),
  reason: macrosPlanReasonSchema,
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  calorieTarget: z.number(),
  proteinTarget: z.number(),
  carbsTarget: z.number(),
  fatTarget: z.number(),
  tdeeAtIssue: z.number().nullable(),
  tdeeVarianceAtIssue: z.number().nullable(),
  deltaFromPreviousCalories: z.number().nullable(),
});
export type MacrosProgramMode = z.infer<typeof macrosProgramModeSchema>;
export type MacrosDietPhase = z.infer<typeof macrosDietPhaseSchema>;
export type MacrosPlanReason = z.infer<typeof macrosPlanReasonSchema>;
export type MacrosCalorieCycling = z.infer<typeof macrosCalorieCyclingSchema>;
export type MacrosUpsertProgramBody = z.infer<
  typeof macrosUpsertProgramBodySchema
>;
export type MacrosProgram = z.infer<typeof macrosProgramSchema>;
export type MacrosTargetIssue = z.infer<typeof macrosTargetIssueSchema>;
