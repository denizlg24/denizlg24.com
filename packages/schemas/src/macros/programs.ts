import { z } from "zod";
import { macrosIsoDateSchema } from "./common";
import { macrosGoalTypeSchema, macrosUpsertGoalBodySchema } from "./goals";

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
export const macrosProgramsResponseSchema = z.object({
  program: macrosProgramSchema.nullable(),
  issues: z.array(macrosTargetIssueSchema),
});
export const macrosUpsertProgramResponseSchema = z.object({
  program: macrosProgramSchema,
  issue: macrosTargetIssueSchema,
});
export const macrosAcceptIssueResponseSchema = z.object({
  issue: macrosTargetIssueSchema,
});
export type MacrosProgramsResponse = z.infer<
  typeof macrosProgramsResponseSchema
>;
export type MacrosUpsertProgramResponse = z.infer<
  typeof macrosUpsertProgramResponseSchema
>;
export type MacrosAcceptIssueResponse = z.infer<
  typeof macrosAcceptIssueResponseSchema
>;

/** What the target engine was fed, so a client can preview edits with the same maths. */
export const macrosCheckInEngineInputsSchema = z.object({
  tdeeKcal: z.number(),
  tdeeVarianceKcal2: z.number(),
  bmrKcal: z.number(),
  weightKg: z.number(),
  previousCalories: z.number().nullable(),
});
export const macrosCheckInTargetsSchema = z.object({
  calories: z.number(),
  proteinGrams: z.number(),
  carbsGrams: z.number(),
  fatGrams: z.number(),
});
export const macrosCheckInWeekSchema = z.object({
  from: macrosIsoDateSchema,
  to: macrosIsoDateSchema,
  loggedDays: z.number().int(),
  averageIntakeKcal: z.number().nullable(),
  weighIns: z.number().int(),
  trendStartKg: z.number().nullable(),
  trendEndKg: z.number().nullable(),
});
export const macrosCheckInResponseSchema = z.object({
  /** The most recent scheduled check-in on or before today, or null without a program. */
  scheduledOn: macrosIsoDateSchema.nullable(),
  nextOn: macrosIsoDateSchema.nullable(),
  lastCheckInOn: macrosIsoDateSchema.nullable(),
  due: z.boolean(),
  current: macrosTargetIssueSchema.nullable(),
  week: macrosCheckInWeekSchema,
  expenditure: z.object({
    tdeeKcal: z.number(),
    varianceKcal2: z.number(),
    previousTdeeKcal: z.number().nullable(),
    method: z.string().nullable(),
  }),
  engine: macrosCheckInEngineInputsSchema,
  proposal: macrosCheckInTargetsSchema.extend({
    clamps: z.array(z.string()),
  }),
});
export const macrosCheckInBodySchema = z.object({
  program: macrosUpsertProgramBodySchema,
  /** Sent only when the goal changed in the check-in; applied without a separate goal_change issue. */
  goal: macrosUpsertGoalBodySchema.optional(),
  /** Custom grams for this week only; calories are derived from them. The next check-in recomputes from the program. */
  targets: z
    .object({
      proteinGrams: z.number().finite().min(0).max(1000),
      carbsGrams: z.number().finite().min(0).max(2000),
      fatGrams: z.number().finite().min(0).max(1000),
    })
    .refine(
      (value) =>
        value.proteinGrams * 4 + value.carbsGrams * 4 + value.fatGrams * 9 >=
        800,
      { message: "Custom targets must add up to at least 800 kcal" },
    )
    .nullable()
    .optional(),
});
export type MacrosCheckInEngineInputs = z.infer<
  typeof macrosCheckInEngineInputsSchema
>;
export type MacrosCheckInResponse = z.infer<typeof macrosCheckInResponseSchema>;
export type MacrosCheckInBody = z.infer<typeof macrosCheckInBodySchema>;
