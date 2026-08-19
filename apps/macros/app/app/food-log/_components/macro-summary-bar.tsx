"use client"

import { Flame } from "lucide-react"
import { MACRO_COLORS } from "@/lib/macro-colors"
import type { FoodLogDayPayload } from "@/lib/queries/food-log-day"

type Macro = {
  key: "calories" | "protein" | "fat" | "carbs"
  letter: string
  color: string
}

const MACROS: Macro[] = [
  { key: "calories", letter: "", color: MACRO_COLORS.calories },
  { key: "protein", letter: "P", color: MACRO_COLORS.protein },
  { key: "fat", letter: "F", color: MACRO_COLORS.fat },
  { key: "carbs", letter: "C", color: MACRO_COLORS.carbs },
]

function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}

export function MacroSummaryBar({ data }: { data: FoodLogDayPayload | null }) {
  return (
    <div className="px-3 pb-3">
      <div className="flex items-stretch gap-2">
        {MACROS.map((m) => {
          const consumed = data?.totals[m.key] ?? 0
          const target = data?.targets[m.key] ?? null
          const pct =
            target && target > 0
              ? Math.min(100, Math.round((consumed / target) * 100))
              : 0
          return (
            <div key={m.key} className="flex-1 flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-1 text-xs tabular-nums">
                {m.key === "calories" ? (
                  <Flame className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <span className="font-bold text-[11px] shrink-0">
                    {m.letter}
                  </span>
                )}
                <span className="truncate">
                  {fmt(consumed)}
                  {target != null ? ` / ${fmt(target)}` : ""}
                </span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: m.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
