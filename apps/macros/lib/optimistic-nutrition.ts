"use client"

import { z } from "zod"
import type { DailyMacros } from "@/lib/queries/dashboard"

export type OptimisticDailyMacros = DailyMacros

interface OptimisticNutritionEntry {
  id: string
  logDate: string
  macros: OptimisticDailyMacros
}

interface ConfirmedNutritionTotals {
  logDate: string
  confirmedAt: number
  macros: OptimisticDailyMacros
}

const STORAGE_KEY = "macros.optimistic-nutrition.v1"
const CONFIRMED_STORAGE_KEY = "macros.confirmed-nutrition.v1"
const EVENT_NAME = "macros:optimistic-nutrition"
const CONFIRMED_TOTAL_TTL_MS = 60_000
const optimisticNutritionEntrySchema = z.object({
  id: z.string(),
  logDate: z.string(),
  macros: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
})
const confirmedNutritionTotalsSchema = z.object({
  logDate: z.string(),
  confirmedAt: z.number(),
  macros: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
})

function zeroMacros(): OptimisticDailyMacros {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 }
}

function isEntry(value: unknown): value is OptimisticNutritionEntry {
  return optimisticNutritionEntrySchema.safeParse(value).success
}

function isConfirmedTotals(value: unknown): value is ConfirmedNutritionTotals {
  return confirmedNutritionTotalsSchema.safeParse(value).success
}

function readStoredArray<T>(
  key: string,
  predicate: (value: unknown) => value is T
): T[] {
  if (typeof window === "undefined") return []

  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(predicate) : []
  } catch {
    return []
  }
}

function readEntries(): OptimisticNutritionEntry[] {
  return readStoredArray(STORAGE_KEY, isEntry)
}

function readConfirmedTotals(): ConfirmedNutritionTotals[] {
  return readStoredArray(CONFIRMED_STORAGE_KEY, isConfirmedTotals)
}

function writeStoredArray(key: string, values: unknown[]) {
  if (typeof window === "undefined") return

  try {
    window.sessionStorage.setItem(key, JSON.stringify(values))
    window.dispatchEvent(new Event(EVENT_NAME))
  } catch (error) {
    console.warn("Failed to update optimistic nutrition storage", error)
  }
}

function writeEntries(entries: OptimisticNutritionEntry[]) {
  writeStoredArray(STORAGE_KEY, entries)
}

export function addOptimisticNutritionEntry(entry: OptimisticNutritionEntry) {
  writeEntries([...readEntries(), entry])
}

export function removeOptimisticNutritionEntries(ids: string[]) {
  if (ids.length === 0) return
  const idSet = new Set(ids)
  writeEntries(readEntries().filter((entry) => !idSet.has(entry.id)))
}

export function putConfirmedNutritionTotals(
  logDate: string,
  macros: OptimisticDailyMacros
) {
  const nextTotals: ConfirmedNutritionTotals = {
    logDate,
    confirmedAt: Date.now(),
    macros,
  }
  writeStoredArray(CONFIRMED_STORAGE_KEY, [
    ...readConfirmedTotals().filter((totals) => totals.logDate !== logDate),
    nextTotals,
  ])
}

export function getOptimisticNutritionForDate(
  logDate: string,
  serverMacros?: OptimisticDailyMacros
): OptimisticDailyMacros {
  const optimisticMacros = readEntries()
    .filter((entry) => entry.logDate === logDate)
    .reduce((total, entry) => addMacros(total, entry.macros), zeroMacros())

  if (!serverMacros) return optimisticMacros

  const now = Date.now()
  const confirmed = readConfirmedTotals().find(
    (totals) =>
      totals.logDate === logDate &&
      now - totals.confirmedAt <= CONFIRMED_TOTAL_TTL_MS &&
      totals.macros.calories >= serverMacros.calories
  )

  return addMacros(confirmed?.macros ?? serverMacros, optimisticMacros)
}

export function subscribeToOptimisticNutrition(onStoreChange: () => void) {
  window.addEventListener(EVENT_NAME, onStoreChange)
  window.addEventListener("storage", onStoreChange)

  return () => {
    window.removeEventListener(EVENT_NAME, onStoreChange)
    window.removeEventListener("storage", onStoreChange)
  }
}

export function addMacros(
  left: OptimisticDailyMacros,
  right: OptimisticDailyMacros
): OptimisticDailyMacros {
  return {
    calories: left.calories + right.calories,
    protein: left.protein + right.protein,
    carbs: left.carbs + right.carbs,
    fat: left.fat + right.fat,
  }
}
