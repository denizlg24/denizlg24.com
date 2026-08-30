"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@repo/ui/keyboard-sheet";
import { cn } from "@repo/ui/utils";
import { ArrowLeft, CornerDownLeft, Delete, Flame, Star } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { formatCalories, formatFoodQuantity } from "@/lib/foods/display";
import {
  type NutrientKey,
  nutrientDefinitionsInput,
} from "@/lib/foods/nutrients";
import {
  NUTRIENT_SECTIONS,
  NUTRIENT_UPPER_LIMITS,
  WHO_DAILY_VALUES,
} from "@/lib/foods/who-guidelines";
import {
  MACRO_COLORS,
  NUTRIENT_DEFAULT_COLOR,
  NUTRIENT_GROUP_COLORS,
  NUTRIENT_OVERFLOW_COLOR,
} from "@/lib/macro-colors";
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";

export type NutritionUnit = "g" | "oz" | "lb" | "serving";

export type EnteredMeasure = { quantity: number; unit: NutritionUnit };

function fmtAmount(v: number) {
  if (v !== 0 && Math.abs(v) < 0.01) {
    return v.toPrecision(2);
  }
  return formatFoodQuantity(v, Math.abs(v) < 10 ? 2 : 1);
}

function nutrientLabel(key: NutrientKey) {
  return nutrientDefinitionsInput.find((d) => d.key === key)?.label ?? key;
}

function nutrientUnit(key: NutrientKey) {
  return nutrientDefinitionsInput.find((d) => d.key === key)?.unit ?? "";
}

export function computeNutritionScale(
  qty: number,
  unit: NutritionUnit,
  servingQuantityGrams: number | null,
  servingUnitQuantity = 1,
): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (unit === "serving") return qty / servingUnitQuantity;
  const gramsPerServing = servingQuantityGrams ?? 100;
  if (unit === "oz") return (qty * 28.3495) / gramsPerServing;
  if (unit === "lb") return (qty * 453.592) / gramsPerServing;
  return qty / gramsPerServing;
}

export function quantityForScale(
  scale: number,
  unit: NutritionUnit,
  servingQuantityGrams: number | null,
  servingUnitQuantity = 1,
): string {
  if (!Number.isFinite(scale) || scale <= 0) return "1";
  if (unit === "serving")
    return formatFoodQuantity(scale * servingUnitQuantity);
  const grams = scale * (servingQuantityGrams ?? 100);
  if (unit === "oz") return formatFoodQuantity(grams / 28.3495);
  if (unit === "lb") return formatFoodQuantity(grams / 453.592);
  return formatFoodQuantity(grams);
}

function macroCaloriePct(
  macro: "protein" | "fat" | "carbs",
  nutrients: Record<string, number>,
): number {
  const kcal = nutrients.calories ?? 0;
  if (kcal === 0) return 0;
  const grams = nutrients[macro] ?? 0;
  const factor = macro === "fat" ? 9 : 4;
  return Math.round(((grams * factor) / kcal) * 100);
}

function impactPct(nutrientValue: number, target: number | null): number {
  if (!target || target === 0) return 0;
  return Math.round((nutrientValue / target) * 100);
}

function getTargetForKey(
  key: NutrientKey,
  calorieSummary: DailyCalorieSummary,
): number | null {
  if (key === "calories") return calorieSummary.target;
  if (key === "protein") return calorieSummary.proteinTarget;
  if (key === "carbs") return calorieSummary.carbsTarget;
  if (key === "fat") return calorieSummary.fatTarget;
  return WHO_DAILY_VALUES[key] ?? null;
}

const SECTION_COLORS: Record<string, string> = {
  "Carb Breakdown": MACRO_COLORS.carbs,
  "Fat Breakdown": MACRO_COLORS.fat,
  Vitamins: NUTRIENT_GROUP_COLORS.vitamins,
  Minerals: NUTRIENT_GROUP_COLORS.minerals,
  "Protein & Amino Acids": MACRO_COLORS.protein,
  Other: NUTRIENT_GROUP_COLORS.other,
};

