import {
  formatFoodQuantity,
  formatMeasureAmount,
  formatServingAmount,
  getServingDisplay,
  getServingWeightGrams,
  normalizeFoodUnit,
} from "@repo/macros-core/foods/display";
import {
  type MacrosEnteredUnit,
  type MacrosExternalFoodNutrition,
  macrosCreateFoodServingSizeSchema,
  macrosEnteredUnitSchema,
} from "@repo/schemas/macros";
import { z } from "zod";

/** A serving size a food declares: label plus the measure it stands for. */
export interface DeclaredServing {
  label: string;
  quantity: number;
  unit: string;
}

/** What a food's nutrients are expressed per, plus any other sizes it knows. */
export interface FoodServing {
  servingLabel: string | null;
  servingQuantity: number | null;
  servingUnit: string | null;
  alternates: DeclaredServing[];
}

/**
 * One way of saying how much was eaten. Every option is a linear scale of the
 * food's own serving, which is what the log stores as `servingsConsumed`; the
 * entered measure is kept alongside so the log can echo what was typed.
 */
export interface ServingOption {
  id: string;
  /** Menu title, e.g. "slice • 30 g" or "grams". */
  title: string;
  /** Shown after the typed amount, e.g. "slice" or "g". */
  unit: string;
  /** Food servings that one unit of this option equals. */
  servingsPerUnit: number;
  enteredUnit: MacrosEnteredUnit;
  /** Entered quantity that one unit of this option records. */
  enteredPerUnit: number;
}

export interface ServingOptions {
  options: ServingOption[];
  defaultId: string;
}

const GRAMS_PER: Record<"g" | "oz" | "lb", number> = {
  g: 1,
  oz: 28.3495,
  lb: 453.592,
};

const MASS_TITLES: Record<"g" | "oz" | "lb", string> = {
  g: "grams",
  oz: "ounces",
  lb: "pounds",
};

const servingSizesSchema = z.array(macrosCreateFoodServingSizeSchema);

/**
 * A custom food's snapshot carries every serving it was created with (the
 * snapshot schema passes unknown keys through); a source food declares the
 * product's own serving separately from the per-100 g basis.
 */
export function foodServingFrom(
  nutrition: MacrosExternalFoodNutrition,
): FoodServing {
  const alternates: DeclaredServing[] = [];
  const declared = servingSizesSchema.safeParse(
    "servingSizes" in nutrition ? nutrition.servingSizes : undefined,
  );
  if (declared.success) alternates.push(...declared.data);
  const packageQuantity = nutrition.packageServingQnty;
  if (
    nutrition.packageServingLabel &&
    nutrition.packageServingUnit &&
    packageQuantity != null &&
    packageQuantity > 0
  ) {
    alternates.push({
      label: nutrition.packageServingLabel,
      quantity: packageQuantity,
      unit: nutrition.packageServingUnit,
    });
  }
  return {
    servingLabel: nutrition.servingLabel,
    servingQuantity: nutrition.servingQuantity,
    servingUnit: nutrition.servingUnit,
    alternates,
  };
}

function shortUnit(label: string): string {
  return label.split(" • ")[0]?.trim() || "serving";
}

function isMassUnit(unit: string): unit is "g" | "oz" | "lb" {
  return unit === "g" || unit === "oz" || unit === "lb";
}

function sameServing(left: DeclaredServing, right: FoodServing): boolean {
  return (
    left.label.trim().toLowerCase() ===
      (right.servingLabel ?? "").trim().toLowerCase() &&
    normalizeFoodUnit(left.unit) ===
      normalizeFoodUnit(right.servingUnit ?? "") &&
    Math.abs(left.quantity - (right.servingQuantity ?? Number.NaN)) < 0.001
  );
}

/**
 * The picker's options, mirroring the web's scale: a typed weight is divided
 * by the serving's weight, a typed serving count by the count its label
 * starts with ("2 slices" → per slice). Unlike the web, weights are only
 * offered when the serving's weight is actually known — assuming 100 g for
 * "1 cup" would log a silently wrong amount.
 */
