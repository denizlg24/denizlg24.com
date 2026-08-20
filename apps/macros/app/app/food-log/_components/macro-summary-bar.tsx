"use client";

import { Flame } from "lucide-react";
import { MACRO_COLORS } from "@/lib/macro-colors";
import type { FoodLogDayPayload } from "@/lib/queries/food-log-day";

type Macro = {
  key: "calories" | "protein" | "fat" | "carbs";
  letter: string;
  color: string;
};

const MACROS: Macro[] = [
  { key: "calories", letter: "", color: MACRO_COLORS.calories },
  { key: "protein", letter: "P", color: MACRO_COLORS.protein },
  { key: "fat", letter: "F", color: MACRO_COLORS.fat },
  { key: "carbs", letter: "C", color: MACRO_COLORS.carbs },
];

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function MacroSummaryBar({ data }: { data: FoodLogDayPayload | null }) {
  return (
    <div className="px-4 pb-4">
      <div className="flex items-stretch gap-3">
        {MACROS.map((m) => {
          const consumed = data?.totals[m.key] ?? 0;
          const target = data?.targets[m.key] ?? null;
          const pct =
            target && target > 0
              ? Math.min(100, Math.round((consumed / target) * 100))
              : 0;
          return (
            <div key={m.key} className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-[13px] tabular-nums">
                {m.key === "calories" ? (
                  <Flame className="size-4 shrink-0 text-foreground" />
                ) : (
                  <span className="shrink-0 text-xs font-bold">{m.letter}</span>
                )}
                <span className="truncate">
                  {fmt(consumed)}
                  {target != null ? ` / ${fmt(target)}` : ""}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: m.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
