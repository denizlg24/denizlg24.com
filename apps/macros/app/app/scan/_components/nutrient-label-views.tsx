"use client"

import { Repeat } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { NutrientKey } from "@/lib/foods/nutrients"
import { nutrientDefinitionsInput } from "@/lib/foods/nutrients"
import {
  fromCanonical,
  getDisplayUnit,
  isToggleableNutrient,
  type ToggleableNutrientKey,
  toCanonical,
  UNIT_OPTIONS,
  type UnitPref,
} from "@/lib/foods/unit-conversions"
import { NUTRIENT_SECTIONS, WHO_DAILY_VALUES } from "@/lib/foods/who-guidelines"

const NUTRIENT_ALIASES: Partial<Record<NutrientKey, string>> = {
  a: "Retinol",
  b1: "Thiamin",
  b2: "Riboflavin",
  b3: "Niacin",
  b5: "Pantothenic acid",
  b6: "Pyridoxine",
  b12: "Cobalamin",
  c: "Ascorbic acid",
  d: "Cholecalciferol",
  e: "Tocopherol",
  k: "Phylloquinone",
  folate: "Folic acid",
}

function NutrientLabelText({
  label,
  nutrientKey,
}: {
  label: string
  nutrientKey: NutrientKey
}) {
  const alias = NUTRIENT_ALIASES[nutrientKey]
  return (
    <>
      {label}
      {alias ? (
        <span className="ml-1 text-muted-foreground">({alias})</span>
      ) : null}
    </>
  )
}

const PARTIAL_NUMERIC_RE = /^\d*\.?\d*$/

function DraftNumberInput({
  value,
  onCommit,
  className,
  ariaLabel,
  renderInput,
}: {
  value: string
  onCommit: (raw: string) => void
  className?: string
  ariaLabel?: string
  renderInput?: (props: {
    value: string
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    onFocus: () => void
    onBlur: () => void
    inputMode: "decimal"
    type: "text"
    "aria-label"?: string
  }) => ReactNode
}) {
  const [local, setLocal] = useState(value)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setLocal(value)
  }, [value])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = event.target.value.replace(/,/g, ".")
    if (normalized !== "" && !PARTIAL_NUMERIC_RE.test(normalized)) return
    setLocal(normalized)
    onCommit(normalized)
  }

  const handleFocus = () => {
    focusedRef.current = true
  }

  const handleBlur = () => {
    focusedRef.current = false
    setLocal(value)
  }

  if (renderInput) {
    return renderInput({
      value: local,
      onChange: handleChange,
      onFocus: handleFocus,
      onBlur: handleBlur,
      inputMode: "decimal",
      type: "text",
      "aria-label": ariaLabel,
    })
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={local}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      className={
        className ??
        "h-8 w-16 rounded border border-input bg-background px-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      }
    />
  )
}

export interface NutrientLabelProps {
  drafts: Record<string, string>
  setDraft: (key: NutrientKey, raw: string) => void
  scaleFactor: number
  basisLabel: string
  unitPref: UnitPref
  cycleUnit: (key: ToggleableNutrientKey) => void
  setUnit: (key: ToggleableNutrientKey, value: string) => void
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ""
  if (Math.abs(value) < 0.01 && value !== 0) {
    return value.toPrecision(2)
  }
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toString()
}

function getDvPercent(
  key: NutrientKey,
  perServingValue: number
): number | null {
  const dv = WHO_DAILY_VALUES[key]
  if (dv == null || dv === 0) return null
  return Math.round((perServingValue / dv) * 100)
}

function getInputUnit(key: NutrientKey, unitPref: UnitPref): string {
  const def = nutrientDefinitionsInput.find((item) => item.key === key)
  if (!def) return ""
  if (isToggleableNutrient(key)) {
    return getDisplayUnit(key, unitPref[key])
  }
  return def.unit
}