export function buildServingOptions(serving: FoodServing): ServingOptions {
  const display = getServingDisplay(
    serving.servingLabel,
    serving.servingQuantity,
    serving.servingUnit,
  );
  const primaryUnit = normalizeFoodUnit(serving.servingUnit ?? "");
  const servingGrams =
    getServingWeightGrams(serving.servingQuantity, serving.servingUnit) ??
    (primaryUnit === "ml" && serving.servingQuantity
      ? serving.servingQuantity
      : null);

  const options: ServingOption[] = [];

  if (display.initialUnit === "serving") {
    const title = display.servingLabel ?? "serving";
    options.push({
      id: "serving",
      title,
      unit: shortUnit(title),
      servingsPerUnit: 1 / display.servingUnitQuantity,
      enteredUnit: "serving",
      enteredPerUnit: 1,
    });
  }

  serving.alternates.forEach((alternate, index) => {
    if (sameServing(alternate, serving)) return;
    const alternateDisplay = getServingDisplay(
      alternate.label,
      alternate.quantity,
      alternate.unit,
    );
    // A size labelled by weight ("100g") is just grams, already offered.
    if (alternateDisplay.initialUnit !== "serving") return;
    const perUnitQuantity =
      alternate.quantity / alternateDisplay.servingUnitQuantity;
    const alternateGrams = getServingWeightGrams(
      alternate.quantity,
      alternate.unit,
    );
    const title = alternateDisplay.servingLabel ?? alternate.label;

    if (alternateGrams != null && servingGrams != null) {
      const gramsPerUnit =
        alternateGrams / alternateDisplay.servingUnitQuantity;
      options.push({
        id: `alt-${index}`,
        title,
        unit: shortUnit(title),
        servingsPerUnit: gramsPerUnit / servingGrams,
        enteredUnit: "g",
        enteredPerUnit: gramsPerUnit,
      });
      return;
    }

    const sameUnit =
      normalizeFoodUnit(alternate.unit) === primaryUnit &&
      serving.servingQuantity != null &&
      serving.servingQuantity > 0 &&
      display.initialUnit === "serving";
    if (sameUnit && serving.servingQuantity != null) {
      const servingsPerUnit = perUnitQuantity / serving.servingQuantity;
      options.push({
        id: `alt-${index}`,
        title: `${title} · ${formatFoodQuantity(perUnitQuantity)} ${alternate.unit}`,
        unit: shortUnit(title),
        servingsPerUnit,
        enteredUnit: "serving",
        enteredPerUnit: servingsPerUnit * display.servingUnitQuantity,
      });
    }
  });

  if (servingGrams != null) {
    for (const unit of ["g", "oz", "lb"] as const) {
      options.push({
        id: unit,
        title: MASS_TITLES[unit],
        unit,
        servingsPerUnit: GRAMS_PER[unit] / servingGrams,
        enteredUnit: unit,
        enteredPerUnit: 1,
      });
    }
  }

  if (options.length === 0) {
    options.push({
      id: "serving",
      title: display.servingLabel ?? "serving",
      unit: shortUnit(display.servingLabel ?? "serving"),
      servingsPerUnit: 1,
      enteredUnit: "serving",
      enteredPerUnit: 1,
    });
  }

  const preferred =
    display.initialUnit === "serving" ? "serving" : display.initialUnit;
  const defaultId = options.some((option) => option.id === preferred)
    ? preferred
    : (options[0]?.id ?? "serving");

  return { options, defaultId };
}

export function findOption(
  { options, defaultId }: ServingOptions,
  id: string,
): ServingOption {
  const match =
    options.find((option) => option.id === id) ??
    options.find((option) => option.id === defaultId) ??
    options[0];
  if (!match) throw new Error("A food always has at least one serving option");
  return match;
}

export function servingsFor(quantity: number, option: ServingOption): number {
  return quantity * option.servingsPerUnit;
}

export function quantityFor(servings: number, option: ServingOption): number {
  return servings / option.servingsPerUnit;
}

export function measureFor(quantity: number, option: ServingOption) {
  return {
    enteredQuantity: Math.round(quantity * option.enteredPerUnit * 1e4) / 1e4,
    enteredUnit: option.enteredUnit,
  };
}

/** What was used last time, else the given serving count in the default unit. */
export function initialAmount(
  serving: ServingOptions,
  prior: {
    servings?: number | null;
    enteredQuantity?: number | null;
    enteredUnit?: string | null;
  },
): { optionId: string; quantity: number } {
  const unit = macrosEnteredUnitSchema.safeParse(prior.enteredUnit);
  if (
    unit.success &&
    prior.enteredQuantity != null &&
    prior.enteredQuantity > 0 &&
    serving.options.some((option) => option.id === unit.data)
  ) {
    return { optionId: unit.data, quantity: prior.enteredQuantity };
  }
  const option = findOption(serving, serving.defaultId);
  const servings =
    prior.servings != null && prior.servings > 0 ? prior.servings : 1;
  return { optionId: option.id, quantity: quantityFor(servings, option) };
}

export function formatQuantityInput(quantity: number): string {
  if (!Number.isFinite(quantity) || quantity <= 0) return "";
  return formatFoodQuantity(quantity);
}

/** The log's own amount rule: a typed weight wins over the serving. */
export function describeAmount({
  servingLabel,
  servingsConsumed,
  enteredQuantity,
  enteredUnit,
}: {
  servingLabel: string | null | undefined;
  servingsConsumed: number;
  enteredQuantity?: number | null;
  enteredUnit?: string | null;
}): string {
  if (
    enteredUnit != null &&
    isMassUnit(enteredUnit) &&
    enteredQuantity != null &&
    Number.isFinite(enteredQuantity) &&
    enteredQuantity > 0
  ) {
    return formatMeasureAmount(enteredQuantity, enteredUnit);
  }
  return formatServingAmount(servingLabel, servingsConsumed);
}

export function scaleNutrients(
  nutrients: Record<string, number>,
  servings: number,
): Record<string, number> {
  const scaled: Record<string, number> = {};
  for (const [key, amount] of Object.entries(nutrients)) {
    scaled[key] = amount * servings;
  }
  return scaled;
}

export interface MacroSnapshot {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function macrosOf(nutrients: Record<string, number>): MacroSnapshot {
  return {
    calories: nutrients.calories ?? 0,
    protein: nutrients.protein ?? 0,
    carbs: nutrients.carbs ?? 0,
    fat: nutrients.fat ?? 0,
  };
}

/** Per-serving figures from a list row, scaled; unknown macros read as zero. */
export function macrosFromPerServing(
  perServing: {
    caloriesPerServing: number | null;
    proteinPerServing: number | null;
    carbsPerServing: number | null;
    fatPerServing: number | null;
  },
  servings: number,
): MacroSnapshot {
  return {
    calories: (perServing.caloriesPerServing ?? 0) * servings,
    protein: (perServing.proteinPerServing ?? 0) * servings,
    carbs: (perServing.carbsPerServing ?? 0) * servings,
    fat: (perServing.fatPerServing ?? 0) * servings,
  };
}
