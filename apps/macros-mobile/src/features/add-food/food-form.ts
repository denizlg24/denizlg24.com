import { formatFoodQuantity } from "@repo/macros-core/foods/display";
import {
  isNutrientKey,
  type NutrientKey,
  nutrientDefinitionsInput,
} from "@repo/macros-core/foods/nutrients";
import {
  fromCanonical,
  toCanonical,
} from "@repo/macros-core/foods/unit-conversions";
import { NUTRIENT_SECTIONS } from "@repo/macros-core/foods/who-guidelines";
import {
  type MacrosFoodDetailResponse,
  type MacrosVisionLabelFormat,
  type MacrosVisionLabelResponse,
  macrosCreateFoodServingSizeSchema,
} from "@repo/schemas/macros";
import { z } from "zod";
import type { CreateFoodInput } from "@/api/foods";
import { parseDecimal } from "@/ui/field";
import { nutrientLabel, nutrientUnit } from "./nutrition";

export const DEFAULT_ICON_KEY = "other-001";

/** Values are typed either per 100 g or per the first serving. */
export type NutrientBasis = "100g" | "serving";
export type EnergyEntryUnit = "kcal" | "kj";
export type SodiumEntryUnit = "mg" | "salt-g";

export interface ServingDraft {
  uid: string;
  label: string;
  grams: string;
}

export interface FoodFormState {
  name: string;
  brand: string;
  barcode: string;
  iconKey: string;
  servings: ServingDraft[];
  basis: NutrientBasis;
  energyUnit: EnergyEntryUnit;
  sodiumUnit: SodiumEntryUnit;
  /** What the fields show, in the current basis and units. */
  values: Partial<Record<NutrientKey, string>>;
  /** Parser confidence per field when the values came from a label photo. */
  confidence: Partial<Record<NutrientKey, number>>;
}

const KJ_PER_KCAL = 4.184;
const REFERENCE_LABEL = "100g";

/** The label's own order: energy, fat and saturates, carbohydrate and sugars, fibre, protein, salt. */
export const CORE_NUTRIENTS: readonly {
  key: NutrientKey;
  label: string;
  nested?: boolean;
}[] = [
  { key: "calories", label: "Energy" },
  { key: "fat", label: "Fat" },
  { key: "saturated", label: "of which saturates", nested: true },
  { key: "carbs", label: "Carbohydrate" },
  { key: "sugar", label: "of which sugars", nested: true },
  { key: "fiber", label: "Fibre" },
  { key: "protein", label: "Protein" },
  { key: "sodium", label: "Salt" },
];

const coreKeys = new Set(CORE_NUTRIENTS.map((nutrient) => nutrient.key));

export interface NutrientGroup {
  title: string;
  keys: NutrientKey[];
}

/** Everything past the core, in the sections the food detail uses. */
export const MORE_NUTRIENT_GROUPS: NutrientGroup[] = (() => {
  const sectionTitles: Record<string, string> = {
    "Carb Breakdown": "Carbohydrate",
    "Fat Breakdown": "Fat",
    Vitamins: "Vitamins",
    Minerals: "Minerals",
    "Protein & Amino Acids": "Amino acids",
    Other: "Other",
  };
  const covered = new Set<NutrientKey>(coreKeys);
  const groups: NutrientGroup[] = [];
  for (const section of NUTRIENT_SECTIONS) {
    const keys = section.keys.filter((key) => !covered.has(key));
    for (const key of keys) covered.add(key);
    if (keys.length > 0) {
      groups.push({
        title: sectionTitles[section.title] ?? section.title,
        keys,
      });
    }
  }
  const rest = nutrientDefinitionsInput
    .map((definition) => definition.key)
    .filter((key) => !covered.has(key));
  if (rest.length > 0) groups.push({ title: "Additional", keys: rest });
  return groups;
})();

let draftCounter = 0;
export function newServingDraft(label = "1 serving", grams = ""): ServingDraft {
  draftCounter += 1;
  return { uid: `serving-${Date.now()}-${draftCounter}`, label, grams };
}