function getDisplayValue(
  key: NutrientKey,
  drafts: Record<string, string>,
  unitPref: UnitPref,
  scaleFactor: number
): string {
  const draft = drafts[key]
  if (draft == null || draft === "") return ""
  const parsed = Number.parseFloat(draft)
  if (!Number.isFinite(parsed)) return ""
  const scaled = parsed * scaleFactor
  if (isToggleableNutrient(key)) {
    return formatNumber(fromCanonical(key, unitPref[key], scaled))
  }
  return formatNumber(scaled)
}

function commitInput(
  key: NutrientKey,
  raw: string,
  unitPref: UnitPref,
  scaleFactor: number,
  setDraft: (key: NutrientKey, raw: string) => void
) {
  if (raw.trim() === "") {
    setDraft(key, "")
    return
  }
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    setDraft(key, "")
    return
  }
  let canonical = parsed
  if (isToggleableNutrient(key)) {
    canonical = toCanonical(key, unitPref[key], parsed)
  }
  const per100g = scaleFactor === 0 ? 0 : canonical / scaleFactor
  setDraft(key, per100g.toString())
}

interface RowInputProps {
  nutrientKey: NutrientKey
  drafts: Record<string, string>
  setDraft: (key: NutrientKey, raw: string) => void
  unitPref: UnitPref
  scaleFactor: number
}

interface AdditionalMicronutrientsProps {
  drafts: Record<string, string>
  setDraft: (key: NutrientKey, raw: string) => void
  unitPref: UnitPref
  scaleFactor: number
  cycleUnit: (key: ToggleableNutrientKey) => void
  excludedKeys: ReadonlySet<NutrientKey>
}

function NumericInput({
  nutrientKey,
  drafts,
  setDraft,
  unitPref,
  scaleFactor,
  className,
  ariaLabel,
}: RowInputProps & { className?: string; ariaLabel?: string }) {
  const displayValue = getDisplayValue(
    nutrientKey,
    drafts,
    unitPref,
    scaleFactor
  )
  return (
    <DraftNumberInput
      value={displayValue}
      onCommit={(raw) =>
        commitInput(nutrientKey, raw, unitPref, scaleFactor, setDraft)
      }
      className={className}
      ariaLabel={ariaLabel}
    />
  )
}

