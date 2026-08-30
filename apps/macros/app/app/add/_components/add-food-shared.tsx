"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@repo/ui/keyboard-sheet";
import { cn } from "@repo/ui/utils";
import {
  Barcode,
  BookOpen,
  ChefHat,
  Flame,
  Search,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { type LogFoodInput, logFoodBodySchema } from "@/lib/foods/contracts";
import {
  formatCalories,
  formatMeasureAmount,
  formatServingAmount,
} from "@/lib/foods/display";
import { FoodIcon } from "@/lib/foods/food-icon";
import { MACRO_COLORS } from "@/lib/macro-colors";
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition";
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";
import {
  type LogRecipeInput,
  logRecipeBodySchema,
} from "@/lib/recipes/contracts";
import type { FoodSummary } from "./food-detail-drawer";

export function getHourInTimezone(date: Date, timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(date),
  );

  return Number.isFinite(hour) ? hour : date.getHours();
}

export function dateFromIsoDate(value: string) {
  const parts = value.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!year || !month || !day) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }

  return new Date(year, month - 1, day);
}

export function isoDateFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/**
 * Keeps the entry date pinned to the server's notion of today across a day
 * rollover, until the owner picks a date themselves.
 */
export function useEntryDate(
  today: string,
  timezone: string,
  initial?: { date?: Date; hour?: number },
) {
  const [selectedDate, setSelectedDate] = useState(
    () => initial?.date ?? dateFromIsoDate(today),
  );
  const [selectedHour, setSelectedHour] = useState(
    () => initial?.hour ?? getHourInTimezone(new Date(), timezone),
  );
  const pinnedRef = useRef(initial?.date == null);

  useEffect(() => {
    if (!pinnedRef.current) return;

    setSelectedDate((current) =>
      isoDateFromDate(current) === today ? current : dateFromIsoDate(today),
    );
    setSelectedHour(getHourInTimezone(new Date(), timezone));
  }, [today, timezone]);

  const pickDate = useCallback((next: Date) => {
    pinnedRef.current = false;
    setSelectedDate(next);
  }, []);

  return { selectedDate, selectedHour, pickDate, setSelectedHour };
}

