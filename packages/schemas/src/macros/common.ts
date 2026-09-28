import { z } from "zod";

export const macrosIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 0);
    return (
      date.getFullYear() === year &&
      date.getMonth() === (month ?? 1) - 1 &&
      date.getDate() === day
    );
  }, "Invalid calendar date");

export const macrosMealTypeSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);

export const macrosEntryTypeSchema = z.enum(["food", "recipe", "quick_add"]);

export const macrosCaloriePreferenceSchema = z.enum(["consumed", "remaining"]);

export const macrosNutrientAmountsSchema = z.record(z.string(), z.number());

export const macrosDailyMacrosSchema = z.object({
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

export const macrosNutritionTargetsSchema = z.object({
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
});

export const macrosApiErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
});

export const macrosOkResponseSchema = z.object({ ok: z.literal(true) });

export type MacrosIsoDate = z.infer<typeof macrosIsoDateSchema>;
export type MacrosMealType = z.infer<typeof macrosMealTypeSchema>;
export type MacrosEntryType = z.infer<typeof macrosEntryTypeSchema>;
export type MacrosCaloriePreference = z.infer<
  typeof macrosCaloriePreferenceSchema
>;
export type MacrosNutrientAmounts = z.infer<typeof macrosNutrientAmountsSchema>;
export type MacrosDailyMacros = z.infer<typeof macrosDailyMacrosSchema>;
export type MacrosNutritionTargets = z.infer<
  typeof macrosNutritionTargetsSchema
>;
export type MacrosApiError = z.infer<typeof macrosApiErrorSchema>;
export type MacrosOkResponse = z.infer<typeof macrosOkResponseSchema>;
