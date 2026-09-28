import { z } from "zod";
import { macrosMealTypeSchema } from "./common";
import { macrosGoalTypeSchema } from "./goals";
import { macrosPlanReasonSchema } from "./programs";

export const macrosStatisticsPeriods = [
  "7d",
  "28d",
  "90d",
  "1y",
  "all",
] as const;

export const macrosStatisticsPeriodSchema = z.enum(macrosStatisticsPeriods);

export const macrosStatisticsQuerySchema = z.object({
  period: macrosStatisticsPeriodSchema.default("28d"),
});

const nullableNumber = z.number().nullable();

export const macrosStatisticsProjectionSchema = z.object({
  date: z.string(),
  weeks: z.number(),
  uncertaintyWeeks: z.number(),
});

export const macrosStatisticsSeriesPointSchema = z.object({
  date: z.string(),
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  loggingCompleteness: z.number(),
  micronutrientCoverage: z.number(),
  tdee: nullableNumber,
  tdeeLow: nullableNumber,
  tdeeHigh: nullableNumber,
  trendWeightKg: nullableNumber,
  rolling7Calories: nullableNumber,
  rolling14Calories: nullableNumber,
  rolling28Calories: nullableNumber,
  rolling7Protein: nullableNumber,
  rolling14Protein: nullableNumber,
  rolling28Protein: nullableNumber,
  rolling7Carbs: nullableNumber,
  rolling14Carbs: nullableNumber,
  rolling28Carbs: nullableNumber,
  rolling7Fat: nullableNumber,
  rolling14Fat: nullableNumber,
  rolling28Fat: nullableNumber,
  cumulativeEnergyKcal: z.number(),
  predictedWeightChangeKg: z.number(),
});

export const macrosStatisticsFoodSchema = z.object({
  name: z.string(),
  count: z.number(),
  calories: z.number(),
});

export const macrosStatisticsNutrientAverageSchema = z.object({
  key: z.string(),
  average: z.number(),
  daysWithData: z.number(),
});

export const macrosStatisticsSchema = z.object({
  period: macrosStatisticsPeriodSchema,
  start: z.string(),
  end: z.string(),
  denominator: z.object({
    loggedDays: z.number(),
    fullyLoggedDays: z.number(),
    calendarDays: z.number(),
    weighIns: z.number(),
  }),
  summary: z.object({
    averageCalories: nullableNumber,
    averageProtein: nullableNumber,
    averageCarbs: nullableNumber,
    averageFat: nullableNumber,
    intakeStandardDeviation: nullableNumber,
    weekdayCalories: nullableNumber,
    weekendCalories: nullableNumber,
    weightChangeKg: nullableNumber,
    latestTdee: nullableNumber,
    priorTdee: nullableNumber,
    tdeeVsPriorPercent: nullableNumber,
    rateKgPerWeek: nullableNumber,
    ratePercentBodyWeightPerWeek: nullableNumber,
    averageAbsoluteTargetDistance: nullableNumber,
    longestLoggingStreak: z.number(),
    projection: macrosStatisticsProjectionSchema.nullable(),
  }),
  series: z.array(macrosStatisticsSeriesPointSchema),
  weekly: z.array(
    z.object({
      week: z.string(),
      calories: z.number(),
      plannedCalories: z.number(),
      loggedDays: z.number(),
      fullDays: z.number(),
    }),
  ),
  targetHistory: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      calories: nullableNumber,
      reason: macrosPlanReasonSchema,
      status: z.enum(["active", "pending_acceptance", "archived"]),
      deltaCalories: nullableNumber,
    }),
  ),
  topFoods: z.array(macrosStatisticsFoodSchema),
  topFoodsByCalories: z.array(macrosStatisticsFoodSchema),
  mealBreakdown: z.array(
    z.object({
      mealType: macrosMealTypeSchema,
      calories: z.number(),
      entries: z.number(),
      averageCalories: z.number(),
    }),
  ),
  timeOfDay: z.array(
    z.object({
      hour: z.number(),
      calories: z.number(),
      entries: z.number(),
    }),
  ),
  nutrientAverages: z.array(macrosStatisticsNutrientAverageSchema),
  nutrientShortfalls: z.array(
    macrosStatisticsNutrientAverageSchema.extend({
      reference: z.number(),
      percent: z.number(),
    }),
  ),
  goalHistory: z.array(
    z.object({
      id: z.uuid(),
      startDate: z.string(),
      closedAt: z.string().nullable(),
      status: z.enum(["active", "archived"]),
      goalType: macrosGoalTypeSchema,
      startWeightKg: nullableNumber,
      targetWeightKg: nullableNumber,
      endWeightKg: nullableNumber,
      achieved: z.boolean().nullable(),
    }),
  ),
});

export const macrosStatisticsResponseSchema = z.object({
  statistics: macrosStatisticsSchema,
});

export type MacrosStatisticsPeriod = z.infer<
  typeof macrosStatisticsPeriodSchema
>;
export type MacrosStatisticsQuery = z.infer<typeof macrosStatisticsQuerySchema>;
export type MacrosStatisticsProjection = z.infer<
  typeof macrosStatisticsProjectionSchema
>;
export type MacrosStatisticsSeriesPoint = z.infer<
  typeof macrosStatisticsSeriesPointSchema
>;
export type MacrosStatistics = z.infer<typeof macrosStatisticsSchema>;
export type MacrosStatisticsResponse = z.infer<
  typeof macrosStatisticsResponseSchema
>;
