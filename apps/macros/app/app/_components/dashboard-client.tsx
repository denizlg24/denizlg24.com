"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useHydrated } from "@/hooks/use-hydrated"
import { useDashboardData } from "@/lib/app-cache/api"
import type { FoodLoggingSummary } from "@/lib/food-logging/activity"
import type { WeightSummary } from "@/lib/weights/contracts"
import { BodyMetricsSection } from "./body-metrics-section"
import { HabitsSection } from "./habits-section"
import { InsightsSection } from "./insights-section"
import { NutritionSection } from "./nutrition-section"

const emptyWeightSummary: WeightSummary = {
  last30Days: [],
  lastSevenEntries: [],
  latestLogDate: null,
  latestWeightKg: null,
  streakDays: 0,
  trackedLast30Days: [],
  weekAverageKg: null,
  weekDifferenceKg: null,
  weekPoints: [],
  weighInsThisWeek: 0,
}

const emptyFoodLoggingSummary: FoodLoggingSummary = {
  emptyThisWeek: 0,
  fullThisWeek: 0,
  last30Days: [],
  partialThisWeek: 0,
}

function DashboardFallback() {
  return (
    <div className="min-h-dvh pb-36">
      <div className="px-5 pt-6 pb-4">
        <Skeleton className="h-3 w-44 mb-2" />
        <Skeleton className="h-8 w-40 mt-1" />
      </div>
      <div className="px-5 mb-2">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex items-center px-4 gap-2">
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="w-44 shrink-0 flex justify-center">
          <Skeleton className="size-40 rounded-full" />
        </div>
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  )
}

export function DashboardClient() {
  const hydrated = useHydrated()
  const { data, error, isError, refetch } = useDashboardData()

  if (!hydrated) {
    return <DashboardFallback />
  }

  if (isError && !data) {
    return (
      <div className="min-h-screen px-5 pt-6 pb-36">
        <h1 className="mb-4 text-3xl font-black tracking-tight">DASHBOARD</h1>
        <Alert variant="destructive">
          <AlertTitle>Could not load dashboard</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Refresh your nutrition snapshot and try again."}
          </AlertDescription>
          <div className="mt-3">
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    )
  }

  if (!data) {
    return <DashboardFallback />
  }

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: data.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(new Date())
    .toUpperCase()
  const weightSummary = data.weightSummary ?? emptyWeightSummary
  const foodLoggingSummary = data.foodLoggingSummary ?? emptyFoodLoggingSummary

  return (
    <div className="min-h-dvh pb-36">
      <div className="px-5 pt-6 pb-4">
        <p className="text-xs text-muted-foreground tracking-widest mb-1">
          {dateLabel}
        </p>
        <h1 className="text-3xl font-black tracking-tight">DASHBOARD</h1>
      </div>

      <div className="px-5 mb-2">
        <p className="text-lg font-bold">Daily Nutrition</p>
      </div>
      <NutritionSection
        today={data.today}
        consumed={data.consumed}
        targets={data.targets}
        initialPreference={data.caloriePreference}
      />

      <div className="h-px bg-border mx-5 mt-6" />

      <InsightsSection
        energyBalance={data.energyBalance}
        goalProgress={data.goalProgress}
      />

      <HabitsSection
        foodLoggingSummary={foodLoggingSummary}
        weightSummary={weightSummary}
      />
      <BodyMetricsSection weightSummary={weightSummary} />
    </div>
  )
}
