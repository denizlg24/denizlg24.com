"use client"

import { type QueryClient, useQuery } from "@tanstack/react-query"
import type { FoodHistoryItem } from "@/lib/foods/contracts"
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary"
import type { DashboardData } from "@/lib/queries/dashboard"
import type { WeightOverview } from "@/lib/weights/contracts"
import { queryKeys } from "./query-keys"

interface DashboardResponse {
  dashboard: DashboardData
  fetchedAt: string
}

interface CalorieSummaryResponse {
  calorieSummary: DailyCalorieSummary
  fetchedAt: string
}

interface FoodHistoryResponse {
  items: FoodHistoryItem[]
  fetchedAt: string
}

interface WeightOverviewResponse {
  overview: WeightOverview
  fetchedAt: string
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal })

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function useDashboardData() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: async ({ signal }) => {
      const body = await fetchJson<DashboardResponse>(
        "/api/app/dashboard",
        signal
      )
      return body.dashboard
    },
  })
}

export function useDailyCalorieSummary() {
  return useQuery({
    queryKey: queryKeys.calorieSummary,
    queryFn: async ({ signal }) => {
      const body = await fetchJson<CalorieSummaryResponse>(
        "/api/app/calorie-summary",
        signal
      )
      return body.calorieSummary
    },
  })
}

export function useFoodHistory(limit = 20) {
  return useQuery({
    queryKey: queryKeys.foodHistory(limit),
    queryFn: ({ signal }) =>
      fetchJson<FoodHistoryResponse>(
        `/api/foods/history?limit=${limit}`,
        signal
      ),
  })
}

export function useWeightOverview() {
  return useQuery({
    queryKey: queryKeys.weightOverview,
    queryFn: async ({ signal }) => {
      const body = await fetchJson<WeightOverviewResponse>(
        "/api/weight/overview",
        signal
      )
      return body.overview
    },
  })
}

export function setDashboardCaloriePreference(
  queryClient: QueryClient,
  caloriePreference: DashboardData["caloriePreference"]
) {
  queryClient.setQueryData<DashboardData>(queryKeys.dashboard, (current) =>
    current ? { ...current, caloriePreference } : current
  )
  queryClient.setQueryData<DailyCalorieSummary>(
    queryKeys.calorieSummary,
    (current) =>
      current ? { ...current, preference: caloriePreference } : current
  )
}

export function setTodayNutritionTotals(
  queryClient: QueryClient,
  logDate: string,
  totals: DashboardData["consumed"]
) {
  queryClient.setQueryData<DashboardData>(queryKeys.dashboard, (current) => {
    if (!current || current.today !== logDate) return current

    return {
      ...current,
      consumed: totals,
      energyBalance: current.energyBalance.map((point) =>
        point.date === logDate ? { ...point, consumed: totals.calories } : point
      ),
    }
  })
  queryClient.setQueryData<DailyCalorieSummary>(
    queryKeys.calorieSummary,
    (current) =>
      current && current.today === logDate
        ? { ...current, consumed: totals.calories }
        : current
  )
}
