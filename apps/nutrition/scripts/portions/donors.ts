import { householdServings } from "@repo/macros-core/foods/portions";

/** Tables whose household measures are worth copying, best first. */
export const portionDonorRank: Record<string, number> = {
  usda_foundation: 0,
  usda_sr_legacy: 1,
  cnf: 2,
  usda_fndds: 3,
  matvaretabellen: 4,
};

export interface PortionRow {
  label: string;
  grams: number;
}

export interface Candidate {
  id: string;
  name: string;
  source: string;
  conceptName: string | null;
  clusterKey: string | null;
  /** kcal per 100 g; a cup of dried fruit weighs nothing like a cup of fresh. */
  calories: number | null;
}

export interface Donor extends Candidate {
  portions: PortionRow[];
}

/** Rows a logging screen would actually offer; the rest are not worth copying. */
export const offeredPortions = (portions: readonly PortionRow[]) => {
  const seen = new Set<string>();
  return portions.filter((portion) => {
    const [serving] = householdServings([portion]);
    if (!serving) return false;
    const key = serving.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Same concept only counts when the energy density agrees: a concept can
 * span raw and cooked, and a cup weighs what the food's state makes it.
 */
export const densityAgrees = (a: number | null, b: number | null) => {
  if (a === null || b === null) return false;
  if (Math.max(a, b) < 40) return Math.abs(a - b) <= 15;
  return Math.min(a, b) / Math.max(a, b) >= 0.7;
};

// A donor offering several sizes beats a better table offering one odd
// measure ("1 skin" for a raw potato).
const score = (gap: Candidate, donor: Donor) => [
  -Math.min(donor.portions.length, 4),
  gap.clusterKey !== null && donor.clusterKey === gap.clusterKey ? 0 : 1,
  portionDonorRank[donor.source] ?? 99,
  Math.abs((donor.calories ?? 0) - (gap.calories ?? 0)),
];

const compare = (left: number[], right: number[]) => {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/**
 * The donor a gap borrows household measures from: a cluster sibling (same
 * concept, macros agree) or a same-concept item of similar energy density.
 * Prefer useful measure coverage, then cluster, source table and closeness.
 */
export const pickDonor = (
  gap: Candidate,
  donorsByConcept: ReadonlyMap<string, readonly Donor[]>,
): Donor | null => {
  if (!gap.conceptName) return null;
  let best: { donor: Donor; score: number[] } | null = null;
  for (const donor of donorsByConcept.get(gap.conceptName) ?? []) {
    if (donor.id === gap.id || donor.portions.length === 0) continue;
    // Asian/nashi pears have different sizes from European pears despite
    // sharing the same broad concept and similar energy density.
    if (
      gap.conceptName === "pear, raw" &&
      /asian|nashi/i.test(gap.name) !== /asian|nashi/i.test(donor.name)
    )
      continue;
    const sameCluster =
      gap.clusterKey !== null && donor.clusterKey === gap.clusterKey;
    if (!sameCluster && !densityAgrees(gap.calories, donor.calories)) continue;
    const candidate = { donor, score: score(gap, donor) };
    if (!best || compare(candidate.score, best.score) < 0) best = candidate;
  }
  return best?.donor ?? null;
};