export function emptyFoodForm(options: {
  barcode?: string;
  energyUnit: EnergyEntryUnit;
  labelFormat: MacrosVisionLabelFormat;
}): FoodFormState {
  return {
    name: "",
    brand: "",
    barcode: options.barcode ?? "",
    iconKey: DEFAULT_ICON_KEY,
    servings: [newServingDraft()],
    basis: options.labelFormat === "us" ? "serving" : "100g",
    energyUnit: options.energyUnit,
    sodiumUnit: options.labelFormat === "us" ? "mg" : "salt-g",
    values: {},
    confidence: {},
  };
}

function servingGrams(serving: ServingDraft | undefined): number | null {
  if (!serving || serving.label.trim().length === 0) return null;
  const grams = parseDecimal(serving.grams);
  return grams != null && grams > 0 ? grams : null;
}

export function validServings(state: FoodFormState): ServingDraft[] {
  return state.servings.filter((serving) => servingGrams(serving) != null);
}

/** Grams the "per serving" basis refers to: the first complete serving. */
export function basisServing(state: FoodFormState): ServingDraft | null {
  return validServings(state)[0] ?? null;
}

function basisScale(state: FoodFormState): number | null {
  if (state.basis === "100g") return 1;
  const grams = servingGrams(basisServing(state) ?? undefined);
  return grams == null ? null : grams / 100;
}

export function fieldUnit(key: NutrientKey, state: FoodFormState): string {
  if (key === "calories") return state.energyUnit === "kj" ? "kJ" : "kcal";
  if (key === "sodium") return state.sodiumUnit === "salt-g" ? "g" : "mg";
  return nutrientUnit(key);
}

export function fieldLabel(key: NutrientKey, state: FoodFormState): string {
  if (key === "sodium")
    return state.sodiumUnit === "salt-g" ? "Salt" : "Sodium";
  return (
    CORE_NUTRIENTS.find((nutrient) => nutrient.key === key)?.label ??
    nutrientLabel(key)
  );
}

function toPer100(
  key: NutrientKey,
  shown: number,
  state: Pick<FoodFormState, "energyUnit" | "sodiumUnit">,
  scale: number,
): number {
  let canonical = shown;
  if (key === "calories" && state.energyUnit === "kj") {
    canonical = shown / KJ_PER_KCAL;
  }
  if (key === "sodium")
    canonical = toCanonical("sodium", state.sodiumUnit, shown);
  return canonical / scale;
}

function fromPer100(
  key: NutrientKey,
  per100: number,
  state: Pick<FoodFormState, "energyUnit" | "sodiumUnit">,
  scale: number,
): number {
  let shown = per100 * scale;
  if (key === "calories" && state.energyUnit === "kj") shown *= KJ_PER_KCAL;
  if (key === "sodium")
    shown = fromCanonical("sodium", state.sodiumUnit, shown);
  return shown;
}

export function formatFieldValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value !== 0 && Math.abs(value) < 0.01) return value.toPrecision(2);
  return formatFoodQuantity(value, 2);
}

/** Canonical per-100 g amounts for every filled field. */
export function per100Values(
  state: FoodFormState,
): Partial<Record<NutrientKey, number>> | null {
  const scale = basisScale(state);
  if (scale == null) return null;
  const result: Partial<Record<NutrientKey, number>> = {};
  for (const [key, text] of Object.entries(state.values)) {
    if (!isNutrientKey(key) || text == null) continue;
    const shown = parseDecimal(text);
    if (shown == null || shown < 0) continue;
    result[key] = toPer100(key, shown, state, scale);
  }
  return result;
}

/**
 * Switching basis or unit rewrites the shown numbers so the food itself does
 * not change: 250 kcal per 100 g becomes 75 kcal per 30 g serving.
 */
