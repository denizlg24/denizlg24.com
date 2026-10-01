import type { MacrosSex } from "@repo/schemas/macros";
import type { NutrientKey } from "./nutrients";

/**
 * Daily reference intakes, after the US/Canadian Dietary Reference Intakes
 * (RDA where one exists, otherwise AI), chosen by sex and life-stage band the
 * way MacroFactor does. Only protein and the essential amino acids scale with
 * body weight (WHO/FAO/UNU 2007, per kg); every vitamin and mineral is a
 * per-person figure, so scaling it by weight overstated a heavy user's
 * targets and understated a light one's.
 *
 * A `target` is a floor to reach; a `limit` is a ceiling to stay under
 * (sodium, saturated fat, added sugar, …), where 100% is the most, not the
 * goal.
 */
export type NutrientReferenceKind = "target" | "limit";

export interface NutrientReference {
  value: number;
  kind: NutrientReferenceKind;
}

export interface NutrientReferenceInput {
  sex?: MacrosSex | null;
  ageYears?: number | null;
  weightKg?: number | null;
  /** The day's calorie target; energy-share limits and fiber follow it. */
  calories?: number | null;
}

export type NutrientReferences = Partial<
  Record<NutrientKey, NutrientReference>
>;

const REFERENCE_WEIGHT_KG = 70;
const REFERENCE_CALORIES = 2000;
const DEFAULT_AGE = 35;

/** Essential amino acid requirements, mg per kg body weight per day. */
const AMINO_ACIDS_MG_PER_KG: Partial<Record<NutrientKey, number>> = {
  histidine: 10,
  isoleucine: 20,
  leucine: 39,
  lysine: 30,
  methionine: 10.4,
  cysteine: 4.1,
  phenylalanine: 12.5,
  tyrosine: 12.5,
  threonine: 15,
  tryptophan: 4,
  valine: 26,
};

type Band = "19-30" | "31-50" | "51-70" | "71+";
type BySex = { male: number; female: number };
type ByBand = Record<Band, BySex>;

function same(value: number): BySex {
  return { male: value, female: value };
}

function bands(
  young: BySex,
  overrides: Partial<Record<Band, BySex>> = {},
): ByBand {
  return {
    "19-30": overrides["19-30"] ?? young,
    "31-50": overrides["31-50"] ?? young,
    "51-70": overrides["51-70"] ?? overrides["31-50"] ?? young,
    "71+":
      overrides["71+"] ?? overrides["51-70"] ?? overrides["31-50"] ?? young,
  };
}

const DRI: Partial<Record<NutrientKey, ByBand>> = {
  a: bands({ male: 900, female: 700 }),
  b1: bands({ male: 1.2, female: 1.1 }),
  b2: bands({ male: 1.3, female: 1.1 }),
  b3: bands({ male: 16, female: 14 }),
  b5: bands(same(5)),
  b6: bands(same(1.3), { "51-70": { male: 1.7, female: 1.5 } }),
  b12: bands(same(2.4)),
  c: bands({ male: 90, female: 75 }),
  d: bands(same(15), { "71+": same(20) }),
  e: bands(same(15)),
  k: bands({ male: 120, female: 90 }),
  folate: bands(same(400)),
  choline: bands({ male: 550, female: 425 }),

  calcium: bands(same(1000), {
    "51-70": { male: 1000, female: 1200 },
    "71+": same(1200),
  }),
  copper: bands(same(0.9)),
  iron: bands({ male: 8, female: 18 }, { "51-70": same(8) }),
  magnesium: bands(
    { male: 400, female: 310 },
    { "31-50": { male: 420, female: 320 } },
  ),
  manganese: bands({ male: 2.3, female: 1.8 }),
  phosphorus: bands(same(700)),
  potassium: bands({ male: 3400, female: 2600 }),
  selenium: bands(same(55)),
  zinc: bands({ male: 11, female: 8 }),

  omega3: bands({ male: 1.6, female: 1.1 }),
  omega3Ala: bands({ male: 1.6, female: 1.1 }),
  omega6: bands(
    { male: 17, female: 12 },
    { "51-70": { male: 14, female: 11 } },
  ),
  water: bands({ male: 3700, female: 2700 }),
};