function AdditionalMicronutrients({
  drafts,
  setDraft,
  unitPref,
  scaleFactor,
  cycleUnit,
  excludedKeys,
}: AdditionalMicronutrientsProps) {
  const sections = NUTRIENT_SECTIONS.filter(
    (section) => section.title === "Vitamins" || section.title === "Minerals"
  )
    .map((section) => ({
      ...section,
      keys: section.keys.filter((key) => !excludedKeys.has(key)),
    }))
    .filter((section) => section.keys.length > 0)

  if (sections.length === 0) return null

  return (
    <section className="mt-3 border-t border-border pt-3">
      <h3 className="border-b border-border pb-1 text-sm font-semibold text-foreground">
        Additional vitamins and minerals
      </h3>
      <div className="mt-3 space-y-4">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 border-b border-border pb-1 text-sm font-semibold text-foreground">
              {section.title}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {section.keys.map((key) => {
                const def = nutrientDefinitionsInput.find(
                  (item) => item.key === key
                )
                if (!def) return null
                const isToggleable = isToggleableNutrient(key)
                return (
                  <div key={key} className="grid grid-cols-[1fr_auto] gap-2">
                    <span className="min-w-0 text-xs text-foreground">
                      <span className="block truncate">
                        <NutrientLabelText
                          label={def.label}
                          nutrientKey={key}
                        />
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        {getInputUnit(key, unitPref)}
                        {isToggleable ? (
                          <button
                            type="button"
                            onClick={() => cycleUnit(key)}
                            aria-label={`Toggle ${def.label} unit`}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Repeat className="size-3" />
                          </button>
                        ) : null}
                      </span>
                    </span>
                    <NumericInput
                      nutrientKey={key}
                      drafts={drafts}
                      setDraft={setDraft}
                      unitPref={unitPref}
                      scaleFactor={scaleFactor}
                      ariaLabel={`${def.label} value`}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function USLabel({
  drafts,
  setDraft,
  scaleFactor,
  basisLabel,
  unitPref,
  cycleUnit,
}: NutrientLabelProps) {
  const calories = drafts.calories
    ? Number.parseFloat(drafts.calories) * scaleFactor
    : 0

  const sodiumLabel = unitPref.sodium === "salt-g" ? "Salt" : "Sodium"
  const vitDLabel = "Vitamin D"
  const vitALabel = "Vitamin A"
  const vitELabel = "Vitamin E"
  const displayedMicronutrients = new Set<NutrientKey>([
    "d",
    "calcium",
    "iron",
    "potassium",
    "a",
    "c",
    "e",
  ])

  const macroRow = (
    key: NutrientKey,
    label: string,
    indent = 0,
    prefix = ""
  ) => {
    const draft = drafts[key]
    const perServing = draft ? Number.parseFloat(draft) * scaleFactor : 0
    const dv = getDvPercent(key, perServing)
    return (
      <div
        key={key}
        className="flex items-center justify-between border-b border-foreground/30 py-1"
        style={{ paddingLeft: `${indent}rem` }}
      >
        <div className="flex items-center gap-1 text-sm">
          {prefix && <span>{prefix}</span>}
          <span className={indent === 0 ? "font-bold" : ""}>{label}</span>
          <NumericInput
            nutrientKey={key}
            drafts={drafts}
            setDraft={setDraft}
            unitPref={unitPref}
            scaleFactor={scaleFactor}
            ariaLabel={`${label} value`}
          />
          <span className="text-xs">{getInputUnit(key, unitPref)}</span>
        </div>
        <div className="text-sm font-bold tabular-nums">
          {dv != null ? `${dv}%` : ""}
        </div>
      </div>
    )
  }

  const microRow = (key: NutrientKey, label: string) => {
    const draft = drafts[key]
    const perServing = draft ? Number.parseFloat(draft) * scaleFactor : 0
    const dv = getDvPercent(key, perServing)
    const isToggleable = isToggleableNutrient(key)
    return (
      <div
        key={key}
        className="flex items-center justify-between border-b border-foreground/30 py-1"
      >
        <div className="flex items-center gap-1 text-sm">
          <span>
            <NutrientLabelText label={label} nutrientKey={key} />
          </span>
          {isToggleable && (
            <button
              type="button"
              onClick={() => cycleUnit(key)}
              aria-label={`Toggle ${label} unit`}
              className="text-muted-foreground hover:text-foreground"
            >
              <Repeat className="size-3" />
            </button>
          )}
          <NumericInput
            nutrientKey={key}
            drafts={drafts}
            setDraft={setDraft}
            unitPref={unitPref}
            scaleFactor={scaleFactor}
            ariaLabel={`${label} value`}
          />
          <span className="text-xs">{getInputUnit(key, unitPref)}</span>
        </div>
        <div className="text-sm tabular-nums">{dv != null ? `${dv}%` : ""}</div>
      </div>
    )
  }

  return (
    <div className="border-2 border-foreground bg-background p-3 text-foreground">
      <h2 className="text-2xl font-black leading-none">Nutrition Facts</h2>
      <div className="mt-1 border-b border-foreground pb-2 text-xs">
        {basisLabel}
      </div>
      <div className="border-b-8 border-foreground py-1">
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-2 text-sm font-bold">
            <span>Calories</span>
            <NumericInput
              nutrientKey="calories"
              drafts={drafts}
              setDraft={setDraft}
              unitPref={unitPref}
              scaleFactor={scaleFactor}
              className="h-7 w-20 rounded border border-input bg-background px-2 text-right text-xs font-normal tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              ariaLabel="Calories value"
            />
            <span className="text-xs font-normal">kcal</span>
          </div>
          <div className="text-3xl font-black tabular-nums">
            {Math.round(calories)}
          </div>
        </div>
      </div>

      <div className="mt-1 border-b border-foreground pb-1 text-right text-xs font-bold">
        % Daily Value*
      </div>

      {macroRow("fat", "Total Fat")}
      {macroRow("saturated", "Saturated Fat", 1)}
      {macroRow("transFat", "Trans Fat", 1)}
      {macroRow("cholesterol", "Cholesterol")}
      {macroRow("sodium", sodiumLabel)}
      {macroRow("carbs", "Total Carbohydrate")}
      {macroRow("fiber", "Dietary Fiber", 1)}
      {macroRow("sugar", "Total Sugars", 1)}
      {macroRow("addedSugar", "Added Sugars", 2, "Incl.")}
      {macroRow("protein", "Protein")}

      <div className="border-b-8 border-foreground" />

      {microRow("d", vitDLabel)}
      {microRow("calcium", "Calcium")}
      {microRow("iron", "Iron")}
      {microRow("potassium", "Potassium")}
      {microRow("a", vitALabel)}
      {microRow("c", "Vitamin C")}
      {microRow("e", vitELabel)}

      <AdditionalMicronutrients
        drafts={drafts}
        setDraft={setDraft}
        unitPref={unitPref}
        scaleFactor={scaleFactor}
        cycleUnit={cycleUnit}
        excludedKeys={displayedMicronutrients}
      />

      <p className="pt-2 text-[10px] leading-tight text-muted-foreground">
        * Percent Daily Values are based on a 2,000 calorie diet.
      </p>
    </div>
  )
}

export function EULabel({
  drafts,
  setDraft,
  unitPref,
  cycleUnit,
}: NutrientLabelProps) {
  const fixedScale = 1
  const fixedBasis = "Per 100g"
  const [energyUnit, setEnergyUnit] = useState<"kcal" | "kj">("kcal")

  const energyKcal = drafts.calories
    ? Number.parseFloat(drafts.calories) * fixedScale
    : 0
  const energyKj = energyKcal * 4.184
  const energyDisplayValue =
    energyUnit === "kcal" ? formatNumber(energyKcal) : formatNumber(energyKj)

  const commitEnergyInput = (raw: string) => {
    if (raw.trim() === "") {
      setDraft("calories", "")
      return
    }

    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) {
      setDraft("calories", "")
      return
    }

    const kcal = energyUnit === "kcal" ? parsed : parsed / 4.184
    setDraft("calories", kcal.toString())
  }

  const row = (key: NutrientKey, label: string, indent = 0) => {
    const isToggleable = isToggleableNutrient(key)
    return (
      <div
        key={key}
        className="flex items-center justify-between border-b border-border py-2"
        style={{ paddingLeft: `${indent}rem` }}
      >
        <div className="flex items-center gap-1 text-sm">
          <span
            className={indent === 0 ? "font-medium" : "text-muted-foreground"}
          >
            {label}
          </span>
          {isToggleable && (
            <button
              type="button"
              onClick={() => cycleUnit(key)}
              aria-label={`Toggle ${label} unit`}
              className="text-muted-foreground hover:text-foreground"
            >
              <Repeat className="size-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <NumericInput
            nutrientKey={key}
            drafts={drafts}
            setDraft={setDraft}
            unitPref={unitPref}
            scaleFactor={fixedScale}
            ariaLabel={`${label} value`}
          />
          <span className="w-8 text-xs text-muted-foreground">
            {getInputUnit(key, unitPref)}
          </span>
        </div>
      </div>
    )
  }

  const sodiumLabel = unitPref.sodium === "salt-g" ? "Salt" : "Sodium"
  const displayedMicronutrients = new Set<NutrientKey>(["sodium"])

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">Nutrition Information</h3>
        <p className="text-xs text-muted-foreground">{fixedBasis}</p>
      </div>
      <div className="divide-y divide-border px-3">
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-medium">Energy</span>
          <div className="flex items-center gap-2">
            <DraftNumberInput
              value={energyDisplayValue}
              onCommit={(raw) => commitEnergyInput(raw)}
              ariaLabel="Energy value"
              className="h-8 w-20 rounded border border-input bg-background px-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={() =>
                setEnergyUnit((current) => (current === "kcal" ? "kj" : "kcal"))
              }
              aria-label="Toggle energy unit"
              className="inline-flex w-10 items-center justify-end gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {energyUnit === "kcal" ? "kcal" : "kJ"}
              <Repeat className="size-3" />
            </button>
          </div>
        </div>
        {row("fat", "Fat")}
        {row("saturated", "of which saturates", 1)}
        {row("monoUnsaturated", "of which monounsaturates", 1)}
        {row("polyUnsaturated", "of which polyunsaturates", 1)}
        {row("carbs", "Carbohydrate")}
        {row("sugar", "of which sugars", 1)}
        {row("addedSugar", "of which added sugars", 1)}
        {row("fiber", "Fibre")}
        {row("protein", "Protein")}
        {row("sodium", sodiumLabel)}
      </div>
      <div className="px-3 pb-3">
        <AdditionalMicronutrients
          drafts={drafts}
          setDraft={setDraft}
          unitPref={unitPref}
          scaleFactor={fixedScale}
          cycleUnit={cycleUnit}
          excludedKeys={displayedMicronutrients}
        />
      </div>
    </div>
  )
}

export function DetailLabel({
  drafts,
  setDraft,
  scaleFactor,
  unitPref,
  setUnit,
}: NutrientLabelProps) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 border-b border-border pb-1 text-sm font-semibold text-foreground">
          Energy
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="detail-calories"
                className="text-xs text-muted-foreground"
              >
                Calories
              </label>
              <span className="text-xs text-muted-foreground">kcal</span>
            </div>
            <DraftNumberInput
              value={getDisplayValue("calories", drafts, unitPref, scaleFactor)}
              onCommit={(raw) =>
                commitInput("calories", raw, unitPref, scaleFactor, setDraft)
              }
              ariaLabel="Calories value"
              renderInput={(props) => (
                <Input
                  id="detail-calories"
                  className="h-11 text-base tabular-nums"
                  {...props}
                />
              )}
            />
          </div>
        </div>
      </section>
      {NUTRIENT_SECTIONS.map((section) => (
        <section key={section.title}>
          <h3 className="mb-2 border-b border-border pb-1 text-sm font-semibold text-foreground">
            {section.title}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {section.keys.map((key) => {
              const def = nutrientDefinitionsInput.find(
                (item) => item.key === key
              )
              if (!def) return null
              const isToggleable = isToggleableNutrient(key)
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor={`detail-${key}`}
                      className="text-xs text-foreground"
                    >
                      <NutrientLabelText label={def.label} nutrientKey={key} />
                    </label>
                    {isToggleable ? (
                      <Select
                        value={unitPref[key]}
                        onValueChange={(value) => setUnit(key, value)}
                      >
                        <SelectTrigger
                          size="sm"
                          className="h-6 w-auto gap-1 px-2 py-0 text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNIT_OPTIONS[key].map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="text-xs"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {def.unit}
                      </span>
                    )}
                  </div>
                  <DraftNumberInput
                    value={getDisplayValue(key, drafts, unitPref, scaleFactor)}
                    onCommit={(raw) =>
                      commitInput(key, raw, unitPref, scaleFactor, setDraft)
                    }
                    ariaLabel={`${def.label} value`}
                    renderInput={(props) => (
                      <Input
                        id={`detail-${key}`}
                        className="h-11 text-base tabular-nums"
                        {...props}
                      />
                    )}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
