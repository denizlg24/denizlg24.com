"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useHydrated } from "@/hooks/use-hydrated"
import { useDailyCalorieSummary } from "@/lib/app-cache/api"
import { AddFoodLogic } from "./add-food-logic"

function AddFoodFallback() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <Skeleton className="h-9 flex-1 rounded-full" />
        </div>
        <Skeleton className="h-9 w-24 rounded-full" />
        <div className="flex justify-end">
          <Skeleton className="size-9 rounded-full" />
        </div>
      </div>
      <div className="flex-1 px-4 pt-4">
        <Skeleton className="mb-3 h-5 w-28" />
        {[1, 2, 3, 4, 5].map((item) => (
          <div
            key={item}
            className="flex items-center gap-2 border-b border-border/50 py-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-14 shrink-0 rounded-full" />
            <Skeleton className="size-8 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AddFoodPageClient() {
  const hydrated = useHydrated()
  const { data, error, isError, refetch } = useDailyCalorieSummary()

  if (!hydrated) {
    return <AddFoodFallback />
  }

  if (isError && !data) {
    return (
      <div className="flex h-dvh flex-col px-4 pt-4">
        <Alert variant="destructive">
          <AlertTitle>Could not load today&apos;s summary</AlertTitle>
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
    return <AddFoodFallback />
  }

  return <AddFoodLogic calorieSummary={data} />
}
