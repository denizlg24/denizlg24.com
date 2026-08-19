"use client"

import { format } from "date-fns"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  Minus,
  Plus,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import {
  ACTIVITY_LEVELS,
  type ActivityLevel,
  adjustSplit,
  buildWeekdayMacros,
  calculateMacros,
  computeAgeFromBirthDate,
  type DayMacros,
  type EnergyUnit,
  type GoalType,
  kgToLb,
  lbToKg,
  type MacroSplit,
  PROTEIN_PROFILES,
  type ProteinProfile,
  type Sex,
  WEEKDAY_FULL,
  type WeekdayDelta,
  type WeightUnit,
} from "@/lib/wizard/calc"

export type WizardMode = "full" | "program" | "goal"

export interface WizardInitial {
  sex?: Sex | ""
  birthDate?: string
  heightCm?: number
  activityLevel?: ActivityLevel | ""
  weightUnit?: WeightUnit
  energyUnit?: EnergyUnit
  currentWeightKg?: number
  goalType?: GoalType | ""
  targetWeightKg?: number
  goalDate?: string
  weeklyRateKg?: number
  proteinProfile?: ProteinProfile
  calories?: number
  split?: MacroSplit
  dayDeltas?: WeekdayDelta[]
  planName?: string
}

export interface WizardPayload {
  mode: WizardMode
  profile?: {
    timezone: string
    sex?: Sex
    birthDate?: string
    heightCm?: number
    activityLevel?: ActivityLevel
    weightUnit?: WeightUnit
    energyUnit?: EnergyUnit
  }
  currentWeightKg?: number
  weightGoal?: {
    goalType: GoalType
    targetWeightKg?: number
    targetDate?: string
    weeklyRateKg?: number
  }
  nutritionPlan?: {
    name?: string
    goalType: GoalType
    activityLevel?: ActivityLevel
    days: DayMacros[]
  }
}

interface OnboardingWizardProps {
  mode: WizardMode
  initial?: WizardInitial
  onSubmit: (payload: WizardPayload) => Promise<void>
  onCancel?: () => void
  cancelLabel?: string
  submitLabel?: string
  className?: string
}

type StepKey =
  | "units"
  | "profile"
  | "activity"
  | "weight"
  | "goal"
  | "macro-profile"
  | "calc"
  | "review"
  | "days"

const STEP_LISTS: Record<WizardMode, StepKey[]> = {
  full: [
    "units",
    "profile",
    "activity",
    "weight",
    "goal",
    "macro-profile",
    "calc",
    "review",
    "days",
  ],
  program: ["activity", "macro-profile", "calc", "review", "days"],
  goal: ["weight", "goal"],
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

function ChipButton({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  )
}

function StackedOption({
  selected,
  onClick,
  label,
  description,
  trailing,
}: {
  selected: boolean
  onClick: () => void
  label: string
  description?: string
  trailing?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all",
        selected
          ? "border-foreground bg-foreground/[0.04]"
          : "border-border hover:border-foreground/30"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {trailing ?? (
        <span
          aria-hidden
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-border"
          )}
        >
          {selected ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      )}
    </button>
  )
}

const CALC_MESSAGES = [
  "Analyzing your profile…",
  "Estimating energy expenditure…",
  "Calibrating macro ratios…",
  "Optimizing for your goal…",
  "Your plan is ready.",
]

function CalcAnimation({ onDone }: { onDone: () => void }) {
  const [msgIdx, setMsgIdx] = useState(0)
  useEffect(() => {
    if (msgIdx >= CALC_MESSAGES.length - 1) {
      const finish = setTimeout(onDone, 500)
      return () => clearTimeout(finish)
    }
    const t = setTimeout(() => setMsgIdx((i) => i + 1), 520)
    return () => clearTimeout(t)
  }, [msgIdx, onDone])

  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-10">
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2 rounded-full bg-foreground animate-bounce"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
      <div className="relative h-7 w-full overflow-hidden">
        {CALC_MESSAGES.map((msg, i) => (
          <p
            key={msg}
            className={cn(
              "absolute inset-0 text-center text-sm transition-all duration-500",
              i === msgIdx
                ? "translate-y-0 opacity-100"
                : i < msgIdx
                  ? "-translate-y-5 opacity-0"
                  : "translate-y-5 opacity-0"
            )}
          >
            {msg}
          </p>
        ))}
      </div>
    </div>
  )
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-2xl font-bold leading-tight tracking-tight">
        {title}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </div>
  )
}

