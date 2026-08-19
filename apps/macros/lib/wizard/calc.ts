export type Sex = "female" | "male" | "other" | "prefer_not_to_say"
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active"
export type GoalType = "lose" | "maintain" | "gain"
export type ProteinProfile =
  | "balanced"
  | "high_protein"
  | "low_fat"
  | "low_carb"
  | "keto"
export type WeightUnit = "kg" | "lb"
export type EnergyUnit = "kcal" | "kj"

export interface ProteinProfileDef {
  value: ProteinProfile
  label: string
  description: string
  proteinPerKg: number
  fatPct: number
}

export const PROTEIN_PROFILES: ProteinProfileDef[] = [
  {
    value: "balanced",
    label: "Balanced",
    description: "Standard split for general fitness",
    proteinPerKg: 1.8,
    fatPct: 0.25,
  },
  {
    value: "high_protein",
    label: "High Protein",
    description: "2.2g/kg — optimal for muscle building",
    proteinPerKg: 2.2,
    fatPct: 0.25,
  },
  {
    value: "low_fat",
    label: "Low Fat",
    description: "Higher carbs, leaner approach",
    proteinPerKg: 2.0,
    fatPct: 0.2,
  },
  {
    value: "low_carb",
    label: "Low Carb",
    description: "More fat, fewer carbs",
    proteinPerKg: 2.0,
    fatPct: 0.4,
  },
  {
    value: "keto",
    label: "Keto",
    description: "Very low carb, high fat",
    proteinPerKg: 1.6,
    fatPct: 0.7,
  },
]

export const ACTIVITY_LEVELS: {
  value: ActivityLevel
  label: string
  description: string
}[] = [
  {
    value: "sedentary",
    label: "Sedentary",
    description: "Little or no exercise",
  },
  { value: "light", label: "Light", description: "1–3 training days a week" },
  {
    value: "moderate",
    label: "Moderate",
    description: "3–5 training days a week",
  },
  {
    value: "active",
    label: "Active",
    description: "6–7 days, lifting + cardio",
  },
  {
    value: "very_active",
    label: "Very active",
    description: "Twice-daily training, lifting + cardio",
  },
]

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export const WEEKDAY_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const

export type MacroSplit = { protein: number; carbs: number; fat: number }

export function adjustSplit(
  which: keyof MacroSplit,
  newPct: number,
  cur: MacroSplit
): MacroSplit {
  const clamped = Math.max(10, Math.min(75, newPct))
  const remaining = 100 - clamped
  const otherKeys = (
    ["protein", "carbs", "fat"] as (keyof MacroSplit)[]
  ).filter((k) => k !== which)
  const otherSum = otherKeys.reduce((s, k) => s + cur[k], 0)
  const result = { ...cur, [which]: clamped }
  if (otherSum === 0) {
    const half = Math.round(remaining / 2)
    result[otherKeys[0]] = half
    result[otherKeys[1]] = remaining - half
  } else {
    result[otherKeys[0]] = Math.max(
      5,
      Math.round((cur[otherKeys[0]] / otherSum) * remaining)
    )
    result[otherKeys[1]] = Math.max(5, remaining - result[otherKeys[0]])
  }
  const sum = result.protein + result.carbs + result.fat
  if (sum !== 100) {
    const biggest = otherKeys.reduce((a, b) => (result[a] >= result[b] ? a : b))
    result[biggest] += 100 - sum
  }
  return result
}

export function computeAgeFromBirthDate(birthDate: string): number | undefined {
  if (!birthDate) return undefined
  const parts = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!parts) return undefined
  const year = parseInt(parts[1], 10)
  const month = parseInt(parts[2], 10)
  const day = parseInt(parts[3], 10)
  const birth = new Date(year, month - 1, day)
  if (isNaN(birth.getTime())) return undefined
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

export function calculateMacros(params: {
  weightKg: number
  heightCm?: number
  ageYears?: number
  sex?: Sex
  activityLevel?: ActivityLevel
  goalType: GoalType
  weeklyRateKg?: number
  proteinProfile?: ProteinProfile
}): { calories: number; protein: number; carbs: number; fat: number } {
  const {
    weightKg,
    heightCm = 170,
    ageYears = 28,
    sex,
    activityLevel,
    goalType,
    weeklyRateKg,
    proteinProfile,
  } = params

  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears
  const bmr =
    sex === "male" ? base + 5 : sex === "female" ? base - 161 : base - 78
  const tdee = bmr * (activityLevel ? ACTIVITY_MULTIPLIERS[activityLevel] : 1.4)

  let calories: number
  if (goalType === "lose") {
    const dailyDeficit = weeklyRateKg ? (weeklyRateKg * 7700) / 7 : 500
    calories = Math.round(tdee - dailyDeficit)
  } else if (goalType === "gain") {
    calories = Math.round(tdee + 300)
  } else {
    calories = Math.round(tdee)
  }
  calories = Math.max(calories, 1200)

  const profile = proteinProfile
    ? (PROTEIN_PROFILES.find((p) => p.value === proteinProfile) ??
      PROTEIN_PROFILES[0])
    : PROTEIN_PROFILES[0]

  const protein = Math.round(weightKg * profile.proteinPerKg)
  const desiredFat = Math.round((calories * profile.fatPct) / 9)
  const maxFatBasedOnProtein = Math.floor((calories - protein * 4) / 9)
  const fat = Math.max(Math.min(desiredFat, maxFatBasedOnProtein), 30)
  const carbs = Math.max(Math.round((calories - protein * 4 - fat * 9) / 4), 0)

  return { calories, protein, carbs, fat }
}

export function lbToKg(lb: number): number {
  return Math.round((lb / 2.20462) * 100) / 100
}

export function kgToLb(kg: number): number {
  return Math.round(kg * 2.20462 * 10) / 10
}

export interface WeekdayDelta {
  weekday: number
  delta: number
}

export interface DayMacros {
  weekday: number
  calorieTarget: number
  proteinTarget: number
  carbsTarget: number
  fatTarget: number
}

export function buildWeekdayMacros(
  baseDaily: { calories: number; protein: number; carbs: number; fat: number },
  deltas: WeekdayDelta[]
): DayMacros[] {
  const out: DayMacros[] = []
  for (let w = 0; w < 7; w++) {
    const delta = deltas.find((d) => d.weekday === w)?.delta ?? 0
    const cals = Math.max(1000, baseDaily.calories + delta)
    const scale = cals / baseDaily.calories
    out.push({
      weekday: w,
      calorieTarget: Math.round(cals),
      proteinTarget: Math.round(baseDaily.protein * scale),
      carbsTarget: Math.round(baseDaily.carbs * scale),
      fatTarget: Math.round(baseDaily.fat * scale),
    })
  }
  return out
}
