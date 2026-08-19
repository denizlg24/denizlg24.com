"use client"

import { ChevronDown } from "lucide-react"
import { useState } from "react"
import {
  type NutrientKey,
  nutrientDefinitionsInput,
} from "@/lib/foods/nutrients"
import type { RecipeIngredientDetail } from "@/lib/recipes/contracts"

const SKIP_KEYS = new Set<NutrientKey>([
  "calories",
  "protein",
  "carbs",
  "fat",
  "water",
  "alcohol",
])

const GROUP_ORDER: ReadonlyArray<{
  group: "macro" | "vitamin" | "mineral" | "amino_acid"
  title: string
}> = [
  { group: "macro", title: "Macros" },
  { group: "vitamin", title: "Vitamins" },
  { group: "mineral", title: "Minerals" },
  { group: "amino_acid", title: "Amino acids" },
]

function formatNutrient(value: number, unit: string) {
  if (!Number.isFinite(value) || value === 0) return `0 ${unit}`
  if (value < 0.1) return `${value.toPrecision(2)} ${unit}`
  if (value < 10) return `${value.toFixed(1)} ${unit}`
  return `${Math.round(value)} ${unit}`
}

export function MacroQuad({
  calories,
  protein,
  carbs,
  fat,
}: {
  calories: number
  protein: number
  carbs: number
  fat: number
}) {
  return (
    <div className="grid grid-cols-4 gap-2 rounded-xl bg-muted/40 p-3 text-center">
      <MacroTile label="kcal" value={calories} />
      <MacroTile label="P" value={protein} />
      <MacroTile label="F" value={fat} />
      <MacroTile label="C" value={carbs} />
    </div>
  )
}

function MacroTile({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{Math.round(value)}</p>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
    </div>
  )
}

export function ViewModeToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (next: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <div className="inline-flex w-full rounded-full bg-muted p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-8 flex-1 rounded-full px-3 text-xs font-semibold transition-colors ${
            value === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function IngredientListPanel({
  ingredients,
}: {
  ingredients: RecipeIngredientDetail[]
}) {
  return (
    <CollapsibleSection
      title="Ingredients"
      meta={`${ingredients.length} item${ingredients.length === 1 ? "" : "s"}`}
      defaultOpen
    >
      <ul className="divide-y divide-border/50">
        {ingredients.map((ingredient) => {
          const servingsLabel =
            ingredient.servings % 1 === 0
              ? ingredient.servings.toString()
              : ingredient.servings.toFixed(2)
          return (
            <li
              key={ingredient.id}
              className="flex items-start gap-3 py-2.5 first:pt-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {ingredient.foodName}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {ingredient.brand ? `${ingredient.brand} - ` : ""}
                  {servingsLabel} serving
                  {ingredient.servings === 1 ? "" : "s"}
                </p>
              </div>
              <div className="text-right text-xs tabular-nums">
                <p className="font-semibold text-foreground">
                  {Math.round(ingredient.caloriesContribution)} kcal
                </p>
                <p className="text-muted-foreground">
                  {Math.round(ingredient.proteinContribution)}P{" "}
                  {Math.round(ingredient.fatContribution)}F{" "}
                  {Math.round(ingredient.carbsContribution)}C
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </CollapsibleSection>
  )
}

export function MicronutrientPanel({
  nutrientsPerServing,
  scale,
}: {
  nutrientsPerServing: Record<string, number>
  scale: number
}) {
  const grouped = GROUP_ORDER.map(({ group, title }) => {
    const rows = nutrientDefinitionsInput
      .filter((definition) => definition.group === group)
      .filter((definition) => !SKIP_KEYS.has(definition.key))
      .map((definition) => ({
        ...definition,
        value: (nutrientsPerServing[definition.key] ?? 0) * scale,
      }))
      .filter((row) => row.value > 0)
    return { group, title, rows }
  }).filter((section) => section.rows.length > 0)

  if (grouped.length === 0) {
    return null
  }

  return (
    <CollapsibleSection title="Micronutrients">
      <div className="space-y-3 pt-2">
        {grouped.map((section) => (
          <div key={section.group}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {section.rows.map((row) => (
                <li
                  key={row.key}
                  className="flex items-baseline justify-between gap-2 border-b border-border/40 pb-1"
                >
                  <span className="truncate text-xs text-foreground">
                    {row.label}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatNutrient(row.value, row.unit)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}

export function CollapsibleSection({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string
  meta?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-xl border border-border/60 bg-background">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between px-3 py-2.5"
      >
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {meta ? <span className="tabular-nums">{meta}</span> : null}
          <ChevronDown
            className={`size-4 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </section>
  )
}

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}
