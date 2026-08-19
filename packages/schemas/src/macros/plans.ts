import { z } from "zod";
import { macrosGoalTypeSchema } from "./goals";

export const macrosPlanDayInputSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  calorieTarget: z.number().finite().positive().max(20000),
  proteinTarget: z.number().finite().min(0).max(2000),
  carbsTarget: z.number().finite().min(0).max(2000),
  fatTarget: z.number().finite().min(0).max(2000),
});
export const macrosUpsertPlanBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    goalType: macrosGoalTypeSchema,
    activityLevel: z
      .enum(["sedentary", "light", "moderate", "active", "very_active"])
      .optional(),
    days: z.array(macrosPlanDayInputSchema).length(7),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.days.map((day) => day.weekday)).size !== 7) {
      ctx.addIssue({
        code: "custom",
        message: "Days must contain exactly 7 unique weekdays (0-6)",
        path: ["days"],
      });
    }
  });
export const macrosPlanDaySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  calorieTarget: z.number().nullable(),
  proteinTarget: z.number().nullable(),
  carbsTarget: z.number().nullable(),
  fatTarget: z.number().nullable(),
});
export const macrosPlanDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  goalType: macrosGoalTypeSchema,
  startDate: z.string(),
  baseCalorieTarget: z.number().nullable(),
  baseProteinTarget: z.number().nullable(),
  baseCarbsTarget: z.number().nullable(),
  baseFatTarget: z.number().nullable(),
  days: z.array(macrosPlanDaySchema),
});
export type MacrosPlanGoalType = z.infer<typeof macrosGoalTypeSchema>;
export type MacrosUpsertPlanBody = z.infer<typeof macrosUpsertPlanBodySchema>;
export type MacrosPlanDay = z.infer<typeof macrosPlanDaySchema>;
export type MacrosPlanDetail = z.infer<typeof macrosPlanDetailSchema>;
