const MASS_LABEL_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(g|oz|lb)\s*$/i;
const LEADING_QUANTITY_RE =
  /^\s*(?:(\d+)\s*\/\s*(\d+)|(\d+(?:[.,]\d+)?))\s+(.+)$/;
const TRAILING_MASS_RE = /\s*[([]\s*\d+(?:[.,]\d+)?\s*(?:g|oz|lb)\s*[)\]]\s*$/i;

export function formatFoodQuantity(
  value: number,
  maximumFractionDigits = 2,
): string {
  if (!Number.isFinite(value)) return "0";
  const precision = 10 ** maximumFractionDigits;
  const rounded = Math.round((value + Number.EPSILON) * precision) / precision;
  return rounded.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits,
  });
}

export function normalizeFoodUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase().replace(/^\.+/, "");
  if (/^(?:0*g|grams?|gr)$/.test(normalized)) return "g";
  if (/^(?:ounces?|ounce)$/.test(normalized)) return "oz";
  if (/^(?:pounds?|pound|lbs?)$/.test(normalized)) return "lb";
  return normalized;
}

export function getServingWeightGrams(
  servingQuantity: number | null,
  servingUnit: string | null,
): number | null {
  if (
    servingQuantity == null ||
    !Number.isFinite(servingQuantity) ||
    servingQuantity <= 0
  ) {
    return null;
  }
  const unit = normalizeFoodUnit(servingUnit ?? "");
  if (unit === "g") return servingQuantity;
  if (unit === "oz") return servingQuantity * 28.3495;
  if (unit === "lb") return servingQuantity * 453.592;
  return null;
}

export function formatServingLabel(label: string): string {
  return label
    .trim()
    .replace(
      /(\d+(?:[.,]\d+)?)\s*(g|oz|lb)\b/gi,
      (_, raw: string, unit: string) =>
        `${formatFoodQuantity(Number(raw.replace(",", ".")))} ${unit.toLowerCase()}`,
    )
    .replace(/\s+/g, " ");
}

export interface ServingDisplay {
  initialQuantity: string;
  initialUnit: "g" | "oz" | "lb" | "serving";
  servingLabel: string | null;
  servingUnitQuantity: number;
}

export function getServingDisplay(
  servingLabel: string | null,
  servingQuantity: number | null,
  servingUnit: string | null,
): ServingDisplay {
  const rawLabel = servingLabel?.trim() ?? "";
  const massMatch = rawLabel.match(MASS_LABEL_RE);
  if (massMatch) {
    const quantity = Number(massMatch[1]?.replace(",", "."));
    const unit = normalizeFoodUnit(massMatch[2] ?? "g");
    if (
      Number.isFinite(quantity) &&
      (unit === "g" || unit === "oz" || unit === "lb")
    ) {
      return {
        initialQuantity: formatFoodQuantity(quantity),
        initialUnit: unit,
        servingLabel: null,
        servingUnitQuantity: 1,
      };
    }
  }

  let servingUnitQuantity = 1;
  let label = formatServingLabel(rawLabel || "serving");
  const quantityMatch = label.match(LEADING_QUANTITY_RE);
  if (quantityMatch) {
    const numerator = Number(quantityMatch[1]);
    const denominator = Number(quantityMatch[2]);
    const decimal = Number(quantityMatch[3]?.replace(",", "."));
    const parsed = quantityMatch[1] ? numerator / denominator : decimal;
    if (Number.isFinite(parsed) && parsed > 0) {
      servingUnitQuantity = parsed;
      label = quantityMatch[4]?.trim() || "serving";
    }
  }

  label = label.replace(TRAILING_MASS_RE, "").trim() || "serving";
  const unit = normalizeFoodUnit(servingUnit ?? "");
  if (
    servingQuantity != null &&
    Number.isFinite(servingQuantity) &&
    servingQuantity > 0 &&
    (unit === "g" || unit === "oz" || unit === "lb")
  ) {
    label = `${label} • ${formatFoodQuantity(servingQuantity)} ${unit}`;
  }

  return {
    initialQuantity: formatFoodQuantity(servingUnitQuantity),
    initialUnit: "serving",
    servingLabel: label,
    servingUnitQuantity,
  };
}