const SLIDER_MACROS: {
  key: keyof MacroSplit
  label: string
  kcalPerG: number
  color: string
}[] = [
  { key: "protein", label: "Protein", kcalPerG: 4, color: "#b85c50" },
  { key: "carbs", label: "Carbs", kcalPerG: 4, color: "#6a9e6a" },
  { key: "fat", label: "Fat", kcalPerG: 9, color: "#b89a3c" },
]

export function OnboardingWizard({
  mode,
  initial,
  onSubmit,
  onCancel,
  cancelLabel,
  submitLabel,
  className,
}: OnboardingWizardProps) {
  const steps = useMemo(() => STEP_LISTS[mode], [mode])
  const [stepIdx, setStepIdx] = useState(0)
  const stepKey = steps[stepIdx]
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [weightUnit, setWeightUnit] = useState<WeightUnit>(
    initial?.weightUnit ?? "kg"
  )
  const [energyUnit, setEnergyUnit] = useState<EnergyUnit>(
    initial?.energyUnit ?? "kcal"
  )
  const [sex, setSex] = useState<Sex | "">(initial?.sex ?? "")
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "")
  const [heightCm, setHeightCm] = useState(
    initial?.heightCm ? String(initial.heightCm) : ""
  )
  const [heightFt, setHeightFt] = useState("")
  const [heightIn, setHeightIn] = useState("")
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | "">(
    initial?.activityLevel ?? ""
  )

  const [currentWeight, setCurrentWeight] = useState(
    initial?.currentWeightKg
      ? weightUnit === "lb"
        ? String(kgToLb(initial.currentWeightKg))
        : String(initial.currentWeightKg)
      : ""
  )
  const [goalType, setGoalType] = useState<GoalType | "">(
    initial?.goalType ?? ""
  )
  const [targetWeight, setTargetWeight] = useState(
    initial?.targetWeightKg
      ? weightUnit === "lb"
        ? String(kgToLb(initial.targetWeightKg))
        : String(initial.targetWeightKg)
      : ""
  )
  const [goalDate, setGoalDate] = useState(initial?.goalDate ?? "")

  const [proteinProfile, setProteinProfile] = useState<ProteinProfile>(
    initial?.proteinProfile ?? "balanced"
  )

  const [calories, setCalories] = useState(
    initial?.calories ? String(initial.calories) : ""
  )
  const [split, setSplit] = useState<MacroSplit>(
    initial?.split ?? { protein: 25, carbs: 45, fat: 30 }
  )

  const [dayDeltas, setDayDeltas] = useState<WeekdayDelta[]>(
    initial?.dayDeltas ??
      Array.from({ length: 7 }, (_, i) => ({
        weekday: i,
        delta: 0,
      }))
  )

  const computeHeightCm: () => number | undefined = useCallback(() => {
    if (weightUnit === "kg") {
      const cm = parseFloat(heightCm)
      return Number.isFinite(cm) ? cm : undefined
    }
    const ft = parseInt(heightFt) || 0
    const inches = parseInt(heightIn) || 0
    if (ft === 0 && inches === 0) return undefined
    return Math.round((ft * 12 + inches) * 2.54 * 10) / 10
  }, [heightCm, heightFt, heightIn, weightUnit])

  useEffect(() => {
    if (currentWeight !== "") {
      const kg = parseFloat(currentWeight)
      if (Number.isFinite(kg)) {
        const converted = weightUnit === "lb" ? kgToLb(kg) : lbToKg(kg)
        setCurrentWeight(String(converted))
      }
    }
    if (targetWeight !== "") {
      const kg = parseFloat(targetWeight)
      if (Number.isFinite(kg)) {
        const converted = weightUnit === "lb" ? kgToLb(kg) : lbToKg(kg)
        setTargetWeight(String(converted))
      }
    }
    const hCm = computeHeightCm()
    if (hCm !== undefined) {
      if (weightUnit === "lb") {
        const totalIn = Math.round(hCm / 2.54)
        setHeightFt(String(Math.floor(totalIn / 12)))
        setHeightIn(String(totalIn % 12))
        setHeightCm("")
      } else {
        setHeightCm(String(Math.round(hCm)))
        setHeightFt("")
        setHeightIn("")
      }
    }
  }, [weightUnit, computeHeightCm, targetWeight, currentWeight])

  useEffect(() => {
    if (calories !== "") {
      const kcal = parseFloat(calories)
      if (Number.isFinite(kcal)) {
        const converted =
          energyUnit === "kj"
            ? Math.round(kcal * 4.184)
            : Math.round(kcal / 4.184)
        setCalories(String(converted))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energyUnit, calories])

  function toWeightKg(value: string): number | undefined {
    const n = parseFloat(value)
    if (!Number.isFinite(n)) return undefined
    return weightUnit === "kg" ? n : lbToKg(n)
  }

  function computeWeeklyRateKg(): number | undefined {
    if (!targetWeight || !goalDate || goalType === "maintain") return undefined
    const cwKg = toWeightKg(currentWeight)
    const twKg = toWeightKg(targetWeight)
    if (!cwKg || !twKg) return undefined
    const gd = new Date(goalDate)
    if (isNaN(gd.getTime())) return undefined
    const totalWeeks =
      (gd.getTime() - new Date().getTime()) / (7 * 24 * 60 * 60 * 1000)
    if (totalWeeks <= 0) return undefined
    return Math.abs(cwKg - twKg) / totalWeeks
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (stepKey === "profile") {
      if (birthDate) {
        const age = computeAgeFromBirthDate(birthDate)
        if (age === undefined || age < 13 || age > 120) {
          errs.birthDate = "Must be between 13 and 120 years old"
        }
      }
      const hCm = computeHeightCm()
      const hasHeight =
        weightUnit === "kg"
          ? heightCm !== ""
          : heightFt !== "" || heightIn !== ""
      if (hasHeight && (hCm === undefined || hCm < 50 || hCm > 260)) {
        errs.height =
          weightUnit === "kg"
            ? "Height must be 50–260 cm"
            : "Enter a valid height"
      }
    }
    if (stepKey === "weight") {
      if (!currentWeight) errs.currentWeight = "Current weight is required"
      else {
        const kg = toWeightKg(currentWeight)
        if (kg === undefined || kg < 20 || kg > 500) {
          errs.currentWeight =
            weightUnit === "kg"
              ? "Weight must be 20–500 kg"
              : "Weight must be 44–1100 lb"
        }
      }
    }
    if (stepKey === "goal") {
      if (!goalType) errs.goalType = "Select a goal"
      if ((goalType === "lose" || goalType === "gain") && targetWeight !== "") {
        const kg = toWeightKg(targetWeight)
        if (kg === undefined || kg < 20 || kg > 500) {
          errs.targetWeight = "Enter a valid target weight"
        }
      }
      if (goalDate !== "") {
        const gd = new Date(goalDate)
        const minGoal = new Date()
        minGoal.setDate(minGoal.getDate() + 6)
        if (isNaN(gd.getTime()) || gd <= minGoal) {
          errs.goalDate = "Goal date must be at least a week from today"
        }
      }
    }
    if (stepKey === "review") {
      if (
        calories !== "" &&
        (isNaN(parseFloat(calories)) || parseFloat(calories) <= 0)
      ) {
        errs.calories = "Must be a positive number"
      }
    }
    return errs
  }

  function isFirstStep() {
    return stepIdx === 0
  }

  function isLastStep() {
    return stepIdx === steps.length - 1
  }

  function gotoNext() {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})

    // When entering 'calc', precompute calories+split for review step.
    const nextKey = steps[stepIdx + 1]
    if (nextKey === "calc") {
      const weightKg =
        toWeightKg(currentWeight) ?? initial?.currentWeightKg ?? 70
      const weeklyRateKg = computeWeeklyRateKg()
      const calc = calculateMacros({
        weightKg,
        heightCm: computeHeightCm() ?? initial?.heightCm,
        ageYears: computeAgeFromBirthDate(birthDate),
        sex: sex || undefined,
        activityLevel: activityLevel || undefined,
        goalType: (goalType || "maintain") as GoalType,
        weeklyRateKg,
        proteinProfile,
      })
      const energyFactor = energyUnit === "kj" ? 4.184 : 1
      setCalories(Math.round(calc.calories * energyFactor).toString())
      const totalCals = calc.calories
      const proteinPct = Math.round(((calc.protein * 4) / totalCals) * 100)
      const fatPct = Math.round(((calc.fat * 9) / totalCals) * 100)
      setSplit({
        protein: proteinPct,
        fat: fatPct,
        carbs: 100 - proteinPct - fatPct,
      })
    }

    setStepIdx((i) => i + 1)
  }

  function gotoBack() {
    setErrors({})
    setStepIdx((i) => Math.max(0, i - 1))
  }

  async function submit() {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setSubmitting(true)
    setServerError("")
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

      const payload: WizardPayload = { mode }

      if (mode === "full") {
        const weightKg = toWeightKg(currentWeight)
        if (weightKg === undefined) throw new Error("Invalid weight")
        payload.profile = {
          timezone,
          sex: sex || undefined,
          birthDate: birthDate || undefined,
          heightCm: computeHeightCm(),
          activityLevel: activityLevel || undefined,
          weightUnit,
          energyUnit,
        }
        payload.currentWeightKg = weightKg
        payload.weightGoal = {
          goalType: (goalType || "maintain") as GoalType,
          targetWeightKg:
            targetWeight !== "" ? toWeightKg(targetWeight) : undefined,
          targetDate:
            goalDate !== "" && (goalType === "lose" || goalType === "gain")
              ? goalDate
              : undefined,
          weeklyRateKg: computeWeeklyRateKg(),
        }
      }

      if (mode === "full" || mode === "program") {
        const calorieKcal =
          calories !== ""
            ? energyUnit === "kcal"
              ? parseFloat(calories)
              : Math.round(parseFloat(calories) / 4.184)
            : 2000
        const baseDaily = {
          calories: calorieKcal,
          protein: Math.round((calorieKcal * (split.protein / 100)) / 4),
          carbs: Math.round((calorieKcal * (split.carbs / 100)) / 4),
          fat: Math.round((calorieKcal * (split.fat / 100)) / 9),
        }
        const convertedDayDeltas =
          energyUnit === "kj"
            ? dayDeltas.map((d) => ({
                ...d,
                delta: Math.round(d.delta / 4.184),
              }))
            : dayDeltas
        const days = buildWeekdayMacros(baseDaily, convertedDayDeltas)
        payload.nutritionPlan = {
          name: initial?.planName,
          goalType: (goalType || initial?.goalType || "maintain") as GoalType,
          activityLevel: activityLevel || undefined,
          days,
        }
      }

      if (mode === "goal") {
        payload.weightGoal = {
          goalType: (goalType || "maintain") as GoalType,
          targetWeightKg:
            targetWeight !== "" ? toWeightKg(targetWeight) : undefined,
          targetDate:
            goalDate !== "" && (goalType === "lose" || goalType === "gain")
              ? goalDate
              : undefined,
          weeklyRateKg: computeWeeklyRateKg(),
        }
      }

      await onSubmit(payload)
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Something went wrong."
      )
    } finally {
      setSubmitting(false)
    }
  }

  function primaryAction() {
    if (isLastStep()) submit()
    else gotoNext()
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="mb-6 space-y-3">
        <div className="flex items-center justify-between">
          {isFirstStep() ? (
            onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                {cancelLabel ?? "Cancel"}
              </button>
            ) : (
              <span />
            )
          ) : (
            <button
              type="button"
              onClick={gotoBack}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back
            </button>
          )}
          <span className="tabular-nums text-xs text-muted-foreground">
            {stepKey === "calc"
              ? "Computing"
              : `${Math.min(stepIdx + 1, steps.length)} / ${steps.length}`}
          </span>
        </div>
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= stepIdx ? "bg-foreground" : "bg-border"
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex-1">
        {stepKey === "units" && (
          <UnitsStep
            weightUnit={weightUnit}
            energyUnit={energyUnit}
            setWeightUnit={setWeightUnit}
            setEnergyUnit={setEnergyUnit}
          />
        )}
        {stepKey === "profile" && (
          <ProfileStep
            weightUnit={weightUnit}
            sex={sex}
            setSex={setSex}
            birthDate={birthDate}
            setBirthDate={setBirthDate}
            heightCm={heightCm}
            setHeightCm={setHeightCm}
            heightFt={heightFt}
            setHeightFt={setHeightFt}
            heightIn={heightIn}
            setHeightIn={setHeightIn}
            errors={errors}
          />
        )}
        {stepKey === "activity" && (
          <ActivityStep
            activityLevel={activityLevel}
            setActivityLevel={setActivityLevel}
          />
        )}
        {stepKey === "weight" && (
          <WeightStep
            weightUnit={weightUnit}
            currentWeight={currentWeight}
            setCurrentWeight={setCurrentWeight}
            errors={errors}
          />
        )}
        {stepKey === "goal" && (
          <GoalStep
            weightUnit={weightUnit}
            currentWeight={currentWeight}
            goalType={goalType}
            setGoalType={setGoalType}
            targetWeight={targetWeight}
            setTargetWeight={setTargetWeight}
            goalDate={goalDate}
            setGoalDate={setGoalDate}
            errors={errors}
          />
        )}
        {stepKey === "macro-profile" && (
          <MacroProfileStep
            proteinProfile={proteinProfile}
            setProteinProfile={setProteinProfile}
          />
        )}
        {stepKey === "calc" && (
          <CalcAnimation onDone={() => setStepIdx((i) => i + 1)} />
        )}
        {stepKey === "review" && (
          <ReviewStep
            energyUnit={energyUnit}
            calories={calories}
            setCalories={setCalories}
            split={split}
            setSplit={setSplit}
            errors={errors}
          />
        )}
        {stepKey === "days" && (
          <DaysStep
            energyUnit={energyUnit}
            calories={calories}
            dayDeltas={dayDeltas}
            setDayDeltas={setDayDeltas}
          />
        )}
      </div>

      {stepKey !== "calc" && (
        <div className="mt-6">
          <Button
            type="button"
            className="h-12 w-full justify-between rounded-xl px-5 text-base"
            onClick={primaryAction}
            disabled={submitting}
          >
            <span>{isLastStep() ? (submitLabel ?? "Save") : "Continue"}</span>
            {submitting ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <ArrowRight className="size-5" />
            )}
          </Button>
          {serverError && (
            <p
              aria-live="polite"
              className="mt-3 text-center text-sm text-destructive"
            >
              {serverError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ===== Step components =====

function UnitsStep({
  weightUnit,
  energyUnit,
  setWeightUnit,
  setEnergyUnit,
}: {
  weightUnit: WeightUnit
  energyUnit: EnergyUnit
  setWeightUnit: (u: WeightUnit) => void
  setEnergyUnit: (u: EnergyUnit) => void
}) {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Choose your units"
        subtitle="How you'll see numbers throughout the app."
      />
      <div className="space-y-2.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Weight
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(["kg", "lb"] as const).map((u) => (
            <ChipButton
              key={u}
              selected={weightUnit === u}
              onClick={() => setWeightUnit(u)}
            >
              {u}
            </ChipButton>
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Energy
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(["kcal", "kj"] as const).map((u) => (
            <ChipButton
              key={u}
              selected={energyUnit === u}
              onClick={() => setEnergyUnit(u)}
            >
              {u === "kcal" ? "kcal" : "kJ"}
            </ChipButton>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProfileStep({
  weightUnit,
  sex,
  setSex,
  birthDate,
  setBirthDate,
  heightCm,
  setHeightCm,
  heightFt,
  setHeightFt,
  heightIn,
  setHeightIn,
  errors,
}: {
  weightUnit: WeightUnit
  sex: Sex | ""
  setSex: (v: Sex | "") => void
  birthDate: string
  setBirthDate: (v: string) => void
  heightCm: string
  setHeightCm: (v: string) => void
  heightFt: string
  setHeightFt: (v: string) => void
  heightIn: string
  setHeightIn: (v: string) => void
  errors: Record<string, string>
}) {
  const maxBirthDate = useMemo(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 13)
    return d.toISOString().slice(0, 10)
  }, [])
  const minBirthDate = useMemo(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 120)
    return d.toISOString().slice(0, 10)
  }, [])

  return (
    <div className="space-y-6">
      <StepHeader
        title="About you"
        subtitle="Helps us personalise estimates. All optional."
      />
      <div className="space-y-2.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Sex
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["female", "Female"],
              ["male", "Male"],
              ["other", "Other"],
              ["prefer_not_to_say", "Prefer not to say"],
            ] as [Sex, string][]
          ).map(([val, label]) => (
            <ChipButton
              key={val}
              selected={sex === val}
              onClick={() => setSex(sex === val ? "" : val)}
            >
              {label}
            </ChipButton>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="birth-date"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Date of birth
        </Label>
        <Input
          id="birth-date"
          type="date"
          min={minBirthDate}
          max={maxBirthDate}
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          aria-invalid={!!errors.birthDate}
          className="h-12 rounded-xl"
        />
        <FieldError message={errors.birthDate} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Height
        </Label>
        {weightUnit === "kg" ? (
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="175"
              min={50}
              max={260}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              aria-invalid={!!errors.height}
              className="h-12 rounded-xl pr-12"
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">
              cm
            </span>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="5"
                min={1}
                max={8}
                value={heightFt}
                onChange={(e) => setHeightFt(e.target.value)}
                aria-invalid={!!errors.height}
                className="h-12 rounded-xl pr-10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">
                ft
              </span>
            </div>
            <div className="relative flex-1">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="9"
                min={0}
                max={11}
                value={heightIn}
                onChange={(e) => setHeightIn(e.target.value)}
                aria-invalid={!!errors.height}
                className="h-12 rounded-xl pr-10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">
                in
              </span>
            </div>
          </div>
        )}
        <FieldError message={errors.height} />
      </div>
    </div>
  )
}

function ActivityStep({
  activityLevel,
  setActivityLevel,
}: {
  activityLevel: ActivityLevel | ""
  setActivityLevel: (v: ActivityLevel | "") => void
}) {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Activity level"
        subtitle="Your typical week of training and movement."
      />
      <div className="space-y-2">
        {ACTIVITY_LEVELS.map(({ value, label, description }) => (
          <StackedOption
            key={value}
            selected={activityLevel === value}
            onClick={() =>
              setActivityLevel(activityLevel === value ? "" : value)
            }
            label={label}
            description={description}
          />
        ))}
      </div>
    </div>
  )
}

function WeightStep({
  weightUnit,
  currentWeight,
  setCurrentWeight,
  errors,
}: {
  weightUnit: WeightUnit
  currentWeight: string
  setCurrentWeight: (v: string) => void
  errors: Record<string, string>
}) {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Current weight"
        subtitle="We use this to set your starting point."
      />
      <div className="relative">
        <Input
          id="current-weight"
          type="number"
          inputMode="decimal"
          placeholder={weightUnit === "kg" ? "75" : "165"}
          value={currentWeight}
          onChange={(e) => setCurrentWeight(e.target.value)}
          aria-invalid={!!errors.currentWeight}
          className="h-16 rounded-xl pr-14 text-center text-3xl font-semibold tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-5 flex items-center text-sm font-medium text-muted-foreground">
          {weightUnit}
        </span>
      </div>
      <FieldError message={errors.currentWeight} />
    </div>
  )
}

function GoalStep({
  weightUnit,
  currentWeight,
  goalType,
  setGoalType,
  targetWeight,
  setTargetWeight,
  goalDate,
  setGoalDate,
  errors,
}: {
  weightUnit: WeightUnit
  currentWeight: string
  goalType: GoalType | ""
  setGoalType: (v: GoalType | "") => void
  targetWeight: string
  setTargetWeight: (v: string) => void
  goalDate: string
  setGoalDate: (v: string) => void
  errors: Record<string, string>
}) {
  const showDetails = goalType === "lose" || goalType === "gain"
  const minDateStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  }, [])
  const maxDateStr = useMemo(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 5)
    return d.toISOString().slice(0, 10)
  }, [])

  const projection = useMemo(() => {
    if (!showDetails || !currentWeight || !targetWeight || !goalDate)
      return null
    const cwKg =
      weightUnit === "lb"
        ? parseFloat(currentWeight) / 2.20462
        : parseFloat(currentWeight)
    const twKg =
      weightUnit === "lb"
        ? parseFloat(targetWeight) / 2.20462
        : parseFloat(targetWeight)
    const gd = new Date(goalDate)
    if (isNaN(cwKg) || isNaN(twKg) || isNaN(gd.getTime())) return null
    if (gd <= new Date()) return null
    const totalWeeks =
      (gd.getTime() - new Date().getTime()) / (7 * 24 * 60 * 60 * 1000)
    const rateKg = Math.abs(cwKg - twKg) / totalWeeks
    const rateDisplay =
      weightUnit === "lb"
        ? Math.round(rateKg * 2.20462 * 100) / 100
        : Math.round(rateKg * 100) / 100
    return {
      rateDisplay,
      goalDateLabel: format(gd, "d MMM yyyy"),
    }
  }, [currentWeight, targetWeight, goalDate, weightUnit, showDetails])

  return (
    <div className="space-y-6">
      <StepHeader
        title="Your goal"
        subtitle="Pick a direction. You can fine-tune below."
      />
      <div className="space-y-2.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Goal
        </Label>
        <div className="grid grid-cols-3 gap-2">
          {(["lose", "maintain", "gain"] as const).map((g) => (
            <ChipButton
              key={g}
              selected={goalType === g}
              onClick={() => setGoalType(g)}
              className="capitalize"
            >
              {g}
            </ChipButton>
          ))}
        </div>
        <FieldError message={errors.goalType} />
      </div>
      {showDetails && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-200 space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="target-weight"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Target weight{" "}
              <span className="normal-case text-muted-foreground/60">
                (optional)
              </span>
            </Label>
            <div className="relative">
              <Input
                id="target-weight"
                type="number"
                inputMode="decimal"
                placeholder={weightUnit === "kg" ? "68" : "150"}
                value={targetWeight}
                onChange={(e) => setTargetWeight(e.target.value)}
                aria-invalid={!!errors.targetWeight}
                className="h-12 rounded-xl pr-12"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">
                {weightUnit}
              </span>
            </div>
            <FieldError message={errors.targetWeight} />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="goal-date"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Goal date{" "}
              <span className="normal-case text-muted-foreground/60">
                (optional)
              </span>
            </Label>
            <Input
              id="goal-date"
              type="date"
              min={minDateStr}
              max={maxDateStr}
              value={goalDate}
              onChange={(e) => setGoalDate(e.target.value)}
              aria-invalid={!!errors.goalDate}
              className="h-12 rounded-xl"
            />
            <FieldError message={errors.goalDate} />
          </div>
          {projection && (
            <div className="rounded-xl border-2 border-border/70 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Projected rate
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {projection.rateDisplay} {weightUnit}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / week
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                reaching target by {projection.goalDateLabel}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MacroProfileStep({
  proteinProfile,
  setProteinProfile,
}: {
  proteinProfile: ProteinProfile
  setProteinProfile: (v: ProteinProfile) => void
}) {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Macro profile"
        subtitle="A starting split — refine in the next step."
      />
      <div className="space-y-2">
        {PROTEIN_PROFILES.map(({ value, label, description }) => (
          <StackedOption
            key={value}
            selected={proteinProfile === value}
            onClick={() => setProteinProfile(value)}
            label={label}
            description={description}
          />
        ))}
      </div>
    </div>
  )
}

function ReviewStep({
  energyUnit,
  calories,
  setCalories,
  split,
  setSplit,
  errors,
}: {
  energyUnit: EnergyUnit
  calories: string
  setCalories: (v: string) => void
  split: MacroSplit
  setSplit: (s: MacroSplit) => void
  errors: Record<string, string>
}) {
  const energyLabel = energyUnit === "kcal" ? "kcal" : "kJ"
  const kcal = parseFloat(calories) || 0
  return (
    <div className="space-y-6">
      <StepHeader
        title="Review targets"
        subtitle="Calculated from your profile. Tweak as needed."
      />
      <div className="space-y-1.5">
        <Label
          htmlFor="calories"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Calories
        </Label>
        <div className="relative">
          <Input
            id="calories"
            type="number"
            inputMode="decimal"
            placeholder={energyUnit === "kcal" ? "2000" : "8368"}
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            aria-invalid={!!errors.calories}
            className="h-14 rounded-xl pr-16 text-xl font-semibold tabular-nums"
          />
          <span className="pointer-events-none absolute inset-y-0 right-5 flex items-center text-sm text-muted-foreground">
            {energyLabel}
          </span>
        </div>
        <FieldError message={errors.calories} />
      </div>
      <div className="space-y-5">
        {SLIDER_MACROS.map(({ key, label, kcalPerG, color }) => {
          const pct = split[key]
          const grams =
            kcal > 0 ? Math.round((kcal * (pct / 100)) / kcalPerG) : 0
          return (
            <div key={key} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {label}
                </span>
                <span className="tabular-nums text-sm text-muted-foreground">
                  {kcal > 0 ? (
                    <>
                      <span className="font-semibold text-foreground">
                        {grams}g
                      </span>{" "}
                      · {pct}%
                    </>
                  ) : (
                    `${pct}%`
                  )}
                </span>
              </div>
              <Slider
                value={[pct]}
                onValueChange={([v]) => setSplit(adjustSplit(key, v, split))}
                min={10}
                max={70}
                step={1}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DaysStep({
  energyUnit,
  calories,
  dayDeltas,
  setDayDeltas,
}: {
  energyUnit: EnergyUnit
  calories: string
  dayDeltas: WeekdayDelta[]
  setDayDeltas: (v: WeekdayDelta[]) => void
}) {
  const energyLabel = energyUnit === "kcal" ? "kcal" : "kJ"
  const base = parseFloat(calories) || 0
  const stepSize = 50

  function adjust(weekday: number, dir: 1 | -1) {
    setDayDeltas(
      dayDeltas.map((d) =>
        d.weekday === weekday
          ? {
              ...d,
              delta: Math.max(
                -Math.min(600, base * 0.4),
                Math.min(600, base * 0.4, d.delta + dir * stepSize)
              ),
            }
          : d
      )
    )
  }

  function reset() {
    setDayDeltas(dayDeltas.map((d) => ({ ...d, delta: 0 })))
  }

  const weeklyTotal = useMemo(() => {
    return dayDeltas.reduce((s, d) => s + base + d.delta, 0)
  }, [dayDeltas, base])

  return (
    <div className="space-y-6">
      <StepHeader
        title="Weekday adjustments"
        subtitle="Eat more on training or social days. Macros scale proportionally."
      />
      <div className="rounded-xl border-2 border-border/70 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Weekly total
          </p>
          <p className="text-xl font-bold tabular-nums">
            {Math.round(weeklyTotal).toLocaleString()}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {energyLabel}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      </div>
      <div className="space-y-2">
        {dayDeltas.map((d) => {
          const value = Math.round(base + d.delta)
          const diff = d.delta
          return (
            <div
              key={d.weekday}
              className="flex items-center gap-3 rounded-xl border-2 border-border/70 px-3 py-2"
            >
              <div className="flex w-16 shrink-0 flex-col">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {WEEKDAY_FULL[d.weekday].slice(0, 3)}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {value.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-1 items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => adjust(d.weekday, -1)}
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground hover:bg-muted/80"
                  aria-label={`Decrease ${WEEKDAY_FULL[d.weekday]}`}
                >
                  <Minus className="size-4" />
                </button>
                <span
                  className={cn(
                    "min-w-[60px] text-center text-xs font-semibold tabular-nums",
                    diff === 0
                      ? "text-muted-foreground"
                      : diff > 0
                        ? "text-emerald-500"
                        : "text-rose-500"
                  )}
                >
                  {diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${diff}`}
                </span>
                <button
                  type="button"
                  onClick={() => adjust(d.weekday, 1)}
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground hover:bg-muted/80"
                  aria-label={`Increase ${WEEKDAY_FULL[d.weekday]}`}
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