/** Fiber AI when no calorie target is known; otherwise 14 g per 1000 kcal. */
const FIBER_FALLBACK = bands(
  { male: 38, female: 25 },
  { "51-70": { male: 30, female: 21 } },
);

/** Tolerable upper intake levels that apply to food, not only supplements. */
const UPPER_LIMITS: Partial<Record<NutrientKey, ByBand>> = {
  a: bands(same(3000)),
  b6: bands(same(100)),
  c: bands(same(2000)),
  d: bands(same(100)),
  calcium: bands(same(2500), { "51-70": same(2000) }),
  copper: bands(same(10)),
  iron: bands(same(45)),
  manganese: bands(same(11)),
  phosphorus: bands(same(4000), { "71+": same(3000) }),
  selenium: bands(same(400)),
  zinc: bands(same(40)),
  choline: bands(same(3500)),
};

function bandFor(ageYears: number | null | undefined): Band {
  const age =
    ageYears != null && Number.isFinite(ageYears) ? ageYears : DEFAULT_AGE;
  if (age <= 30) return "19-30";
  if (age <= 50) return "31-50";
  if (age <= 70) return "51-70";
  return "71+";
}

/** Without a stated sex the higher of the two applies, so nothing is missed. */
function pick(values: BySex, sex: MacrosSex | null | undefined) {
  if (sex === "male") return values.male;
  if (sex === "female") return values.female;
  return Math.max(values.male, values.female);
}

function positive(value: number | null | undefined, fallback: number) {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function nutrientReferences(
  input: NutrientReferenceInput = {},
): NutrientReferences {
  const band = bandFor(input.ageYears);
  const weightKg = positive(input.weightKg, REFERENCE_WEIGHT_KG);
  const hasCalories = input.calories != null && input.calories > 0;
  const calories = positive(input.calories, REFERENCE_CALORIES);
  const references: NutrientReferences = {};

  for (const [key, table] of Object.entries(DRI) as [NutrientKey, ByBand][]) {
    references[key] = { value: pick(table[band], input.sex), kind: "target" };
  }
  for (const [key, mgPerKg] of Object.entries(AMINO_ACIDS_MG_PER_KG) as [
    NutrientKey,
    number,
  ][]) {
    references[key] = { value: (mgPerKg * weightKg) / 1000, kind: "target" };
  }

  references.protein = { value: 0.8 * weightKg, kind: "target" };
  references.carbs = { value: 130, kind: "target" };
  references.fiber = {
    value: hasCalories
      ? (14 * calories) / 1000
      : pick(FIBER_FALLBACK[band], input.sex),
    kind: "target",
  };

  references.addedSugar = { value: (0.1 * calories) / 4, kind: "limit" };
  references.saturated = { value: (0.1 * calories) / 9, kind: "limit" };
  references.transFat = { value: (0.01 * calories) / 9, kind: "limit" };
  references.sodium = { value: 2300, kind: "limit" };
  references.cholesterol = { value: 300, kind: "limit" };
  references.caffeine = { value: 400, kind: "limit" };

  return references;
}

export function nutrientUpperLimits(
  ageYears?: number | null,
): Partial<Record<NutrientKey, number>> {
  const band = bandFor(ageYears);
  const limits: Partial<Record<NutrientKey, number>> = {};
  for (const [key, table] of Object.entries(UPPER_LIMITS) as [
    NutrientKey,
    ByBand,
  ][]) {
    limits[key] = table[band].male;
  }
  return limits;
}

/** Whole years between an ISO birth date and an ISO day. */
export function ageOn(birthDate: string, day: string): number | null {
  if (
    !/^\d{4}-\d{2}-\d{2}/.test(birthDate) ||
    !/^\d{4}-\d{2}-\d{2}/.test(day)
  ) {
    return null;
  }
  const years = Number(day.slice(0, 4)) - Number(birthDate.slice(0, 4));
  const age = day.slice(5, 10) < birthDate.slice(5, 10) ? years - 1 : years;
  return age >= 0 ? age : null;
}
