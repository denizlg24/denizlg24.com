import { z } from "zod";
import {
  macrosDailyMacrosSchema,
  macrosEntryTypeSchema,
  macrosMealTypeSchema,
  macrosNutrientAmountsSchema,
  macrosNutritionTargetsSchema,
} from "./common";
import { macrosEnteredUnitSchema } from "./food-entry";

export const macrosFoodLogDayQuerySchema = z.object({
  date: z.iso.date().optional(),
});

export const macrosFoodLogEntrySchema = z.object({
  id: z.uuid(),
  logDate: z.string(),
  eatenAt: z.string().nullable(),
  mealType: macrosMealTypeSchema,
  entryType: macrosEntryTypeSchema,
  foodId: z.uuid().nullable(),
  recipeId: z.uuid().nullable(),
  foodName: z.string(),
  brand: z.string().nullable(),
  iconKey: z.string().nullable().optional(),
  servingLabel: z.string().nullable(),
  servingQuantity: z.number(),
  servingUnit: z.string(),
  servingsConsumed: z.number(),
  enteredQuantity: z.number().nullable(),
  enteredUnit: macrosEnteredUnitSchema.nullable(),
  notes: z.string().nullable(),
  nutrients: macrosNutrientAmountsSchema,
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

/** `GET /api/food-log/day` answers with the payload itself, unwrapped. */
export const macrosFoodLogDaySchema = z.object({
  date: z.string(),
  timezone: z.string(),
  entries: z.array(macrosFoodLogEntrySchema),
  totals: macrosDailyMacrosSchema,
  targets: macrosNutritionTargetsSchema,
  note: z.string().nullable(),
});

export const macrosFoodLogCalendarTotalsQuerySchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine((data) => data.start <= data.end, {
    message: "start must be before or equal to end",
  })
  .refine(
    (data) => {
      const startDate = new Date(data.start);
      const endDate = new Date(data.end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      const dayCount = Math.floor(diffDays) + 1;
      return dayCount <= 370;
    },
    {
      message: "date range cannot exceed 370 days",
    },
  );

export const macrosFoodLogWeekTotalsQuerySchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine((data) => data.start <= data.end, {
    message: "start must be before or equal to end",
  })
  .refine(
    (data) => {
      const startDate = new Date(data.start);
      const endDate = new Date(data.end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= 31;
    },
    {
      message: "date range cannot exceed 31 days",
    },
  );

export const macrosDayCaloriesSchema = z.object({
  date: z.string(),
  calories: z.number(),
});

/** `GET /api/food-log/calendar-totals`, unwrapped. */
export const macrosCalendarTotalsSchema = z.object({
  start: z.string(),
  end: z.string(),
  timezone: z.string(),
  calorieTarget: z.number().nullable(),
  days: z.array(macrosDayCaloriesSchema),
});

/** `GET /api/food-log/week-totals`, unwrapped. */
export const macrosWeekTotalsSchema = macrosCalendarTotalsSchema;

export const macrosNutritionOverviewRangeSchema = z.enum([
  "today",
  "yesterday",
  "1w",
  "1m",
  "3m",
  "1y",
]);

export const macrosNutritionOverviewQuerySchema = z.object({
  range: macrosNutritionOverviewRangeSchema.optional(),
  date: z.iso.date().optional(),
});

export const macrosNutrientRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  unit: z.string(),
  sortOrder: z.number(),
  consumed: z.number(),
  target: z.number().nullable(),
  /** `limit` targets are ceilings (sodium, saturated fat, …), not goals. */
  targetKind: z.enum(["target", "limit"]).default("target"),
  upperLimit: z.number().nullable(),
});

/** `GET /api/food-log/overview`, unwrapped. */
export const macrosNutritionOverviewSchema = z.object({
  range: macrosNutritionOverviewRangeSchema,
  startDate: z.string(),
  endDate: z.string(),
  daysCount: z.number(),
  timezone: z.string(),
  nutrients: z.array(macrosNutrientRowSchema),
  targets: macrosNutritionTargetsSchema,
});

export const macrosFoodLogDayStatusSchema = z.enum([
  "empty",
  "partial",
  "full",
]);

export const macrosFoodLogActivityDaySchema = z.object({
  date: z.string(),
  calories: z.number(),
  status: macrosFoodLogDayStatusSchema,
});

export const macrosFoodLoggingSummarySchema = z.object({
  last30Days: z.array(macrosFoodLogActivityDaySchema),
  fullThisWeek: z.number(),
  partialThisWeek: z.number(),
  emptyThisWeek: z.number(),
});

export const macrosFoodLogActivityOverviewSchema = z.object({
  today: z.string(),
  timezone: z.string(),
  calorieTarget: z.number().nullable(),
  years: z.array(z.number()),
  days: z.array(macrosFoodLogActivityDaySchema),
  summary: macrosFoodLoggingSummarySchema,
});

export const macrosFoodLogActivityResponseSchema = z.object({
  activity: macrosFoodLogActivityOverviewSchema,
  fetchedAt: z.string(),
});

export const macrosDailyNutrientTotalsResponseSchema = z.object({
  totals: macrosNutrientAmountsSchema,
});

export const macrosDayNoteBodySchema = z.object({
  logDate: z.iso.date(),
  note: z.string().max(2000),
});

export const macrosDayNoteResponseSchema = z.object({
  note: z.string().nullable(),
});

export const macrosUpdateLogEntryResponseSchema = z.object({
  entry: z.object({
    id: z.uuid(),
    servingsConsumed: z.number(),
  }),
});

export const macrosDeleteLogEntryResponseSchema = z.object({
  success: z.literal(true),
  logDate: z.string(),
});

export const macrosDuplicateLogEntryResponseSchema = z.object({
  entryId: z.uuid(),
});

export const macrosMoveEntriesResponseSchema = z.object({
  moved: z.number().int().nonnegative(),
});

export const macrosBulkDeleteEntriesResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
});

