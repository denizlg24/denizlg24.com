import { z } from "zod";
import {
  macrosCaloriePreferenceSchema,
  macrosDailyMacrosSchema,
  macrosNutritionTargetsSchema,
} from "./common";
import { macrosFoodLoggingSummarySchema } from "./food-log";
import { macrosWeightSummarySchema } from "./weights";

export const macrosEnergyBalancePointSchema = z.object({
  date: z.string(),
  consumed: z.number(),
  tdee: z.number().nullable(),
});

/**
 * What "on target" means for a day's calories: a cut's target is a ceiling,
 * a bulk's a floor, and only maintenance is a band either side.
 */
export const macrosAdherenceRuleSchema = z.enum([
  "at-most",
  "at-least",
  "within",
]);

/** Closed, fully logged days since the active plan started. */
export const macrosGoalProgressSchema = z.object({
  daysTracked: z.number(),
  daysOnTarget: z.number(),
  totalDays: z.number(),
  rule: macrosAdherenceRuleSchema,
});

export const macrosDashboardHabitSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  targetPerWeek: z.number(),
  completedDates: z.array(z.string()),
});

export const macrosDashboardSchema = z.object({
  today: z.string(),
  timezone: z.string(),
  caloriePreference: macrosCaloriePreferenceSchema,
  consumed: macrosDailyMacrosSchema,
  targets: macrosNutritionTargetsSchema,
  energyBalance: z.array(macrosEnergyBalancePointSchema),
  goalProgress: macrosGoalProgressSchema,
  foodLoggingSummary: macrosFoodLoggingSummarySchema,
  weightSummary: macrosWeightSummarySchema,
  habits: z.array(macrosDashboardHabitSchema),
});

export const macrosDashboardResponseSchema = z.object({
  dashboard: macrosDashboardSchema,
  fetchedAt: z.string(),
});

export const macrosDailyCalorieSummarySchema = z.object({
  today: z.string(),
  timezone: z.string(),
  consumed: z.number(),
  target: z.number().nullable(),
  preference: macrosCaloriePreferenceSchema,
  proteinTarget: z.number().nullable(),
  carbsTarget: z.number().nullable(),
  fatTarget: z.number().nullable(),
});

export const macrosCalorieSummaryResponseSchema = z.object({
  calorieSummary: macrosDailyCalorieSummarySchema,
  fetchedAt: z.string(),
});

export type MacrosEnergyBalancePoint = z.infer<
  typeof macrosEnergyBalancePointSchema
>;
export type MacrosAdherenceRule = z.infer<typeof macrosAdherenceRuleSchema>;
export type MacrosGoalProgress = z.infer<typeof macrosGoalProgressSchema>;
export type MacrosDashboardHabit = z.infer<typeof macrosDashboardHabitSchema>;
export type MacrosDashboard = z.infer<typeof macrosDashboardSchema>;
export type MacrosDashboardResponse = z.infer<
  typeof macrosDashboardResponseSchema
>;
export type MacrosDailyCalorieSummary = z.infer<
  typeof macrosDailyCalorieSummarySchema
>;
export type MacrosCalorieSummaryResponse = z.infer<
  typeof macrosCalorieSummaryResponseSchema
>;
