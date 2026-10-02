import type {
  MacrosVisionLabelFormat,
  MacrosVisionLabelResponse,
} from "@repo/schemas/macros";
import { z } from "zod";

// Macros' nutrition-label reader. A vision model transcribes the table; this
// module owns what it is asked, the shape it must answer in, and how that
// answer becomes Macros' label contract. The arithmetic stays here — the
// model copies numbers and units off the package and never converts them.

export const DEFAULT_NUTRITION_LABEL_MODEL = "google/gemini-3.8-flash";

const printedAmountSchema = z
  .object({
    value: z.number().describe("The number exactly as printed."),
    unit: z.enum(["kcal", "kj", "g", "mg", "mcg"]),
    lessThan: z
      .boolean()
      .describe('True when printed as a bound, e.g. "<0.5 g".'),
    unclear: z
      .boolean()
      .describe("True when a digit is blurred, cut off or glared out."),
  })
  .nullable();

export const nutritionLabelReadingSchema = z.object({
  isNutritionLabel: z.boolean(),
  column: z
    .enum(["per_100g", "per_100ml", "per_serving"])
    .nullable()
    .describe("Which column every amount below was read from."),
  servingSize: z
    .object({ quantity: z.number(), unit: z.enum(["g", "ml"]) })
    .nullable(),
  servingsPerContainer: z.number().nullable(),
  energyKcal: printedAmountSchema,
  energyKj: printedAmountSchema,
  fat: printedAmountSchema,
  saturatedFat: printedAmountSchema,
  transFat: printedAmountSchema,
  carbohydrate: printedAmountSchema,
  sugars: printedAmountSchema,
  addedSugars: printedAmountSchema,
  fibre: printedAmountSchema,
  protein: printedAmountSchema,
  salt: printedAmountSchema,
  sodium: printedAmountSchema,
  cholesterol: printedAmountSchema,
  potassium: printedAmountSchema,
  calcium: printedAmountSchema,
  iron: printedAmountSchema,
  vitaminD: printedAmountSchema,
});

export type NutritionLabelReading = z.infer<typeof nutritionLabelReadingSchema>;
type PrintedAmount = NonNullable<NutritionLabelReading["fat"]>;

export const NUTRITION_LABEL_SYSTEM = `You transcribe nutrition tables from photos of food packaging.

Copy what is printed. Never estimate, compute or convert a value, and never fill in a nutrient the table does not list — leave it null.

Column: when the table has a per 100 g or per 100 ml column, read every amount from that column. Otherwise read the per-serving column. Never mix columns. Ignore % daily value / % reference intake columns entirely.

Energy: report kcal and kJ separately, each only if printed.

Units: report each amount in the unit printed beside it. Comma decimals are decimals ("0,5 g" is 0.5).

Serving size: report it only when printed in g or ml. Servings per container only when printed.

Set isNutritionLabel to false and every amount to null when the photo contains no legible nutrition table. Ingredient lists and marketing text are not nutrition tables.`;

export function nutritionLabelPrompt(
  labelFormat: MacrosVisionLabelFormat | undefined,
): string {
  if (labelFormat === "us") {
    return "Read the nutrition table in this photo. It is probably a US Nutrition Facts panel.";
  }
  if (labelFormat === "eu") {
    return "Read the nutrition table in this photo. It is probably a European label with a per 100 g column.";
  }
  return "Read the nutrition table in this photo.";
}

type ResponseField = MacrosVisionLabelResponse["fields"][string];

const READ_CONFIDENCE = 0.95;
const UNCLEAR_CONFIDENCE = 0.5;
const BOUND_CONFIDENCE = 0.6;
const SUSPECT_FACTOR = 0.7;
const SODIUM_MG_PER_SALT_G = 400;
const MASS_IN_MG: Record<"g" | "mg" | "mcg", number> = {
  g: 1000,
  mg: 1,
  mcg: 0.001,
};

type AmountKey = Exclude<
  keyof NutritionLabelReading,
  | "isNutritionLabel"
  | "column"
  | "servingSize"
  | "servingsPerContainer"
  | "energyKcal"
  | "energyKj"
>;

const FIELD_SOURCES: ReadonlyArray<[AmountKey, string]> = [
  ["fat", "fat"],
  ["saturatedFat", "saturated"],
  ["transFat", "transFat"],
  ["carbohydrate", "carbs"],
  ["sugars", "sugar"],
  ["addedSugars", "addedSugar"],
  ["fibre", "fiber"],
  ["protein", "protein"],
  ["salt", "salt"],
  ["sodium", "sodium"],
  ["cholesterol", "cholesterol"],
  ["potassium", "potassium"],
  ["calcium", "calcium"],
  ["iron", "iron"],
  ["vitaminD", "d"],
];

