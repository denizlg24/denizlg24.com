import { z } from "zod"

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(5, 7))
    const day = Number(value.slice(8, 10))
    const date = new Date(year, month - 1, day)
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    )
  }, "Invalid calendar date")

export const upsertWeighInBodySchema = z.object({
  logDate: isoDateSchema,
  weightKg: z.number().finite().positive().max(999),
  bodyFatPct: z.number().finite().min(0).max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

export type UpsertWeighInBody = z.infer<typeof upsertWeighInBodySchema>

export interface WeighInItem {
  id: string
  logDate: string
  measuredAt: string
  weightKg: number
  bodyFatPct: number | null
  notes: string | null
}

export interface WeightPoint {
  date: string
  weightKg: number
}

export interface WeightSummary {
  latestWeightKg: number | null
  latestLogDate: string | null
  weekAverageKg: number | null
  weekDifferenceKg: number | null
  weekPoints: WeightPoint[]
  lastSevenEntries: WeightPoint[]
  weighInsThisWeek: number
  last30Days: string[]
  trackedLast30Days: string[]
  streakDays: number
}

export interface WeightOverview {
  today: string
  timezone: string
  entries: WeighInItem[]
  summary: WeightSummary
}
