"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { setDashboardCaloriePreference } from "@/lib/app-cache/api"
import {
  getOptimisticNutritionForDate,
  subscribeToOptimisticNutrition,
} from "@/lib/optimistic-nutrition"
import type {
  CaloriePreference,
  DailyMacros,
  NutritionTargets,
} from "@/lib/queries/dashboard"
import { CalorieRing } from "./calorie-ring"

type Props = {
  today: string
  consumed: DailyMacros
  targets: NutritionTargets
  initialPreference: CaloriePreference
}

type View = CaloriePreference

const MACROS = [
  { key: "protein", label: "Protein", color: "#ef4444" },
  { key: "fat", label: "Fat", color: "#eab308" },
  { key: "carbs", label: "Carbs", color: "#22c55e" },
] as const

export function NutritionSection({
  today,
  consumed,
  targets,
  initialPreference,
}: Props) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>(initialPreference)
  const saveRequestSeq = useRef(0)
  const saveController = useRef<AbortController | null>(null)
  const [optimisticConsumed, setOptimisticConsumed] = useState(() =>
    getOptimisticNutritionForDate(today, consumed)
  )

  useEffect(() => {
    return () => saveController.current?.abort()
  }, [])

  useEffect(() => {
    setView(initialPreference)
  }, [initialPreference])

  useEffect(() => {
    function syncOptimisticConsumed() {
      setOptimisticConsumed(getOptimisticNutritionForDate(today, consumed))
    }

    syncOptimisticConsumed()
    return subscribeToOptimisticNutrition(syncOptimisticConsumed)
  }, [consumed, today])

  function handleViewChange(next: View) {
    if (next === view) return
    const previous = view
    setView(next)

    const requestId = saveRequestSeq.current + 1
    saveRequestSeq.current = requestId
    saveController.current?.abort()

    const controller = new AbortController()
    saveController.current = controller

    fetch("/api/profile/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caloriePreference: next }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`)
        }

        if (saveRequestSeq.current !== requestId) {
          return
        }

        setDashboardCaloriePreference(queryClient, next)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
        if (saveRequestSeq.current === requestId) {
          setView(previous)
        }
        console.error("Failed to persist calorie preference", error)
      })
  }

  const remaining: DailyMacros = {
    calories: Math.max(
      0,
      (targets.calories ?? 0) - optimisticConsumed.calories
    ),
    protein: Math.max(0, (targets.protein ?? 0) - optimisticConsumed.protein),
    carbs: Math.max(0, (targets.carbs ?? 0) - optimisticConsumed.carbs),
    fat: Math.max(0, (targets.fat ?? 0) - optimisticConsumed.fat),
  }

  const primaryData = view === "consumed" ? optimisticConsumed : remaining
  const secondaryData = view === "consumed" ? remaining : optimisticConsumed
  const primaryLabel = view === "consumed" ? "Consumed" : "Remaining"
  const secondaryLabel = view === "consumed" ? "Remaining" : "Consumed"

  return (
    <div>
      <div className="flex items-center px-4 gap-2">
        <div className="flex-1 text-center">
          <p className="text-2xl font-bold tabular-nums leading-none">
            {Math.round(secondaryData.calories)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{secondaryLabel}</p>
        </div>

        <div className="w-44 shrink-0">
          <CalorieRing
            consumed={optimisticConsumed.calories}
            target={targets.calories}
            view={view}
            primaryValue={primaryData.calories}
            primaryLabel={primaryLabel}
          />
        </div>

        <div className="flex-1 text-center">
          <p className="text-2xl font-bold tabular-nums leading-none">
            {targets.calories != null ? Math.round(targets.calories) : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Target</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 px-5 mt-4">
        {MACROS.map(({ key, label, color }) => {
          const value = primaryData[key]
          const target = targets[key]
          const pct =
            target != null && target > 0
              ? Math.min((value / target) * 100, 100)
              : 0
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground text-center">
                {label}
              </p>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <p className="text-xs text-center tabular-nums font-medium">
                {Math.round(value)} /{" "}
                {target != null ? Math.round(target) : "—"}g
              </p>
            </div>
          )
        })}
      </div>

      <div className="flex justify-center mt-6">
        <Tabs value={view} onValueChange={(v) => handleViewChange(v as View)}>
          <TabsList className="rounded-full px-1">
            <TabsTrigger value="consumed" className="rounded-full px-6">
              Consumed
            </TabsTrigger>
            <TabsTrigger value="remaining" className="rounded-full px-6">
              Remaining
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
