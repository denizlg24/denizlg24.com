import { z } from "zod"

import { type LogFoodInput, logFoodBodySchema } from "@/lib/foods/contracts"
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition"
import {
  type LogRecipeInput,
  logRecipeBodySchema,
} from "@/lib/recipes/contracts"

export interface PendingFoodSummary {
  id: string
  name: string
  brand: string | null | undefined
  servingLabel: string | null | undefined
  caloriesPerServing: number | null | undefined
  proteinPerServing: number | null | undefined
  fatPerServing: number | null | undefined
  carbsPerServing: number | null | undefined
  totalWeightGrams?: number | null | undefined
  servings?: number | null | undefined
}

export interface PendingFood {
  uid: string
  entryType?: "food" | "recipe"
  food: PendingFoodSummary
  input: LogFoodInput | LogRecipeInput
  macros: OptimisticDailyMacros
}

export const PENDING_FOODS_STORAGE_EVENT = "macros:pending-foods"

const PENDING_FOODS_KEY = "macros.pending-foods.v1"

export const pendingFoodSchema = z.object({
  uid: z.uuid(),
  entryType: z.enum(["food", "recipe"]).optional().default("food"),
  food: z.object({
    id: z.uuid(),
    name: z.string(),
    brand: z.string().nullable().optional(),
    servingLabel: z.string().nullable().optional(),
    caloriesPerServing: z.number().nullable().optional(),
    proteinPerServing: z.number().nullable().optional(),
    fatPerServing: z.number().nullable().optional(),
    carbsPerServing: z.number().nullable().optional(),
    totalWeightGrams: z.number().nullable().optional(),
    servings: z.number().nullable().optional(),
  }),
  input: z.union([logFoodBodySchema, logRecipeBodySchema]),
  macros: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
})

export function readPendingFoods(): PendingFood[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_FOODS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (food): food is PendingFood => pendingFoodSchema.safeParse(food).success
    )
  } catch {
    return []
  }
}

export function writePendingFoods(foods: PendingFood[]) {
  try {
    if (foods.length === 0) {
      window.sessionStorage.removeItem(PENDING_FOODS_KEY)
    } else {
      window.sessionStorage.setItem(PENDING_FOODS_KEY, JSON.stringify(foods))
    }

    window.dispatchEvent(
      new CustomEvent(PENDING_FOODS_STORAGE_EVENT, { detail: foods })
    )
  } catch (error) {
    console.warn("Failed to store staged foods", error)
  }
}

export function subscribeToPendingFoods(
  onChange: (foods: PendingFood[]) => void
) {
  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (!Array.isArray(detail)) return
    const foods = detail.filter(
      (food): food is PendingFood => pendingFoodSchema.safeParse(food).success
    )
    onChange(foods)
  }

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== PENDING_FOODS_KEY) return
    onChange(readPendingFoods())
  }

  window.addEventListener(PENDING_FOODS_STORAGE_EVENT, handleCustomEvent)
  window.addEventListener("storage", handleStorageEvent)

  return () => {
    window.removeEventListener(PENDING_FOODS_STORAGE_EVENT, handleCustomEvent)
    window.removeEventListener("storage", handleStorageEvent)
  }
}