function toField(amount: PrintedAmount): ResponseField | null {
  if (!Number.isFinite(amount.value) || amount.value < 0) return null;
  // A bound reads as half of it, as the OCR parser did: "<0.5 g" is closer to
  // 0.25 than to either end, and the lowered confidence asks for a look.
  const value = amount.lessThan ? amount.value / 2 : amount.value;
  const confidence = amount.unclear
    ? UNCLEAR_CONFIDENCE
    : amount.lessThan
      ? BOUND_CONFIDENCE
      : READ_CONFIDENCE;
  return { value, unit: amount.unit, confidence };
}

function grams(field: ResponseField | undefined): number | null {
  if (!field || field.value == null) return null;
  if (field.unit === "g" || field.unit === "mg" || field.unit === "mcg") {
    return (field.value * MASS_IN_MG[field.unit]) / 1000;
  }
  return null;
}

function kcal(field: ResponseField | undefined): number | null {
  if (!field || field.value == null) return null;
  if (field.unit === "kcal") return field.value;
  if (field.unit === "kj") return field.value / 4.184;
  return null;
}

function sanityWarnings(
  fields: Record<string, ResponseField>,
  basis: MacrosVisionLabelResponse["basis"],
): string[] {
  const warnings: string[] = [];
  const energy = kcal(fields.calories);
  const fat = grams(fields.fat);
  const carbs = grams(fields.carbs);
  const protein = grams(fields.protein);
  if (energy != null && fat != null && carbs != null && protein != null) {
    const fromMacros = fat * 9 + carbs * 4 + protein * 4;
    if (Math.abs(fromMacros - energy) > Math.max(50, energy * 0.3)) {
      warnings.push("Macro energy does not reconcile with stated calories");
    }
  }
  const saturated = grams(fields.saturated);
  if (fat != null && saturated != null && saturated > fat + 0.05) {
    warnings.push("Saturated fat exceeds total fat");
  }
  const sugar = grams(fields.sugar);
  if (carbs != null && sugar != null && sugar > carbs + 0.05) {
    warnings.push("Sugars exceed total carbohydrate");
  }
  if (basis === "per_100g" || basis === "per_100ml") {
    const total = (fat ?? 0) + (carbs ?? 0) + (protein ?? 0);
    if (total > 105)
      warnings.push("Parsed nutrients exceed 100 g per 100 g/ml");
  }
  if (basis === "unknown") {
    warnings.push(
      "Could not determine whether values are per 100 g or per serving",
    );
  }
  return warnings;
}

const EMPTY_RESPONSE: MacrosVisionLabelResponse = {
  version: "v1",
  basis: "unknown",
  servingQuantity: null,
  servingUnit: null,
  servingsPerContainer: null,
  fields: {},
  rawText: "",
  warnings: ["No nutrition table found in the photo"],
};

/** Maps what the model read onto Macros' label contract, with sanity checks. */
export function toLabelResponse(
  reading: NutritionLabelReading,
): MacrosVisionLabelResponse {
  if (!reading.isNutritionLabel) return EMPTY_RESPONSE;

  const fields: Record<string, ResponseField> = {};
  const energy = reading.energyKcal ?? reading.energyKj;
  const calories = energy ? toField(energy) : null;
  if (calories) fields.calories = calories;
  for (const [source, key] of FIELD_SOURCES) {
    const amount = reading[source];
    if (!amount) continue;
    const field = toField(amount);
    if (field) fields[key] = field;
  }

  const salt = grams(fields.salt);
  if (!fields.sodium && salt != null && fields.salt) {
    fields.sodium = {
      value: Math.round(salt * SODIUM_MG_PER_SALT_G * 1000) / 1000,
      unit: "mg",
      confidence: fields.salt.confidence,
    };
  }

  const basis = reading.column ?? "unknown";
  const warnings = sanityWarnings(fields, basis);
  const suspect = warnings.length > 0;
  const servingQuantity =
    reading.servingSize && reading.servingSize.quantity > 0
      ? reading.servingSize.quantity
      : null;

  return {
    version: "v1",
    basis,
    servingQuantity,
    servingUnit:
      servingQuantity != null ? (reading.servingSize?.unit ?? null) : null,
    servingsPerContainer:
      reading.servingsPerContainer != null && reading.servingsPerContainer > 0
        ? reading.servingsPerContainer
        : null,
    fields: suspect
      ? Object.fromEntries(
          Object.entries(fields).map(([key, field]) => [
            key,
            {
              ...field,
              confidence:
                Math.round(field.confidence * SUSPECT_FACTOR * 1000) / 1000,
            },
          ]),
        )
      : fields,
    rawText: "",
    warnings,
  };
}
