import {
  computeNutritionScale,
  formatFoodQuantity,
  GRAMS_PER_LB,
  GRAMS_PER_OZ,
  getServingDisplay,
  getServingWeightGrams,
  quantityForScale,
} from "@repo/macros-core/foods/display";
import type {
  MacrosEnteredUnit,
  MacrosFoodLogEntry,
} from "@repo/schemas/macros";

export interface AmountModel {
  units: MacrosEnteredUnit[];
  /** Short name for the serving unit, e.g. "slice". */
  servingName: string;
  /** Full serving description for the hint line, e.g. "slice • 30 g". */
  servingDetail: string | null;
  servingGrams: number | null;
  servingUnitQuantity: number;
  initialUnit: MacrosEnteredUnit;
  initialQuantity: string;
}

/** How many of the entry's servings `quantity` of `unit` is. */
export function scaleFor(
  quantity: number,
  unit: MacrosEnteredUnit,
  model: Pick<AmountModel, "servingGrams" | "servingUnitQuantity">,
): number {
  return computeNutritionScale(
    quantity,
    unit,
    model.servingGrams,
    model.servingUnitQuantity,
  );
}

/** The inverse of `scaleFor`, formatted for the amount field. */
export function quantityFor(
  scale: number,
  unit: MacrosEnteredUnit,
  model: Pick<AmountModel, "servingGrams" | "servingUnitQuantity">,
): string {
  return quantityForScale(
    scale,
    unit,
    model.servingGrams,
    model.servingUnitQuantity,
  );
}

const GRAMS_PER_UNIT = { g: 1, oz: GRAMS_PER_OZ, lb: GRAMS_PER_LB } as const;

/**
 * A serving with no weight of its own (ml, a slice) that was logged by mass
 * still says what one serving weighed: the typed weight over the servings it
 * came to. Without it an edit is read against a guessed 100 g.
 */
function impliedServingGrams(entry: MacrosFoodLogEntry): number | null {
  const unit = entry.enteredUnit;
  if (!unit || unit === "serving") return null;
  const quantity = entry.enteredQuantity;
  if (quantity == null || quantity <= 0 || entry.servingsConsumed <= 0) {
    return null;
  }
  return (quantity * GRAMS_PER_UNIT[unit]) / entry.servingsConsumed;
}

export function amountModel(entry: MacrosFoodLogEntry): AmountModel {
  const display = getServingDisplay(
    entry.servingLabel,
    entry.servingQuantity,
    entry.servingUnit,
  );
  const servingGrams =
    getServingWeightGrams(entry.servingQuantity, entry.servingUnit) ??
    impliedServingGrams(entry);
  const servingUnitQuantity = display.servingUnitQuantity;

  // A quick add has no food behind it, so grams would be measured against a
  // serving that does not exist. It scales by whole entries only.
  if (entry.entryType === "quick_add") {
    return {
      units: ["serving"],
      servingName: "entry",
      servingDetail: null,
      servingGrams: null,
      servingUnitQuantity: 1,
      initialUnit: "serving",
      initialQuantity: formatFoodQuantity(entry.servingsConsumed),
    };
  }

  // Mass units need the serving's weight: without it a gram amount would be
  // read against a guessed 100 g and rescale the entry wrongly. An entry that
  // was already typed in a mass unit keeps its own unit available.
  const massKnown =
    servingGrams !== null ||
    (entry.enteredUnit !== null && entry.enteredUnit !== "serving");
  const units: MacrosEnteredUnit[] = [
    ...(display.servingLabel || !massKnown ? (["serving"] as const) : []),
    ...(massKnown ? (["g", "oz", "lb"] as const) : []),
  ];
  const initialUnit =
    entry.enteredUnit && units.includes(entry.enteredUnit)
      ? entry.enteredUnit
      : display.initialUnit;
  const model = { servingGrams, servingUnitQuantity };
  const initialQuantity =
    entry.enteredQuantity != null && entry.enteredQuantity > 0
      ? formatFoodQuantity(entry.enteredQuantity)
      : quantityFor(entry.servingsConsumed, initialUnit, model);

  return {
    units,
    servingName: display.servingLabel?.split(" • ")[0]?.trim() || "serving",
    servingDetail: display.servingLabel,
    servingGrams,
    servingUnitQuantity,
    initialUnit,
    initialQuantity,
  };
}

export function unitLabel(unit: MacrosEnteredUnit, model: AmountModel): string {
  return unit === "serving" ? model.servingName : unit;
}
