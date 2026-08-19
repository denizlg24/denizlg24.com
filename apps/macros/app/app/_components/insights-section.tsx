import { ChevronRight } from "lucide-react"
import Link from "next/link"
import { MACRO_COLORS } from "@/lib/macro-colors"
import type { EnergyBalancePoint, GoalProgress } from "@/lib/queries/dashboard"

type Props = {
  energyBalance: EnergyBalancePoint[]
  goalProgress: GoalProgress
}

export function InsightsSection({ energyBalance, goalProgress }: Props) {
  const { daysTracked, daysOnTarget, totalDays } = goalProgress
  const adherencePct =
    daysTracked > 0 ? Math.round((daysOnTarget / daysTracked) * 100) : 0

  const latestTdee = energyBalance.reduceRight<number | null>(
    (acc, p) => acc ?? p.tdee,
    null
  )
  const goalLine = latestTdee

  const maxConsumed = Math.max(...energyBalance.map((p) => p.consumed), 1)
  const maxTdee = Math.max(
    ...energyBalance.map((point) => point.tdee ?? latestTdee ?? 0),
    1
  )
  const graphScale = Math.max(maxConsumed, maxTdee, 1)
  const goalLinePct =
    goalLine != null ? Math.min((goalLine / graphScale) * 100, 100) : null

  const weeklyBalance =
    latestTdee != null
      ? Math.round(
          energyBalance.reduce(
            (sum, point) => sum + (point.tdee ?? latestTdee) - point.consumed,
            0
          )
        )
      : null

  return (
    <div className="px-5 mt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-lg font-bold">Insights & Analytics</p>
        <Link
          href="/app/analytics"
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          See All
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/app/analytics/goal"
          className="bg-muted/40 rounded-2xl p-3 flex flex-col justify-between gap-2"
        >
          <div>
            <p className="font-bold text-sm">Goal Progress</p>
            <p className="text-xs text-muted-foreground">
              {totalDays > 0 ? `Last ${totalDays} Days` : "No active plan"}
            </p>
          </div>
          <div className="flex items-center">
            <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${adherencePct}%`,
                  backgroundColor: MACRO_COLORS.carbs,
                }}
              />
            </div>
          </div>
          <div className="border-t border-border/50 pt-2 flex items-center justify-between">
            <p className="text-sm font-semibold tabular-nums">
              {adherencePct} %
            </p>
            <ChevronRight className="size-4 text-muted-foreground" />
          </div>
        </Link>

        <Link
          href="/app/analytics/energy"
          className="bg-muted/40 rounded-2xl p-3 flex flex-col justify-between gap-2"
        >
          <div>
            <p className="font-bold text-sm">Energy Balance</p>
            <p className="text-xs text-muted-foreground">Last 7 Days</p>
          </div>
          <div className="relative h-7">
            <div className="absolute inset-0 flex items-end gap-0.5">
              {energyBalance.map((point) => {
                const heightPct = Math.min(
                  (point.consumed / graphScale) * 100,
                  100
                )
                const comparisonLine = point.tdee ?? latestTdee
                const isOver =
                  comparisonLine != null && point.consumed > comparisonLine
                return (
                  <div
                    key={point.date}
                    className="flex-1 rounded-t-xs"
                    style={{
                      height: `${Math.max(heightPct, 6)}%`,
                      backgroundColor: isOver
                        ? "rgb(249 115 22 / 0.8)"
                        : "rgb(59 130 246 / 0.8)",
                    }}
                  />
                )
              })}
            </div>
            {goalLinePct != null && (
              <div
                className="absolute left-0 right-0 border-t-2 border-dashed border-orange-400/80 pointer-events-none"
                style={{ bottom: `${goalLinePct}%` }}
              />
            )}
          </div>
          <div className="border-t border-border/50 pt-2 flex items-center justify-between">
            {weeklyBalance != null ? (
              <p className="text-sm font-semibold tabular-nums">
                {Math.abs(weeklyBalance).toLocaleString()}{" "}
                <span className="text-xs font-medium text-muted-foreground">
                  kcal{" "}
                  {weeklyBalance === 0
                    ? "on target"
                    : weeklyBalance < 0
                      ? "surplus"
                      : "deficit"}
                </span>
              </p>
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">
                — kcal
              </p>
            )}
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          </div>
        </Link>
      </div>
    </div>
  )
}
