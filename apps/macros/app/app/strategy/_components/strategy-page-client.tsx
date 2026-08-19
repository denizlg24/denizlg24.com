"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { Check, Hourglass, Pencil, Plus, RotateCcw, Undo2 } from "lucide-react"
import { useMemo, useState } from "react"
import {
  OnboardingWizard,
  type WizardInitial,
  type WizardMode,
  type WizardPayload,
} from "@/components/onboarding/wizard"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/app-cache/query-keys"
import type { ActiveGoal, GoalHistoryEntry } from "@/lib/goals/contracts"
import type { PlanDetail } from "@/lib/plans/contracts"
import { cn } from "@/lib/utils"

interface StrategyResponse {
  plan: PlanDetail | null
  goal: ActiveGoal | null
  history: GoalHistoryEntry[]
}

async function fetchStrategy(): Promise<StrategyResponse> {
  const res = await fetch("/api/strategy", { cache: "no-store" })
  if (!res.ok) throw new Error("Failed to load strategy")
  return res.json()
}

const STRATEGY_KEY = ["app", "strategy"] as const

function goalTitle(goalType: "lose" | "maintain" | "gain"): string {
  if (goalType === "lose") return "Weight Loss Goal"
  if (goalType === "gain") return "Weight Gain Goal"
  return "Maintenance Goal"
}

function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), "d MMM")
  } catch {
    return iso
  }
}

function fmtDateFull(iso: string): string {
  try {
    return format(parseISO(iso), "d MMM yyyy")
  } catch {
    return iso
  }
}

type WizardDrawerState = { mode: WizardMode; reason: "new" | "edit" } | null

