import type { NutrientKey } from "@/lib/foods/nutrients"

export type ToggleableNutrientKey = "sodium" | "a" | "d" | "e"

export type UnitPref = {
  sodium: "mg" | "salt-g"
  a: "mcg" | "iu"
  d: "mcg" | "iu"
  e: "mg" | "iu"
}

export const DEFAULT_UNIT_PREF: UnitPref = {
  sodium: "mg",
  a: "mcg",
  d: "mcg",
  e: "mg",
}

export const UNIT_OPTIONS: Record<
  ToggleableNutrientKey,
  { value: UnitPref[ToggleableNutrientKey]; label: string }[]
> = {
  sodium: [
    { value: "mg", label: "mg sodium" },
    { value: "salt-g", label: "g salt" },
  ],
  a: [
    { value: "mcg", label: "mcg" },
    { value: "iu", label: "IU" },
  ],
  d: [
    { value: "mcg", label: "mcg" },
    { value: "iu", label: "IU" },
  ],
  e: [
    { value: "mg", label: "mg" },
    { value: "iu", label: "IU" },
  ],
}

const SALT_TO_SODIUM_MG_PER_G = 400
const VIT_A_IU_PER_MCG = 3.33
const VIT_D_IU_PER_MCG = 40
const VIT_E_IU_PER_MG = 1.49

export function toCanonical(
  key: ToggleableNutrientKey,
  unit: UnitPref[ToggleableNutrientKey],
  displayValue: number
): number {
  if (key === "sodium" && unit === "salt-g") {
    return displayValue * SALT_TO_SODIUM_MG_PER_G
  }
  if (key === "a" && unit === "iu") {
    return displayValue / VIT_A_IU_PER_MCG
  }
  if (key === "d" && unit === "iu") {
    return displayValue / VIT_D_IU_PER_MCG
  }
  if (key === "e" && unit === "iu") {
    return displayValue / VIT_E_IU_PER_MG
  }
  return displayValue
}

export function fromCanonical(
  key: ToggleableNutrientKey,
  unit: UnitPref[ToggleableNutrientKey],
  canonicalValue: number
): number {
  if (key === "sodium" && unit === "salt-g") {
    return canonicalValue / SALT_TO_SODIUM_MG_PER_G
  }
  if (key === "a" && unit === "iu") {
    return canonicalValue * VIT_A_IU_PER_MCG
  }
  if (key === "d" && unit === "iu") {
    return canonicalValue * VIT_D_IU_PER_MCG
  }
  if (key === "e" && unit === "iu") {
    return canonicalValue * VIT_E_IU_PER_MG
  }
  return canonicalValue
}

export function isToggleableNutrient(
  key: NutrientKey
): key is ToggleableNutrientKey {
  return key === "sodium" || key === "a" || key === "d" || key === "e"
}

export function getDisplayLabel(
  key: ToggleableNutrientKey,
  unit: UnitPref[ToggleableNutrientKey]
): string {
  if (key === "sodium") {
    return unit === "salt-g" ? "Salt" : "Sodium"
  }
  if (key === "a") return "Vitamin A"
  if (key === "d") return "Vitamin D"
  return "Vitamin E"
}

export function getDisplayUnit(
  key: ToggleableNutrientKey,
  unit: UnitPref[ToggleableNutrientKey]
): string {
  if (key === "sodium") return unit === "salt-g" ? "g" : "mg"
  return unit === "iu" ? "IU" : key === "e" ? "mg" : "mcg"
}
