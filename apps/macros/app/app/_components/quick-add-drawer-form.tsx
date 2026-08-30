"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { setTodayNutritionTotals } from "@/lib/app-cache/api";
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys";
import { queryKeys } from "@/lib/app-cache/query-keys";
import {
  type LogQuickAddInput,
  logQuickAddResponseSchema,
} from "@/lib/foods/contracts";
import { MACRO_COLORS } from "@/lib/macro-colors";
import { putConfirmedNutritionTotals } from "@/lib/optimistic-nutrition";

async function postQuickAdd(input: LogQuickAddInput) {
  const response = await fetch("/api/food-log/quick-add", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Quick add failed (${response.status})`);
  return logQuickAddResponseSchema.parse(await response.json());
}

function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const MACRO_FIELDS = [
  { key: "protein", label: "Protein", color: MACRO_COLORS.protein },
  { key: "fat", label: "Fat", color: MACRO_COLORS.fat },
  { key: "carbs", label: "Carbs", color: MACRO_COLORS.carbs },
] as const;

export function QuickAddDrawerForm({
  logDate,
  onClose,
}: {
  logDate: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [macros, setMacros] = useState({ protein: "", fat: "", carbs: "" });

  const mutation = useMutation({
    mutationFn: postQuickAdd,
    onSuccess: async (result) => {
      putConfirmedNutritionTotals(result.entry.logDate, result.totals);
      setTodayNutritionTotals(queryClient, result.entry.logDate, result.totals);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.calorieSummary }),
        queryClient.invalidateQueries({
          queryKey: foodLogQueryKeys.day(result.entry.logDate),
        }),
        queryClient.invalidateQueries({
          queryKey: ["food-log", "week-totals"],
        }),
        queryClient.invalidateQueries({ queryKey: ["food-log", "overview"] }),
      ]);
      onClose();
    },
    onError: () => toast.error("Could not add entry"),
  });

  const parsedCalories = parseAmount(calories);
  const canSubmit =
    parsedCalories != null && parsedCalories > 0 && !mutation.isPending;

  function submit() {
    if (parsedCalories == null || parsedCalories <= 0) return;
    mutation.mutate({
      clientMutationId: crypto.randomUUID(),
      name: name.trim() || "Quick add",
      calories: parsedCalories,
      protein: parseAmount(macros.protein) ?? undefined,
      fat: parseAmount(macros.fat) ?? undefined,
      carbs: parseAmount(macros.carbs) ?? undefined,
      logDate,
    });
  }

  return (
    <div className="p-3 pb-safe-end">
      <div className="mb-4 grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-6" />
        </Button>
        <p className="text-center text-lg font-bold">Quick Add</p>
        <span className="size-9" aria-hidden="true" />
      </div>

      <label htmlFor="quick-add-calories" className="block space-y-1.5">
        <span className="text-xs font-bold">Calories</span>
        <div className="relative">
          <Input
            id="quick-add-calories"
            value={calories}
            onChange={(event) => setCalories(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            className="h-12 rounded-xl border-2 pr-14 text-xl tabular-nums"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base text-muted-foreground">
            kcal
          </span>
        </div>
      </label>

      <div className="mt-3 grid grid-cols-3 gap-3">
        {MACRO_FIELDS.map(({ key, label, color }) => (
          <label
            key={key}
            htmlFor={`quick-add-${key}`}
            className="block space-y-1.5"
          >
            <span className="flex items-center gap-1.5 text-xs font-bold">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
            <div className="relative">
              <Input
                id={`quick-add-${key}`}
                value={macros[key]}
                onChange={(event) =>
                  setMacros((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                inputMode="decimal"
                autoComplete="off"
                className="h-11 rounded-xl pr-7 tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                g
              </span>
            </div>
          </label>
        ))}
      </div>

      <label htmlFor="quick-add-name" className="mt-3 block space-y-1.5">
        <span className="text-xs font-bold">Name</span>
        <Input
          id="quick-add-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Quick add"
          autoComplete="off"
          className="h-11 rounded-xl"
        />
      </label>

      <Button
        type="button"
        className="mt-4 h-12 w-full rounded-xl text-base"
        disabled={!canSubmit}
        onClick={submit}
      >
        {mutation.isPending ? "Adding..." : "Add"}
      </Button>
    </div>
  );
}