export function StrategyPageClient() {
  const queryClient = useQueryClient()
  const [drawer, setDrawer] = useState<WizardDrawerState>(null)

  const { data, isLoading } = useQuery({
    queryKey: STRATEGY_KEY,
    queryFn: fetchStrategy,
    refetchOnWindowFocus: false,
  })

  const reopenMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const res = await fetch(`/api/weight-goals/${goalId}/reopen`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to reopen goal")
    },
    onSuccess: async () => {
      await refreshAll(queryClient)
    },
  })

  const submitMutation = useMutation({
    mutationFn: async (payload: WizardPayload) => {
      const drawerState = drawer
      if (!drawerState) return

      if (drawerState.mode === "program") {
        const url =
          drawerState.reason === "edit"
            ? "/api/nutrition-plans/active"
            : "/api/nutrition-plans"
        const method = drawerState.reason === "edit" ? "PATCH" : "POST"
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload.nutritionPlan),
        })
        if (!res.ok) throw new Error("Failed to save program")
      } else if (drawerState.mode === "goal") {
        const url =
          drawerState.reason === "edit"
            ? "/api/weight-goals/active"
            : "/api/weight-goals"
        const method = drawerState.reason === "edit" ? "PATCH" : "POST"
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload.weightGoal),
        })
        if (!res.ok) throw new Error("Failed to save goal")
      }
    },
    onSuccess: async () => {
      await refreshAll(queryClient)
      setDrawer(null)
    },
  })

  const plan = data?.plan ?? null
  const goal = data?.goal ?? null
  const history = data?.history ?? []
  const closedHistory = useMemo(
    () => history.filter((h) => !h.isActive),
    [history]
  )
  const hasPreviousClosed = closedHistory.length > 0

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-3 pb-32">
      <header className="flex h-12 items-center justify-center">
        <h1 className="text-base font-bold">Strategy</h1>
      </header>

      {isLoading ? (
        <LoadingSkeleton />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-bold tracking-tight">In Progress</h2>
            <ProgramCard
              plan={plan}
              onNew={() => setDrawer({ mode: "program", reason: "new" })}
              onEdit={() => setDrawer({ mode: "program", reason: "edit" })}
            />
            <GoalCard
              goal={goal}
              onNew={() => setDrawer({ mode: "goal", reason: "new" })}
              onEdit={() => setDrawer({ mode: "goal", reason: "edit" })}
              onReopen={() => {
                const latest = closedHistory[0]
                if (latest) reopenMutation.mutate(latest.id)
              }}
              hasPrevious={hasPreviousClosed}
              reopening={reopenMutation.isPending}
            />
          </section>

          {closedHistory.length > 0 ? (
            <section className="space-y-3 pt-2">
              <h2 className="text-xl font-bold tracking-tight">Goal History</h2>
              <div className="space-y-2">
                {closedHistory.map((entry) => (
                  <GoalHistoryRow key={entry.id} entry={entry} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Drawer
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(null)
        }}
        repositionInputs={false}
      >
        <DrawerContent className="max-h-[92dvh]! rounded-t-3xl">
          <DrawerTitle className="sr-only">
            {drawer?.mode === "program" ? "Program" : "Goal"} wizard
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Configure your{" "}
            {drawer?.mode === "program" ? "program targets" : "weight goal"}.
          </DrawerDescription>
          {drawer ? (
            <div className="overflow-y-auto px-5 pt-5 pb-safe-end">
              <OnboardingWizard
                mode={drawer.mode}
                initial={buildInitial(drawer, plan, goal)}
                onCancel={() => setDrawer(null)}
                cancelLabel="Close"
                submitLabel={
                  drawer.reason === "edit"
                    ? `Save ${drawer.mode === "program" ? "program" : "goal"}`
                    : `Create ${drawer.mode === "program" ? "program" : "goal"}`
                }
                onSubmit={async (payload) => {
                  await submitMutation.mutateAsync(payload)
                }}
              />
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

async function refreshAll(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: STRATEGY_KEY }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    queryClient.invalidateQueries({ queryKey: queryKeys.calorieSummary }),
  ])
}

function buildInitial(
  state: NonNullable<WizardDrawerState>,
  plan: PlanDetail | null,
  goal: ActiveGoal | null
): WizardInitial {
  const initial: WizardInitial = {}
  if (state.mode === "program") {
    initial.goalType = plan?.goalType ?? goal?.goalType ?? "maintain"
    initial.planName = plan?.name
    if (state.reason === "edit" && plan) {
      const baseCal =
        plan.baseCalorieTarget ?? plan.days[0]?.calorieTarget ?? 2000
      initial.calories = baseCal
      const protein = plan.baseProteinTarget ?? plan.days[0]?.proteinTarget ?? 0
      const carbs = plan.baseCarbsTarget ?? plan.days[0]?.carbsTarget ?? 0
      const fat = plan.baseFatTarget ?? plan.days[0]?.fatTarget ?? 0
      const total = protein * 4 + carbs * 4 + fat * 9 || baseCal
      initial.split = {
        protein: Math.round(((protein * 4) / total) * 100),
        carbs: Math.round(((carbs * 4) / total) * 100),
        fat: Math.round(((fat * 9) / total) * 100),
      }
      initial.dayDeltas = plan.days.map((d) => ({
        weekday: d.weekday,
        delta: (d.calorieTarget ?? baseCal) - baseCal,
      }))
    }
  }
  if (state.mode === "goal") {
    if (state.reason === "edit" && goal) {
      initial.goalType = goal.goalType
      if (goal.targetWeightKg != null)
        initial.targetWeightKg = goal.targetWeightKg
      if (goal.targetDate) initial.goalDate = goal.targetDate
      if (goal.startWeightKg != null)
        initial.currentWeightKg = goal.startWeightKg
    } else {
      initial.goalType = goal?.goalType ?? "lose"
      if (goal?.startWeightKg != null)
        initial.currentWeightKg = goal.startWeightKg
    }
  }
  return initial
}

// ===== Subcomponents =====

const COLORS = {
  calories: "#5878b4",
  protein: "#e0826c",
  fat: "#f1c453",
  carbs: "#7fbe7f",
} as const

function ProgramCard({
  plan,
  onNew,
  onEdit,
}: {
  plan: PlanDetail | null
  onNew: () => void
  onEdit: () => void
}) {
  if (!plan) {
    return (
      <div className="rounded-2xl bg-card p-5">
        <h3 className="text-lg font-bold">Coached Program</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No active program yet. Build one to lock in your daily targets.
        </p>
        <button
          type="button"
          onClick={onNew}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background"
        >
          <Plus className="size-4" /> Create program
        </button>
      </div>
    )
  }

  const dateRange = `${fmtDate(plan.startDate)} – Now`

  return (
    <div className="rounded-2xl bg-card p-4 space-y-4">
      <div>
        <h3 className="text-lg font-bold">{plan.name}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{dateRange}</p>
      </div>
      <WeekdayBars days={plan.days} />
      <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
        <CardActionButton
          icon={RotateCcw}
          label="New Program"
          onClick={onNew}
        />
        <CardActionButton icon={Pencil} label="Edit Program" onClick={onEdit} />
      </div>
    </div>
  )
}

function WeekdayBars({ days }: { days: PlanDetail["days"] }) {
  const sorted = useMemo(
    () => [...days].sort((a, b) => a.weekday - b.weekday),
    [days]
  )
  const maxKcal = useMemo(
    () => Math.max(...sorted.map((d) => d.calorieTarget ?? 0), 1),
    [sorted]
  )

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {sorted.map((d, i) => {
        const calories = d.calorieTarget ?? 0
        const protein = d.proteinTarget ?? 0
        const carbs = d.carbsTarget ?? 0
        const fat = d.fatTarget ?? 0
        const proteinKcal = protein * 4
        const carbsKcal = carbs * 4
        const fatKcal = fat * 9
        const sum = proteinKcal + carbsKcal + fatKcal || calories || 1
        const proteinPct = (proteinKcal / sum) * 100
        const fatPct = (fatKcal / sum) * 100
        const carbsPct = (carbsKcal / sum) * 100
        const totalHeight = 180
        const minHeight = totalHeight * (calories / maxKcal)
        const label = ["M", "T", "W", "T", "F", "S", "S"][d.weekday]
        return (
          <div key={d.weekday} className="flex flex-col items-center gap-1.5">
            <span
              className="inline-flex h-6 w-full items-center justify-center rounded-md text-[10px] font-semibold tabular-nums text-white"
              style={{ backgroundColor: COLORS.calories }}
            >
              {Math.round(calories)}
            </span>
            <div
              className="flex w-full flex-col gap-0.5"
              style={{ height: minHeight }}
            >
              <BarSlice
                value={protein}
                pct={proteinPct}
                color={COLORS.protein}
                letter="P"
              />
              <BarSlice
                value={fat}
                pct={fatPct}
                color={COLORS.fat}
                letter="F"
              />
              <BarSlice
                value={carbs}
                pct={carbsPct}
                color={COLORS.carbs}
                letter="C"
              />
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function BarSlice({
  value,
  pct,
  color,
  letter,
}: {
  value: number
  pct: number
  color: string
  letter: string
}) {
  if (pct < 1) return null
  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-sm text-[10px] font-semibold text-black/80"
      style={{
        backgroundColor: color,
        flexBasis: `${pct}%`,
        minHeight: 14,
      }}
    >
      {Math.round(value)} {letter}
    </div>
  )
}

function CardActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted/80 px-3.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
    >
      <Icon className="size-3.5" /> {label}
    </button>
  )
}

function GoalCard({
  goal,
  onNew,
  onEdit,
  onReopen,
  hasPrevious,
  reopening,
}: {
  goal: ActiveGoal | null
  onNew: () => void
  onEdit: () => void
  onReopen: () => void
  hasPrevious: boolean
  reopening: boolean
}) {
  if (!goal) {
    return (
      <div className="rounded-2xl bg-card p-5">
        <h3 className="text-lg font-bold">Weight Goal</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Set a goal to track your trend against a target.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background"
          >
            <Plus className="size-4" /> Create goal
          </button>
          {hasPrevious ? (
            <CardActionButton
              icon={Undo2}
              label="Reopen previous"
              onClick={onReopen}
              disabled={reopening}
            />
          ) : null}
        </div>
      </div>
    )
  }

  const title = goalTitle(goal.goalType)
  const dateRange = `${fmtDate(goal.startDate)} – Now`
  const rateKg = goal.weeklyRateKg ?? null
  const signedRate =
    rateKg != null
      ? goal.goalType === "lose"
        ? -Math.abs(rateKg)
        : goal.goalType === "gain"
          ? Math.abs(rateKg)
          : rateKg
      : null
  const ratePct =
    rateKg != null && goal.startWeightKg
      ? (signedRate! / goal.startWeightKg) * 100
      : null

  return (
    <div className="rounded-2xl bg-card p-4 space-y-4">
      <div>
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{dateRange}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat
          value={
            goal.targetWeightKg != null ? goal.targetWeightKg.toFixed(1) : "—"
          }
          unit="kg"
          label="Goal Weight"
        />
        <Stat
          value={signedRate != null ? signedRate.toFixed(2) : "—"}
          unit="kg"
          label="Goal Rate"
        />
        <Stat
          value={ratePct != null ? ratePct.toFixed(1) : "—"}
          unit="%"
          label="Goal Rate"
        />
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
        <CardActionButton icon={Plus} label="New Goal" onClick={onNew} />
        <CardActionButton icon={Pencil} label="Edit Goal" onClick={onEdit} />
        {hasPrevious ? (
          <CardActionButton
            icon={Undo2}
            label="Reopen Previous"
            onClick={onReopen}
            disabled={reopening}
          />
        ) : null}
      </div>
    </div>
  )
}

function Stat({
  value,
  unit,
  label,
}: {
  value: string
  unit: string
  label: string
}) {
  return (
    <div>
      <p className="text-2xl font-bold tabular-nums">
        {value}
        <span className="ml-0.5 text-xs font-normal text-muted-foreground">
          {unit}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function GoalHistoryRow({ entry }: { entry: GoalHistoryEntry }) {
  const start =
    entry.startWeightKg != null ? `${entry.startWeightKg.toFixed(1)} kg` : "—"
  const end =
    entry.endWeightKg != null ? `${entry.endWeightKg.toFixed(1)} kg` : null
  const endDate = entry.closedAt
    ? fmtDateFull(entry.closedAt.slice(0, 10))
    : "Now"
  const dateRange = `${fmtDateFull(entry.startDate)} – ${endDate}`
  const outcomeLabel = entry.outcome
    ? entry.outcome === "loss"
      ? "Loss"
      : entry.outcome === "gain"
        ? "Gain"
        : "Maintain"
    : "—"

  return (
    <div className="rounded-2xl bg-card p-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{dateRange}</p>
        <p className="mt-1 text-lg font-bold tabular-nums">
          {start}
          {end ? (
            <>
              <span className="mx-1.5 text-xs font-normal text-muted-foreground">
                to
              </span>
              {end}
            </>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm text-muted-foreground">{outcomeLabel}</span>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full",
            entry.achieved
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground"
          )}
          role="img"
          aria-label={entry.achieved ? "Goal achieved" : "Goal not reached"}
        >
          {entry.achieved ? (
            <Check className="size-4" strokeWidth={3} />
          ) : (
            <Hourglass className="size-4" />
          )}
        </span>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-6 w-32 rounded-md" />
      <Skeleton className="h-72 w-full rounded-2xl" />
      <Skeleton className="h-44 w-full rounded-2xl" />
    </div>
  )
}