function getSectionColor(title: string): string {
  return SECTION_COLORS[title] ?? NUTRIENT_DEFAULT_COLOR;
}

function MacroBadge({ pct, color }: { pct: number; color: string }) {
  return (
    <span
      className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
      style={{ backgroundColor: color }}
    >
      {pct}%
    </span>
  );
}

function ImpactRing({
  pct,
  stroke,
  label,
}: {
  pct: number;
  stroke: string;
  label: string;
}) {
  const r = 22;
  const sw = 2.5;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative size-13">
        <svg
          viewBox="0 0 52 52"
          className="absolute inset-0 -rotate-90"
          aria-hidden
        >
          <circle
            cx="26"
            cy="26"
            r={r}
            fill="none"
            strokeWidth={sw}
            className="stroke-muted"
          />
          {dash > 0 && (
            <circle
              cx="26"
              cy="26"
              r={r}
              fill="none"
              strokeWidth={sw}
              stroke={stroke}
              strokeDasharray={`${dash} ${circ}`}
              strokeLinecap="round"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] font-semibold tabular-nums">{pct}%</span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

const PLANNED_MACRO_KEYS = new Set<NutrientKey>([
  "calories",
  "protein",
  "carbs",
  "fat",
]);

function NutrientRow({
  nutrientKey,
  label,
  amount,
  target,
  unit,
  color,
}: {
  nutrientKey: NutrientKey;
  label: string;
  amount: number;
  target: number | null;
  unit: string;
  color: string;
}) {
  const isPlannedMacro = PLANNED_MACRO_KEYS.has(nutrientKey);
  const hasTarget = target != null && target > 0;

  let barContent: ReactNode;

  if (isPlannedMacro && hasTarget) {
    const fillPct = Math.min((amount / target) * 100, 100);
    const overflow = amount > target;
    barContent = (
      <div className="mt-1.5 h-0.75 w-full overflow-hidden rounded-none bg-muted">
        <div
          className="h-full rounded-none transition-all"
          style={{
            width: `${fillPct}%`,
            backgroundColor: overflow ? NUTRIENT_OVERFLOW_COLOR : color,
          }}
        />
      </div>
    );
  } else {
    const ul = NUTRIENT_UPPER_LIMITS[nutrientKey];
    const scale = ul ?? (hasTarget ? target * 3 : Math.max(amount * 1.5, 1));
    const fillPct = scale > 0 ? Math.min((amount / scale) * 100, 100) : 0;
    const zonePct = hasTarget ? Math.min((target / scale) * 100, 100) : null;
    barContent = (
      <div className="relative mt-1.5 h-0.75 w-full rounded-none bg-muted">
        {zonePct != null && (
          <div
            className="absolute top-0 h-full rounded-none"
            style={{
              width: `${zonePct}%`,
              backgroundColor: color,
              opacity: 0.25,
            }}
          />
        )}
        <div
          className="absolute top-0 h-full rounded-none"
          style={{ width: `${fillPct}%`, backgroundColor: color }}
        />
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {nutrientKey === "calories"
            ? formatCalories(amount)
            : fmtAmount(amount)}{" "}
          {unit}
        </span>
      </div>
      {barContent}
    </div>
  );
}

function ServingEditor({
  qty,
  unit,
  servingLabel,
  availableUnits,
  onChange,
  onAdd,
  actionLabel,
  isAdding,
  expanded,
  onExpandedChange,
}: {
  qty: string;
  unit: NutritionUnit;
  servingLabel: string | null;
  availableUnits: NutritionUnit[];
  onChange: (qty: string, unit: NutritionUnit) => void;
  onAdd: () => void;
  actionLabel: string;
  isAdding: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const unitDefs: { id: NutritionUnit; label: string }[] = [
    { id: "g", label: "g" },
    { id: "oz", label: "oz" },
    { id: "serving", label: servingLabel ?? "serving" },
    { id: "lb", label: "lb" },
  ];
  const units = unitDefs.filter((entry) => availableUnits.includes(entry.id));

  const unitLabel = unit === "serving" ? (servingLabel ?? "serving") : unit;
  const amountLabel = qty.trim() || "0";

  const [primed, setPrimed] = useState(expanded);

  useEffect(() => {
    if (expanded) setPrimed(true);
  }, [expanded]);

  const commitQty = useCallback(
    (nextQty: string) => {
      onChange(nextQty, unit);
    },
    [onChange, unit],
  );

  const pressKey = useCallback(
    (key: string) => {
      if (/^\d$/.test(key)) {
        setPrimed(false);
        commitQty(primed || qty === "0" ? key : `${qty}${key}`);
        return;
      }

      if (key === ".") {
        setPrimed(false);
        if (primed) {
          commitQty("0.");
        } else if (!qty.includes(".")) {
          commitQty(qty ? `${qty}.` : "0.");
        }
        return;
      }

      if (key === "backspace") {
        setPrimed(false);
        commitQty(primed || qty.length <= 1 ? "0" : qty.slice(0, -1));
        return;
      }

      if (key === "done") {
        onExpandedChange(false);
      }
    },
    [commitQty, onExpandedChange, primed, qty],
  );

  const keypad = [
    "1",
    "2",
    "3",
    "backspace",
    "4",
    "5",
    "6",
    "done",
    "7",
    "8",
    "9",
    "add",
    ".",
    "0",
  ];

  return (
    <div
      className={cn(
        "flex-none border-t border-border bg-muted/60 px-2 pt-2 pb-safe-end text-xs",
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "grid gap-2",
          expanded ? "grid-cols-1" : "grid-cols-[1fr_auto]",
        )}
      >
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          className={cn(
            "flex h-9 min-w-0 items-center justify-between rounded-md bg-background px-2.5 text-left text-xs tabular-nums text-foreground shadow-inner",
            expanded && "ring-2 ring-foreground",
          )}
        >
          <span className="flex min-w-0 items-center">
            <span
              className={cn(
                "truncate rounded-[2px]",
                expanded && primed && "bg-accent px-0.5 text-accent-foreground",
              )}
            >
              {amountLabel}
            </span>
            <span className="macros-caret-blink ml-0.5 h-4 w-px bg-accent" />
          </span>
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">
            {unitLabel}
          </span>
        </button>

        {!expanded ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={isAdding}
            className="h-9 rounded-md bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"
          >
            {isAdding ? "Saving..." : actionLabel}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {[0.5, 1, 1.5, 2].map((preset) => (
              <button
                key={preset}
                type="button"
                className="min-h-10 rounded-md bg-background text-xs font-semibold"
                onClick={() => {
                  setPrimed(false);
                  onChange(String(preset), unit);
                }}
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="mt-1.5">
            <div
              className={cn(
                "grid min-w-0 gap-1",
                units.length === 1
                  ? "grid-cols-1"
                  : units.length === 2
                    ? "grid-cols-2"
                    : units.length === 3
                      ? "grid-cols-3"
                      : "grid-cols-4",
              )}
            >
              {units.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(qty, id)}
                  className={cn(
                    "h-7 rounded-full px-1.5 text-xs font-semibold transition-colors",
                    unit === id
                      ? "bg-foreground text-background"
                      : "bg-background text-foreground",
                  )}
                >
                  <span className="block truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {keypad.map((key) => {
              if (key === "add") {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={onAdd}
                    disabled={isAdding}
                    className="h-9 rounded-sm bg-foreground text-xs font-semibold text-background disabled:opacity-50"
                  >
                    {isAdding ? "Saving..." : actionLabel}
                  </button>
                );
              }

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pressKey(key)}
                  className="flex h-9 items-center justify-center rounded-sm bg-muted text-xs font-medium tabular-nums text-foreground active:bg-muted/70"
                  aria-label={
                    key === "backspace"
                      ? "Backspace"
                      : key === "done"
                        ? "Done"
                        : key
                  }
                >
                  {key === "backspace" ? (
                    <Delete className="size-4" />
                  ) : key === "done" ? (
                    <CornerDownLeft className="size-4" />
                  ) : (
                    key
                  )}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export interface NutritionDetailDrawerProps {
  open: boolean;
  displayName: string;
  icon?: ReactNode;
  servingLabel: string | null;
  servingQuantityGrams: number | null;
  servingUnitQuantity?: number;
  perServingNutrients: Record<string, number> | null;
  fallbackPerServing?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  calorieSummary: DailyCalorieSummary;
  isLoadingNutrition: boolean;
  isLogging: boolean;
  initialUnit?: NutritionUnit;
  initialQuantity?: string;
  availableUnits?: NutritionUnit[];
  onClose: () => void;
  isFavorite?: boolean;
  onFavoriteChange?: () => void;
  headerActions?: ReactNode;
  /** Rendered at the end of the scroll area, above the serving editor. */
  extraContent?: ReactNode;
  actionLabel?: string;
  onAdd: (
    scale: number,
    scaledNutrients: Record<string, number>,
    measure: EnteredMeasure,
  ) => Promise<void> | void;
}

export function NutritionDetailDrawer({
  open,
  displayName,
  icon,
  servingLabel,
  servingQuantityGrams,
  servingUnitQuantity = 1,
  perServingNutrients,
  fallbackPerServing,
  calorieSummary,
  isLoadingNutrition,
  isLogging,
  initialUnit,
  initialQuantity = "1",
  availableUnits,
  onClose,
  isFavorite = false,
  onFavoriteChange,
  headerActions,
  extraContent,
  actionLabel = "Add",
  onAdd,
}: NutritionDetailDrawerProps) {
  const computedAvailableUnits =
    availableUnits ??
    (servingLabel
      ? (["g", "oz", "serving", "lb"] as NutritionUnit[])
      : (["g", "oz", "lb"] as NutritionUnit[]));

  const computedInitialUnit: NutritionUnit =
    initialUnit ?? (servingLabel ? "serving" : "g");

  const [qty, setQty] = useState(initialQuantity);
  const [unit, setUnit] = useState<NutritionUnit>(computedInitialUnit);
  const [servingEditorExpanded, setServingEditorExpanded] = useState(open);

  useEffect(() => {
    setQty(initialQuantity);
    setUnit(computedInitialUnit);
  }, [computedInitialUnit, initialQuantity]);

  useEffect(() => {
    setServingEditorExpanded(open);
  }, [open]);

  const scale = useMemo(() => {
    const n = parseFloat(qty);
    return computeNutritionScale(
      n,
      unit,
      servingQuantityGrams,
      servingUnitQuantity,
    );
  }, [qty, unit, servingQuantityGrams, servingUnitQuantity]);

  const scaledNutrients = useMemo<Record<string, number>>(() => {
    if (!perServingNutrients) {
      if (!fallbackPerServing) return {};
      return {
        calories: fallbackPerServing.calories * scale,
        protein: fallbackPerServing.protein * scale,
        fat: fallbackPerServing.fat * scale,
        carbs: fallbackPerServing.carbs * scale,
      };
    }
    return Object.fromEntries(
      Object.entries(perServingNutrients).map(([k, v]) => [k, v * scale]),
    );
  }, [perServingNutrients, fallbackPerServing, scale]);

  const handleQtyUnitChange = useCallback(
    (newQty: string, newUnit: NutritionUnit) => {
      setQty(newQty);
      setUnit(newUnit);
    },
    [],
  );

  const handleAdd = useCallback(async () => {
    const quantity = parseFloat(qty);
    await onAdd(scale > 0 ? scale : 1, scaledNutrients, {
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unit,
    });
  }, [onAdd, qty, scale, scaledNutrients, unit]);

  const calories = scaledNutrients.calories ?? 0;
  const protein = scaledNutrients.protein ?? 0;
  const fat = scaledNutrients.fat ?? 0;
  const carbs = scaledNutrients.carbs ?? 0;

  const proteinPct = macroCaloriePct("protein", scaledNutrients);
  const fatPct = macroCaloriePct("fat", scaledNutrients);
  const carbsPct = macroCaloriePct("carbs", scaledNutrients);

  const calImpact = impactPct(calories, calorieSummary.target);
  const proteinImpact = impactPct(protein, calorieSummary.proteinTarget);
  const fatImpact = impactPct(fat, calorieSummary.fatTarget);
  const carbsImpact = impactPct(carbs, calorieSummary.carbsTarget);

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent className="flex h-[calc(100dvh-4rem)]! max-h-none! flex-col rounded-none">
        <VisuallyHidden>
          <DrawerTitle>{displayName}</DrawerTitle>
          <DrawerDescription>
            View nutrition info and add to your food log
          </DrawerDescription>
        </VisuallyHidden>

        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          {icon ? (
            <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
              {icon}
            </span>
          ) : null}
          <h2 className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </h2>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onFavoriteChange ? (
              <button
                type="button"
                aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
                className="flex size-8 items-center justify-center rounded-full"
                onClick={onFavoriteChange}
              >
                <Star
                  className={cn(
                    "size-4",
                    isFavorite && "fill-current text-primary",
                  )}
                />
              </button>
            ) : null}
            {headerActions}
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          onClick={() => setServingEditorExpanded(false)}
        >
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-end gap-4">
              <div className="flex flex-col items-center">
                <span className="text-3xl font-bold tabular-nums text-foreground text-center mx-auto">
                  {formatCalories(calories)}
                </span>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Flame className="size-3" />
                  <span>Calories</span>
                </div>
              </div>
              <div className="flex flex-1 items-end justify-around pb-0.5">
                <div className="flex flex-col items-center gap-1">
                  <MacroBadge pct={proteinPct} color={MACRO_COLORS.protein} />
                  <span className="text-base font-semibold tabular-nums">
                    {fmtAmount(protein)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Protein
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <MacroBadge pct={fatPct} color={MACRO_COLORS.fat} />
                  <span className="text-base font-semibold tabular-nums">
                    {fmtAmount(fat)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">Fat</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <MacroBadge pct={carbsPct} color={MACRO_COLORS.carbs} />
                  <span className="text-base font-semibold tabular-nums">
                    {fmtAmount(carbs)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Carbs
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 pb-3">
            <p className="mb-3 text-xs font-semibold text-foreground">
              Impact on Targets
            </p>
            <div className="flex justify-around">
              <ImpactRing
                pct={calImpact}
                stroke={MACRO_COLORS.calories}
                label="Calories"
              />
              <ImpactRing
                pct={proteinImpact}
                stroke={MACRO_COLORS.protein}
                label="Protein"
              />
              <ImpactRing
                pct={fatImpact}
                stroke={MACRO_COLORS.fat}
                label="Fat"
              />
              <ImpactRing
                pct={carbsImpact}
                stroke={MACRO_COLORS.carbs}
                label="Carbs"
              />
            </div>
          </div>

          <div className="mx-4 h-px bg-border" />

          {NUTRIENT_SECTIONS.map((section) => {
            const color = getSectionColor(section.title);
            const rows = section.keys
              .map((key) => {
                const raw = scaledNutrients[key];
                if (raw == null) return null;
                return {
                  key,
                  label: nutrientLabel(key),
                  amount: raw,
                  target: getTargetForKey(key, calorieSummary),
                  unit: nutrientUnit(key),
                };
              })
              .filter((r) => r !== null);

            if (rows.length === 0) return null;

            return (
              <section key={section.title} className="px-4 pt-4">
                <h3 className="mb-1 text-xs font-semibold">{section.title}</h3>
                <div className="divide-y divide-border/40">
                  {rows.map((row) => (
                    <NutrientRow
                      key={row.key}
                      nutrientKey={row.key}
                      label={row.label}
                      amount={row.amount}
                      target={row.target}
                      unit={row.unit}
                      color={color}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {extraContent}

          <div className="h-6" />
        </div>

        {isLoadingNutrition ? (
          <div className="flex-none border-t border-border bg-background px-3 pt-3 pb-safe-end">
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : (
          <ServingEditor
            qty={qty}
            unit={unit}
            servingLabel={servingLabel}
            availableUnits={computedAvailableUnits}
            onChange={handleQtyUnitChange}
            onAdd={handleAdd}
            actionLabel={actionLabel}
            isAdding={isLogging}
            expanded={servingEditorExpanded}
            onExpandedChange={setServingEditorExpanded}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}