export function withDisplay(
  state: FoodFormState,
  next: Partial<Pick<FoodFormState, "basis" | "energyUnit" | "sodiumUnit">>,
): FoodFormState {
  const canonical = per100Values(state);
  const target: FoodFormState = { ...state, ...next };
  const scale = basisScale(target);
  if (canonical == null || scale == null) return target;
  const values: Partial<Record<NutrientKey, string>> = { ...state.values };
  for (const [key, per100] of Object.entries(canonical)) {
    if (!isNutrientKey(key) || per100 == null) continue;
    values[key] = formatFieldValue(fromPer100(key, per100, target, scale));
  }
  return { ...target, values };
}

export type FoodPayloadResult =
  | {
      ok: true;
      payload: Omit<CreateFoodInput, "barcode" | "clientMutationId">;
      barcode: string | undefined;
    }
  | { ok: false; message: string };

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function toFoodPayload(state: FoodFormState): FoodPayloadResult {
  const name = state.name.trim();
  if (!name) return { ok: false, message: "Give the food a name." };

  const incomplete = state.servings.some(
    (serving) =>
      (serving.label.trim() !== "" || serving.grams.trim() !== "") &&
      servingGrams(serving) == null,
  );
  if (incomplete) {
    return {
      ok: false,
      message: "Each serving needs a name and a weight in grams.",
    };
  }
  if (state.basis === "serving" && basisServing(state) == null) {
    return {
      ok: false,
      message: "Add a serving weight, or enter the values per 100 g.",
    };
  }

  const values = per100Values(state);
  if (values == null || values.calories == null) {
    return { ok: false, message: "Enter the energy value — 0 is fine." };
  }

  const nutrients: Record<string, number> = {};
  for (const [key, amount] of Object.entries(values)) {
    if (amount != null && Number.isFinite(amount))
      nutrients[key] = round(amount);
  }

  // Nutrients go to the server per 100 g; the 100 g reference comes first and
  // the server takes the first real serving as the food's primary one.
  const servingSizes = [
    { label: REFERENCE_LABEL, quantity: 100, unit: "g" },
    ...validServings(state).map((serving) => ({
      label: serving.label.trim(),
      quantity: round(servingGrams(serving) ?? 0),
      unit: "g",
    })),
  ].slice(0, 12);

  const barcode = state.barcode.trim();
  return {
    ok: true,
    payload: {
      name,
      brand: state.brand.trim() || undefined,
      iconKey: state.iconKey,
      servingSizes,
      nutrients,
    },
    barcode: barcode || undefined,
  };
}

const MASS_IN_MCG: Record<"g" | "mg" | "mcg", number> = {
  g: 1_000_000,
  mg: 1_000,
  mcg: 1,
};

function isMass(unit: string): unit is "g" | "mg" | "mcg" {
  return unit === "g" || unit === "mg" || unit === "mcg";
}

function canonicalAmount(
  key: NutrientKey,
  value: number,
  unit: MacrosVisionLabelResponse["fields"][string]["unit"],
): number | null {
  const target = nutrientUnit(key);
  if (target === "kcal") {
    if (unit === "kcal") return value;
    if (unit === "kj") return value / KJ_PER_KCAL;
    return null;
  }
  if (isMass(unit) && isMass(target)) {
    return (value * MASS_IN_MCG[unit]) / MASS_IN_MCG[target];
  }
  return null;
}

export interface LabelPrefill {
  state: FoodFormState;
  read: number;
  basisUncertain: boolean;
  warnings: string[];
}

/**
 * A parsed label becomes a proposal in the form, never a log. Per-serving
 * labels keep their serving as the basis so the numbers match the package;
 * a label whose basis could not be read defaults to per 100 g and says so.
 */
