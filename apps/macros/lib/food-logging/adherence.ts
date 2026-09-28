import type { MacrosAdherenceRule, MacrosGoalType } from "@repo/schemas/macros";

export const ON_TARGET_TOLERANCE = 0.1;

export function adherenceRule(
  goalType: MacrosGoalType | null,
): MacrosAdherenceRule {
  if (goalType === "lose") return "at-most";
  if (goalType === "gain") return "at-least";
  return "within";
}

export function isOnTarget(
  calories: number,
  target: number,
  rule: MacrosAdherenceRule,
): boolean {
  const deviation = (calories - target) / target;
  if (rule === "at-most") return deviation <= ON_TARGET_TOLERANCE;
  if (rule === "at-least") return deviation >= -ON_TARGET_TOLERANCE;
  return Math.abs(deviation) <= ON_TARGET_TOLERANCE;
}

/**
 * Only fully logged days are judged. A day with breakfast logged and nothing
 * else says nothing about the plan, so it is neither a hit nor a miss.
 */
export function summarizeAdherence(
  dayCalories: readonly number[],
  target: number,
  fullDayThreshold: number,
  rule: MacrosAdherenceRule,
): { daysTracked: number; daysOnTarget: number } {
  const full = dayCalories.filter((calories) => calories >= fullDayThreshold);
  return {
    daysTracked: full.length,
    daysOnTarget: full.filter((calories) => isOnTarget(calories, target, rule))
      .length,
  };
}
