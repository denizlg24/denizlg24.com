"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { setTodayNutritionTotals } from "@/lib/app-cache/api"
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys"
import { queryKeys } from "@/lib/app-cache/query-keys"
import { type LogFoodInput, logFoodResponseSchema } from "@/lib/foods/contracts"
import { writePendingFoods } from "@/lib/foods/pending-foods"
import {
  addOptimisticNutritionEntry,
  putConfirmedNutritionTotals,
  removeOptimisticNutritionEntries,
} from "@/lib/optimistic-nutrition"
import type { FoodLogDayPayload } from "@/lib/queries/food-log-day"
import {
  type LogRecipeInput,
  logRecipeResponseSchema,
} from "@/lib/recipes/contracts"
import {
  getPendingCalories,
  type PendingFood,
  saveFailedPendingFoods,
} from "./add-food-shared"

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  const body: unknown = await response.json()
  return body
}

async function postFoodLog(input: LogFoodInput) {
  const response = await fetch("/api/food-log/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  return logFoodResponseSchema.parse(await readJsonResponse(response))
}

async function postRecipeLog(input: LogRecipeInput) {
  const response = await fetch("/api/food-log/recipe-entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  return logRecipeResponseSchema.parse(await readJsonResponse(response))
}

function isRecipeInput(input: PendingFood["input"]): input is LogRecipeInput {
  return "recipeId" in input
}

interface UseLogPendingFoodsOptions {
  pendingFoods: PendingFood[]
  setPendingFoods: Dispatch<SetStateAction<PendingFood[]>>
  setPendingSheetOpen: Dispatch<SetStateAction<boolean>>
  setExtraConsumed: Dispatch<SetStateAction<number>>
  today: string
}

export function useLogPendingFoods({
  pendingFoods,
  setPendingFoods,
  setPendingSheetOpen,
  setExtraConsumed,
  today,
}: UseLogPendingFoodsOptions) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const commitInFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const [isCommitting, setIsCommitting] = useState(false)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const logAllPending = useCallback(async () => {
    if (pendingFoods.length === 0 || commitInFlightRef.current) return

    commitInFlightRef.current = true
    setIsCommitting(true)

    try {
      const foodsToLog = pendingFoods
      const optimisticToday = foodsToLog
        .filter((food) => food.input.logDate === today)
        .reduce((sum, food) => sum + getPendingCalories(food), 0)

      setPendingFoods([])
      writePendingFoods([])
      setPendingSheetOpen(false)
      setExtraConsumed((current) => current + optimisticToday)

      for (const food of foodsToLog) {
        const foodLogDate = food.input.logDate ?? today
        if (foodLogDate === today) {
          addOptimisticNutritionEntry({
            id: food.uid,
            logDate: today,
            macros: food.macros,
          })
        }

        queryClient.setQueryData<FoodLogDayPayload | undefined>(
          foodLogQueryKeys.day(foodLogDate),
          (prev) => {
            if (!prev) return prev
            const recipe =
              food.entryType === "recipe" || isRecipeInput(food.input)
            const fakeEntry: FoodLogDayPayload["entries"][number] = {
              id: food.uid,
              logDate: foodLogDate,
              eatenAt: food.input.eatenAt ?? null,
              mealType: food.input.mealType ?? "snack",
              entryType: recipe ? "recipe" : "food",
              foodId:
                recipe || !("sourceItemId" in food.input)
                  ? null
                  : food.input.sourceItemId,
              recipeId:
                recipe && "recipeId" in food.input ? food.input.recipeId : null,
              foodName: food.food.name,
              brand: food.food.brand ?? null,
              servingLabel: food.food.servingLabel ?? null,
              servingQuantity: 1,
              servingUnit: "serving",
              servingsConsumed: food.input.servingsConsumed,
              notes: null,
              calories: food.macros.calories,
              protein: food.macros.protein,
              carbs: food.macros.carbs,
              fat: food.macros.fat,
            }
            return {
              ...prev,
              entries: [...prev.entries, fakeEntry],
              totals: {
                calories: prev.totals.calories + food.macros.calories,
                protein: prev.totals.protein + food.macros.protein,
                carbs: prev.totals.carbs + food.macros.carbs,
                fat: prev.totals.fat + food.macros.fat,
              },
            }
          }
        )
      }

      router.push("/app")

      const failedFoods: PendingFood[] = []
      let succeededCount = 0

      for (const food of foodsToLog) {
        const result = await (isRecipeInput(food.input)
          ? postRecipeLog(food.input)
          : postFoodLog(food.input)
        ).catch(() => null)

        if (!result) {
          failedFoods.push(food)
          continue
        }

        succeededCount += 1
        removeOptimisticNutritionEntries([
          result.entry.clientMutationId ?? food.uid,
        ])

        if (result.entry.logDate === today) {
          putConfirmedNutritionTotals(result.entry.logDate, result.totals)
          setTodayNutritionTotals(
            queryClient,
            result.entry.logDate,
            result.totals
          )
        }
      }

      removeOptimisticNutritionEntries(failedFoods.map((food) => food.uid))

      if (failedFoods.length > 0) {
        saveFailedPendingFoods(failedFoods)
        toast.error("Some foods were not logged", {
          action: {
            label: "Retry",
            onClick: () => router.push("/app/add?retry=failed"),
          },
        })
      }

      if (succeededCount > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.calorieSummary,
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.foodHistory(20),
        })
        const touchedDates = new Set(
          foodsToLog.map((food) => food.input.logDate ?? today)
        )
        for (const date of touchedDates) {
          void queryClient.invalidateQueries({
            queryKey: foodLogQueryKeys.day(date),
          })
        }
        void queryClient.invalidateQueries({
          queryKey: ["food-log", "week-totals"],
        })
        void queryClient.invalidateQueries({
          queryKey: ["food-log", "overview"],
        })
        void queryClient.invalidateQueries({
          queryKey: foodLogQueryKeys.activity,
        })
      }
    } finally {
      commitInFlightRef.current = false
      if (mountedRef.current) {
        setIsCommitting(false)
      }
    }
  }, [
    pendingFoods,
    queryClient,
    router,
    setExtraConsumed,
    setPendingFoods,
    setPendingSheetOpen,
    today,
  ])

  return { isCommitting, logAllPending }
}