export function prefillFromLabel(
  base: FoodFormState,
  label: MacrosVisionLabelResponse,
): LabelPrefill {
  const servingUnit = label.servingUnit?.toLowerCase() ?? "";
  const hasGramServing =
    label.servingQuantity != null &&
    (servingUnit === "g" || servingUnit === "ml");
  const perServing =
    hasGramServing &&
    (label.basis === "per_serving" ||
      (label.basis === "unknown" && base.sodiumUnit === "mg"));

  const values: Partial<Record<NutrientKey, string>> = {};
  const confidence: Partial<Record<NutrientKey, number>> = {};
  const canonical: Partial<Record<NutrientKey, number>> = {};
  for (const [key, field] of Object.entries(label.fields)) {
    if (!isNutrientKey(key) || field.value == null) continue;
    const amount = canonicalAmount(key, field.value, field.unit);
    if (amount == null || amount < 0) continue;
    canonical[key] = amount;
    confidence[key] = field.confidence;
  }

  const state: FoodFormState = {
    ...base,
    energyUnit: "kcal",
    basis: perServing ? "serving" : "100g",
    servings:
      perServing && label.servingQuantity != null
        ? [
            newServingDraft(
              "1 serving",
              formatFoodQuantity(label.servingQuantity),
            ),
          ]
        : base.servings,
    confidence,
  };
  for (const [key, amount] of Object.entries(canonical)) {
    if (!isNutrientKey(key) || amount == null) continue;
    // The label's own numbers, in the label's own basis — only units change.
    values[key] = formatFieldValue(fromPer100(key, amount, state, 1));
  }

  return {
    state: { ...state, values },
    read: Object.keys(values).length,
    basisUncertain: label.basis === "unknown",
    warnings: label.warnings,
  };
}

const declaredServingsSchema = z.array(macrosCreateFoodServingSizeSchema);

function isReference(serving: {
  label: string;
  quantity: number;
  unit: string;
}) {
  return (
    serving.label.trim().toLowerCase().replace(/\s+/g, "") ===
      REFERENCE_LABEL &&
    serving.unit.trim().toLowerCase() === "g" &&
    Math.abs(serving.quantity - 100) < 1e-4
  );
}

/** The stored food, expressed back in the form's per-100 g terms. */
export function formFromDetail(
  detail: MacrosFoodDetailResponse,
  options: { energyUnit: EnergyEntryUnit },
): FoodFormState {
  const { item, nutrition } = detail;
  const declared = declaredServingsSchema.safeParse(
    "servingSizes" in nutrition ? nutrition.servingSizes : undefined,
  );
  const stored = declared.success
    ? declared.data
    : [
        {
          label: nutrition.servingLabel,
          quantity: nutrition.servingQuantity,
          unit: nutrition.servingUnit,
        },
      ];
  const servings = stored
    .filter((serving) => !isReference(serving))
    .filter((serving) => serving.unit.trim().toLowerCase() === "g")
    .map((serving) =>
      newServingDraft(serving.label, formatFoodQuantity(serving.quantity)),
    );

  // The snapshot holds nutrients per the primary serving; the server only
  // rescales a gram serving, so only a gram serving is rescaled back.
  const primaryIsGrams = nutrition.servingUnit.trim().toLowerCase() === "g";
  const toPer100Factor =
    primaryIsGrams && nutrition.servingQuantity > 0
      ? 100 / nutrition.servingQuantity
      : 1;

  const state: FoodFormState = {
    name: item.name,
    brand: item.brand ?? "",
    barcode: item.barcode ?? "",
    iconKey: item.iconKey,
    servings: servings.length > 0 ? servings : [newServingDraft()],
    basis: "100g",
    energyUnit: options.energyUnit,
    sodiumUnit: "mg",
    values: {},
    confidence: {},
  };
  const values: Partial<Record<NutrientKey, string>> = {};
  for (const [key, amount] of Object.entries(nutrition.nutrients)) {
    if (!isNutrientKey(key)) continue;
    values[key] = formatFieldValue(
      fromPer100(key, amount * toPer100Factor, state, 1),
    );
  }
  return { ...state, values };
}

export function filledCount(
  state: FoodFormState,
  keys: readonly NutrientKey[],
): number {
  return keys.filter((key) => (state.values[key] ?? "").trim() !== "").length;
}