export function formatHourLabel(hour: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${h12} ${suffix}`;
}

export function inferMealType(
  hour: number,
): "breakfast" | "lunch" | "dinner" | "snack" {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return "snack";
}

export type PendingFood = {
  uid: string;
  entryType?: "food" | "recipe";
  food: FoodSummary & {
    totalWeightGrams?: number | null | undefined;
    servings?: number | null | undefined;
  };
  input: LogFoodInput | LogRecipeInput;
  macros: OptimisticDailyMacros;
};

const FAILED_PENDING_FOODS_KEY = "macros.failed-pending-foods.v1";
const failedPendingFoodSchema = z.object({
  uid: z.uuid(),
  entryType: z.enum(["food", "recipe"]).optional().default("food"),
  food: z.object({
    id: z.uuid(),
    name: z.string(),
    brand: z.string().nullable().optional(),
    iconKey: z.string().nullable().optional(),
    servingLabel: z.string().nullable().optional(),
    caloriesPerServing: z.number().nullable().optional(),
    proteinPerServing: z.number().nullable().optional(),
    fatPerServing: z.number().nullable().optional(),
    carbsPerServing: z.number().nullable().optional(),
    totalWeightGrams: z.number().nullable().optional(),
    servings: z.number().nullable().optional(),
  }),
  input: z.union([logFoodBodySchema, logRecipeBodySchema]),
  macros: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
});

export function getPendingCalories(food: PendingFood) {
  return food.macros.calories;
}

function readFailedPendingFoods(): PendingFood[] {
  try {
    const raw = window.sessionStorage.getItem(FAILED_PENDING_FOODS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (food): food is PendingFood =>
        failedPendingFoodSchema.safeParse(food).success,
    );
  } catch {
    return [];
  }
}

export function saveFailedPendingFoods(foods: PendingFood[]) {
  if (foods.length === 0) return;

  try {
    const existing = readFailedPendingFoods();
    window.sessionStorage.setItem(
      FAILED_PENDING_FOODS_KEY,
      JSON.stringify([...foods, ...existing]),
    );
  } catch (error) {
    console.warn("Failed to store failed food logs for retry", error);
  }
}

/** Drains the retry queue so a second mount cannot re-stage the same rows. */
export function takeFailedPendingFoods(): PendingFood[] {
  const foods = readFailedPendingFoods();
  if (foods.length === 0) return foods;

  try {
    window.sessionStorage.removeItem(FAILED_PENDING_FOODS_KEY);
  } catch {}

  return foods;
}

export function dedupePendingFoods(foods: PendingFood[]) {
  const seen = new Set<string>();
  const deduped: PendingFood[] = [];

  for (const food of foods) {
    if (seen.has(food.uid)) continue;
    seen.add(food.uid);
    deduped.push(food);
  }

  return deduped;
}

export function pendingDisplayName(food: PendingFood) {
  return food.food.brand
    ? `${food.food.name} By ${food.food.brand}`
    : food.food.name;
}

/** Mirrors the food log's amount rule: a typed measure wins over the serving. */
export function formatPendingAmount(food: PendingFood) {
  const input = food.input;
  if ("enteredUnit" in input) {
    const { enteredQuantity, enteredUnit } = input;
    if (
      enteredUnit != null &&
      enteredUnit !== "serving" &&
      enteredQuantity != null &&
      Number.isFinite(enteredQuantity) &&
      enteredQuantity > 0
    ) {
      return formatMeasureAmount(enteredQuantity, enteredUnit);
    }
  }

  return formatServingAmount(food.food.servingLabel, input.servingsConsumed);
}

export function sumPendingMacros(foods: PendingFood[]) {
  return foods.reduce(
    (acc, food) => ({
      calories: acc.calories + food.macros.calories,
      protein: acc.protein + food.macros.protein,
      fat: acc.fat + food.macros.fat,
      carbs: acc.carbs + food.macros.carbs,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

const NAV_TABS = [
  { href: "/app/scan", label: "Scan", Icon: Barcode },
  { href: "/app/add", label: "Search", Icon: Search },
  { href: "/app/recipes", label: "Recipes", Icon: ChefHat },
  { href: "/app/foods", label: "Library", Icon: BookOpen },
] as const;

function CaloriePill({
  consumed,
  pending,
  target,
}: {
  consumed: number;
  pending: number;
  target: number | null;
}) {
  const W = 98;
  const H = 38;
  const SW = 3;
  const p = SW / 2 + 0.5;
  const rw = W - SW;
  const rh = H - SW;
  const rx = rh / 2;

  const perimeter = 2 * (rw - rh) + Math.PI * rh;
  const startOffset = rw / 2 - rx;

  const total = consumed + pending;
  const fillRatio = target != null && target > 0 ? consumed / target : 0;
  const pendingRatio = target != null && target > 0 ? pending / target : 0;
  const fillLength = Math.min(fillRatio, 1) * perimeter;
  const pendingFillLength =
    Math.min(pendingRatio, Math.max(0, 1 - fillRatio)) * perimeter;
  const targetLabel = target != null ? Math.round(target) : "-";

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="absolute inset-0"
        aria-hidden="true"
      >
        <rect
          x={p}
          y={p}
          width={rw}
          height={rh}
          rx={rx}
          className="fill-muted"
        />
        <rect
          x={p}
          y={p}
          width={rw}
          height={rh}
          rx={rx}
          fill="none"
          className="stroke-border"
          strokeWidth={SW}
        />
        {fillLength > 0 && (
          <rect
            x={p}
            y={p}
            width={rw}
            height={rh}
            rx={rx}
            fill="none"
            stroke={MACRO_COLORS.calories}
            strokeWidth={SW}
            strokeDasharray={`${fillLength} ${perimeter}`}
            strokeDashoffset={-startOffset}
            strokeLinecap="round"
          />
        )}
        {pendingFillLength > 0 && (
          <rect
            x={p}
            y={p}
            width={rw}
            height={rh}
            rx={rx}
            fill="none"
            stroke={MACRO_COLORS.calories}
            strokeOpacity={0.45}
            strokeWidth={SW}
            strokeDasharray={`${pendingFillLength} ${perimeter}`}
            strokeDashoffset={-(startOffset + fillLength)}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="whitespace-nowrap text-xs font-medium tabular-nums text-foreground">
          {Math.round(total)} / {targetLabel}
        </span>
      </div>
    </div>
  );
}

const DRUM_ITEM_H = 44;
const DRUM_VISIBLE = 5;
const DRUM_PADDING = Math.floor(DRUM_VISIBLE / 2);

export function DrumColumn({
  count,
  selectedIndex,
  onSelect,
  getLabel,
}: {
  count: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  getLabel: (index: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = selectedIndex * DRUM_ITEM_H;
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!ref.current) return;
    const target = selectedIndex * DRUM_ITEM_H;
    if (Math.abs(ref.current.scrollTop - target) > 2) {
      ref.current.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [selectedIndex]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let timer: number | null = null;
    const handleScroll = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const index = Math.round(el.scrollTop / DRUM_ITEM_H);
        const clamped = Math.max(0, Math.min(count - 1, index));
        onSelectRef.current(clamped);
        el.scrollTo({ top: clamped * DRUM_ITEM_H, behavior: "smooth" });
      }, 80);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [count]);

  return (
    <div className="relative h-[220px] flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-11 -translate-y-1/2 rounded-lg border border-border bg-muted/40" />
      <div
        ref={ref}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain scrollbar-none"
        style={{
          scrollSnapType: "y mandatory",
          paddingTop: DRUM_PADDING * DRUM_ITEM_H,
          paddingBottom: DRUM_PADDING * DRUM_ITEM_H,
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            style={{ scrollSnapAlign: "center", height: DRUM_ITEM_H }}
            className={cn(
              "flex items-center justify-center text-sm font-medium transition-colors",
              i === selectedIndex
                ? "text-foreground"
                : "text-muted-foreground/50",
            )}
          >
            {getLabel(i)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeaderChips({
  selectedDate,
  selectedHour,
  todayDate,
  onDateChange,
  onHourChange,
  calorieSummary,
  pendingCount,
  pendingCalories,
  onViewPending,
}: {
  selectedDate: Date;
  selectedHour: number;
  todayDate: Date;
  onDateChange: (date: Date) => void;
  onHourChange: (hour: number) => void;
  calorieSummary: DailyCalorieSummary;
  pendingCount: number;
  pendingCalories: number;
  onViewPending: () => void;
}) {
  const [timeDrawerOpen, setTimeDrawerOpen] = useState(false);
  const { consumed, target } = calorieSummary;

  const dates = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date(todayDate);
        d.setDate(todayDate.getDate() - (13 - i));
        return d;
      }),
    [todayDate],
  );

  const selectedDateIndex = dates.findIndex(
    (d) => d.getTime() === selectedDate.getTime(),
  );

  function getDateLabel(i: number) {
    const d = dates[i];
    if (!d) return "";
    if (d.getTime() === todayDate.getTime()) return "Today";
    return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-3 pb-2">
      <div className="flex items-center gap-2">
        <Link
          href="/app"
          aria-label="Close"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <X className="size-4" />
        </Link>
        <Drawer open={timeDrawerOpen} onOpenChange={setTimeDrawerOpen}>
          <DrawerTrigger asChild>
            <button
              type="button"
              className="h-9 shrink-0 rounded-full bg-muted px-4 text-xs font-medium text-foreground"
            >
              {formatHourLabel(selectedHour)}
            </button>
          </DrawerTrigger>
          <DrawerContent className="pb-safe">
            <VisuallyHidden>
              <DrawerTitle>Select time</DrawerTitle>
              <DrawerDescription>
                Choose the date and time for this log entry.
              </DrawerDescription>
            </VisuallyHidden>
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <p className="text-base font-semibold">When</p>
              <button
                type="button"
                onClick={() => setTimeDrawerOpen(false)}
                className="text-sm font-medium text-accent"
              >
                Done
              </button>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <DrumColumn
                count={dates.length}
                selectedIndex={Math.max(0, selectedDateIndex)}
                onSelect={(i) => onDateChange(dates[i]!)}
                getLabel={getDateLabel}
              />
              <div className="w-px self-stretch bg-border/40" />
              <DrumColumn
                count={24}
                selectedIndex={selectedHour}
                onSelect={onHourChange}
                getLabel={(i) => formatHourLabel(i)}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      <div className="flex justify-center">
        <CaloriePill
          consumed={consumed}
          pending={pendingCalories}
          target={target}
        />
      </div>

      <div className="flex justify-end">
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={onViewPending}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-label={`${pendingCount} foods staged`}
          >
            <Utensils className="size-4" />
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-foreground">
              {pendingCount}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex items-stretch border-b border-border">
      {NAV_TABS.map(({ href, label, Icon }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 py-3 text-sm",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
            <span className="whitespace-nowrap">{label}</span>
            {isActive ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-foreground" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function PendingMacroTotals({
  totals,
  targets,
}: {
  totals: { calories: number; protein: number; fat: number; carbs: number };
  targets?: {
    calories: number | null;
    protein: number | null;
    fat: number | null;
    carbs: number | null;
  };
}) {
  const rows = [
    {
      key: "calories" as const,
      label: "kcal",
      value: totals.calories,
      target: targets?.calories ?? null,
      color: MACRO_COLORS.calories,
    },
    {
      key: "protein" as const,
      label: "P",
      value: totals.protein,
      target: targets?.protein ?? null,
      color: MACRO_COLORS.protein,
    },
    {
      key: "fat" as const,
      label: "F",
      value: totals.fat,
      target: targets?.fat ?? null,
      color: MACRO_COLORS.fat,
    },
    {
      key: "carbs" as const,
      label: "C",
      value: totals.carbs,
      target: targets?.carbs ?? null,
      color: MACRO_COLORS.carbs,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {rows.map(({ key, label, value, target, color }) => {
        const pct =
          target != null && target > 0
            ? Math.min(100, (value / target) * 100)
            : 0;
        return (
          <div key={key} className="flex min-w-0 flex-col gap-1.5">
            <p className="text-lg font-semibold tabular-nums leading-none">
              {Math.round(value)}
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <p className="text-[10px] font-medium tabular-nums text-muted-foreground">
              {label}
              {target != null && target > 0 ? ` of ${Math.round(target)}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function PendingFoodRow({
  food,
  onRemove,
  onEdit,
}: {
  food: PendingFood;
  onRemove: (uid: string) => void;
  onEdit?: (food: PendingFood) => void;
}) {
  const displayName = pendingDisplayName(food);
  const amount = formatPendingAmount(food);

  const body = (
    <>
      <div className="text-sm font-medium leading-tight truncate">
        {displayName}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs leading-tight tabular-nums text-muted-foreground">
        <span className="inline-flex items-center font-medium">
          {formatCalories(food.macros.calories)}
          <Flame className="ml-0.5 size-3" />
        </span>
        <span>{Math.round(food.macros.protein)}P</span>
        <span>{Math.round(food.macros.fat)}F</span>
        <span>{Math.round(food.macros.carbs)}C</span>
        <span aria-hidden="true">•</span>
        <span className="truncate">{amount}</span>
      </div>
    </>
  );

  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
        <FoodIcon
          name={food.food.name}
          iconKey={food.food.iconKey}
          entryType={food.entryType ?? "food"}
          className="size-7 object-contain"
        />
      </span>
      {onEdit ? (
        <button
          type="button"
          onClick={() => onEdit(food)}
          aria-label={`Edit ${displayName}`}
          className="min-w-0 flex-1 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      <button
        type="button"
        onClick={() => onRemove(food.uid)}
        aria-label={`Remove ${displayName}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

export function PendingFoodsSheet({
  open,
  onClose,
  pendingFoods,
  onRemove,
  onCommit,
  isLogging,
}: {
  open: boolean;
  onClose: () => void;
  pendingFoods: PendingFood[];
  onRemove: (uid: string) => void;
  onCommit: () => void;
  isLogging: boolean;
}) {
  const totals = sumPendingMacros(pendingFoods);

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <VisuallyHidden>
          <DrawerTitle>Staged foods</DrawerTitle>
          <DrawerDescription>
            Review and commit your staged food entries.
          </DrawerDescription>
        </VisuallyHidden>
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <p className="text-sm font-semibold text-foreground">
            {pendingFoods.length} food{pendingFoods.length !== 1 ? "s" : ""}{" "}
            staged
          </p>
        </div>
        <div className="px-4 pb-3">
          <PendingMacroTotals totals={totals} />
        </div>
        <div className="max-h-[55dvh] overflow-y-auto overscroll-contain border-t border-border/50">
          {pendingFoods.map((food) => (
            <PendingFoodRow key={food.uid} food={food} onRemove={onRemove} />
          ))}
        </div>
        <div className="px-3 pt-3 pb-safe-end">
          <button
            type="button"
            onClick={onCommit}
            disabled={isLogging || pendingFoods.length === 0}
            className="h-11 w-full rounded-2xl bg-foreground text-sm font-semibold text-background disabled:opacity-50"
          >
            {isLogging ? "Logging..." : "Log Foods"}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
