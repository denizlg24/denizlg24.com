import { z } from "zod"

export const goalTypeSchema = z.enum(["lose", "maintain", "gain"])
export type GoalType = z.infer<typeof goalTypeSchema>

export const goalOutcomeSchema = z.enum(["loss", "gain", "maintain"])
export type GoalOutcome = z.infer<typeof goalOutcomeSchema>

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .pipe(z.coerce.date())
  .transform((d) => d.toISOString().slice(0, 10))

export const upsertGoalBodySchema = z.object({
  goalType: goalTypeSchema,
  startWeightKg: z.number().finite().positive().max(999).optional(),
  targetWeightKg: z.number().finite().positive().max(999).optional(),
  targetDate: dateSchema.optional(),
  weeklyRateKg: z.number().finite().min(0).max(2).optional(),
})

export type UpsertGoalBody = z.infer<typeof upsertGoalBodySchema>

export interface ActiveGoal {
  id: string
  goalType: GoalType
  startDate: string
  startWeightKg: number | null
  targetWeightKg: number | null
  targetDate: string | null
  weeklyRateKg: number | null
}

export interface GoalHistoryEntry {
  id: string
  goalType: GoalType
  startDate: string
  closedAt: string | null
  endDate: string | null
  startWeightKg: number | null
  endWeightKg: number | null
  targetWeightKg: number | null
  outcome: GoalOutcome | null
  achieved: boolean | null
  isActive: boolean
}
