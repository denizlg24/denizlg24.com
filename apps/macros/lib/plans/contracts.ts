import { z } from "zod"

export const planGoalTypeSchema = z.enum(["lose", "maintain", "gain"])
export type PlanGoalType = z.infer<typeof planGoalTypeSchema>

export const planDayInputSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  calorieTarget: z.number().finite().positive().max(20000),
  proteinTarget: z.number().finite().min(0).max(2000),
  carbsTarget: z.number().finite().min(0).max(2000),
  fatTarget: z.number().finite().min(0).max(2000),
})

export const upsertPlanBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    goalType: planGoalTypeSchema,
    activityLevel: z
      .enum(["sedentary", "light", "moderate", "active", "very_active"])
      .optional(),
    days: z.array(planDayInputSchema).length(7),
  })
  .superRefine((data, ctx) => {
    const weekdays = new Set(data.days.map((d) => d.weekday))
    if (weekdays.size !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Days must contain exactly 7 unique weekdays (0-6)",
        path: ["days"],
      })
    }
  })

export type UpsertPlanBody = z.infer<typeof upsertPlanBodySchema>

export interface PlanDay {
  weekday: number
  calorieTarget: number | null
  proteinTarget: number | null
  carbsTarget: number | null
  fatTarget: number | null
}

export interface PlanDetail {
  id: string
  name: string
  goalType: PlanGoalType
  startDate: string
  baseCalorieTarget: number | null
  baseProteinTarget: number | null
  baseCarbsTarget: number | null
  baseFatTarget: number | null
  days: PlanDay[]
}
