type Macros = { protein: number; carbs: number; fat: number };

/** Share of energy, not of grams: a gram of fat carries 9 kcal to the others' 4. */
export function macroEnergyShares({ protein, carbs, fat }: Macros): Macros {
  const energy = {
    protein: Math.max(0, protein) * 4,
    carbs: Math.max(0, carbs) * 4,
    fat: Math.max(0, fat) * 9,
  };
  const total = energy.protein + energy.carbs + energy.fat;
  if (!total) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: energy.protein / total,
    carbs: energy.carbs / total,
    fat: energy.fat / total,
  };
}

/** Sized so a long title still fits its three lines in the card's text column. */
export function ogTitleSize(title: string, hasCover: boolean) {
  const length = title.trim().length;
  const steps: ReadonlyArray<readonly [number, number]> = hasCover
    ? [
        [24, 68],
        [44, 58],
        [70, 48],
      ]
    : [
        [28, 88],
        [52, 74],
        [84, 60],
      ];
  for (const [maxLength, size] of steps) {
    if (length <= maxLength) return size;
  }
  return hasCover ? 40 : 50;
}