export const macrosCopyLogResponseSchema = z.object({
  entryIds: z.array(z.uuid()),
  copied: z.number().int().nonnegative(),
});

export type MacrosFoodLogDayQuery = z.infer<typeof macrosFoodLogDayQuerySchema>;
export type MacrosFoodLogEntry = z.infer<typeof macrosFoodLogEntrySchema>;
export type MacrosFoodLogDay = z.infer<typeof macrosFoodLogDaySchema>;
export type MacrosFoodLogCalendarTotalsQuery = z.infer<
  typeof macrosFoodLogCalendarTotalsQuerySchema
>;
export type MacrosFoodLogWeekTotalsQuery = z.infer<
  typeof macrosFoodLogWeekTotalsQuerySchema
>;
export type MacrosDayCalories = z.infer<typeof macrosDayCaloriesSchema>;
export type MacrosCalendarTotals = z.infer<typeof macrosCalendarTotalsSchema>;
export type MacrosWeekTotals = z.infer<typeof macrosWeekTotalsSchema>;
export type MacrosNutritionOverviewRange = z.infer<
  typeof macrosNutritionOverviewRangeSchema
>;
export type MacrosNutritionOverviewQuery = z.infer<
  typeof macrosNutritionOverviewQuerySchema
>;
export type MacrosNutrientRow = z.infer<typeof macrosNutrientRowSchema>;
export type MacrosNutritionOverview = z.infer<
  typeof macrosNutritionOverviewSchema
>;
export type MacrosFoodLogDayStatus = z.infer<
  typeof macrosFoodLogDayStatusSchema
>;
export type MacrosFoodLogActivityDay = z.infer<
  typeof macrosFoodLogActivityDaySchema
>;
export type MacrosFoodLoggingSummary = z.infer<
  typeof macrosFoodLoggingSummarySchema
>;
export type MacrosFoodLogActivityOverview = z.infer<
  typeof macrosFoodLogActivityOverviewSchema
>;
export type MacrosFoodLogActivityResponse = z.infer<
  typeof macrosFoodLogActivityResponseSchema
>;
export type MacrosDailyNutrientTotalsResponse = z.infer<
  typeof macrosDailyNutrientTotalsResponseSchema
>;
export type MacrosDayNoteBody = z.infer<typeof macrosDayNoteBodySchema>;
export type MacrosDayNoteResponse = z.infer<typeof macrosDayNoteResponseSchema>;
export type MacrosUpdateLogEntryResponse = z.infer<
  typeof macrosUpdateLogEntryResponseSchema
>;
export type MacrosDeleteLogEntryResponse = z.infer<
  typeof macrosDeleteLogEntryResponseSchema
>;
export type MacrosDuplicateLogEntryResponse = z.infer<
  typeof macrosDuplicateLogEntryResponseSchema
>;
export type MacrosMoveEntriesResponse = z.infer<
  typeof macrosMoveEntriesResponseSchema
>;
export type MacrosBulkDeleteEntriesResponse = z.infer<
  typeof macrosBulkDeleteEntriesResponseSchema
>;
export type MacrosCopyLogResponse = z.infer<typeof macrosCopyLogResponseSchema>;
