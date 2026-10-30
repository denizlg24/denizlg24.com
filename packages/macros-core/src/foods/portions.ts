/** A household measure as a composition table publishes it. */
export interface PublishedPortion {
  label: string;
  grams: number;
}

/** One unit of a household measure, e.g. `{ label: "head, large", grams: 1248 }`. */
export interface HouseholdServing {
  label: string;
  grams: number;
}

export const MAX_HOUSEHOLD_SERVINGS = 8;

const LEADING_QUANTITY_RE =
  /^\s*(?:(\d+)\s*\/\s*(\d+)|(\d+(?:[.,]\d+)?))\s*(.*)$/;
// Mass and volume are already offered as g/oz/lb; "250ml chopped" is a volume.
const METRIC_RE =
  /^(?:mg|g|gr|grams?|kg|ml|cl|dl|l|oz|ounces?|lbs?|pounds?|fl\.?\s*oz)\b/i;
const NOISE_RE =
  /^(?:cubic inch|surface inch|quantity not specified|racc|nlea serving|guideline)\b|\byields?\b/i;
const ABBREVIATIONS: Record<string, string> = {
  pcs: "piece",
  pc: "piece",
  stk: "piece",
  tbsp: "tablespoon",
  tsp: "teaspoon",
};

function parseLeading(label: string): { count: number; rest: string } {
  const match = label.match(LEADING_QUANTITY_RE);
  if (!match) return { count: 1, rest: label };
  const count = match[1]
    ? Number(match[1]) / Number(match[2])
    : Number(match[3]?.replace(",", "."));
  if (!Number.isFinite(count) || count <= 0) return { count: 1, rest: label };
  return { count, rest: match[4] ?? "" };
}

function tidy(rest: string): string {
  // An unqualified fruit/piece needs its dimensions to distinguish sizes.
  const keepDimensions = /^(?:fruit|piece|pcs?|stk)\s*\(/i.test(rest);
  const withoutDimensions = (
    keepDimensions ? rest : rest.replace(/\s*\([^)]*\d[^)]*(?:\)|$)/g, "")
  )
    // "(15cm to 17.5cm long)", "(about 7" dia)": a size, not a name.
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;]+$/, "")
    .trim();
  const [head, ...tail] = withoutDimensions.split(" ");
  const expanded = head ? (ABBREVIATIONS[head.toLowerCase()] ?? head) : "";
  return [expanded, ...tail].join(" ").trim();
}

/**
 * Household measures worth offering when logging: one unit each, metric
 * entries dropped (grams are always offered), dimensions trimmed from the
 * name, duplicates collapsed to their first spelling.
 */
export function householdServings(
  portions: readonly PublishedPortion[],
  limit = MAX_HOUSEHOLD_SERVINGS,
): HouseholdServing[] {
  const seen = new Set<string>();
  const servings: HouseholdServing[] = [];
  for (const portion of portions) {
    if (!Number.isFinite(portion.grams) || portion.grams <= 0) continue;
    const { count, rest } = parseLeading(portion.label.trim());
    if (!rest || METRIC_RE.test(rest) || NOISE_RE.test(rest)) continue;
    const label = tidy(rest);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    servings.push({ label, grams: portion.grams / count });
    if (servings.length >= limit) break;
  }
  return servings;
}
