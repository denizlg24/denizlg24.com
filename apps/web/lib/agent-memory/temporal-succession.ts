import type { AgentExplicitness, AgentTemporal } from "@repo/schemas";

/**
 * What a disagreement between a new statement and a stored one actually means.
 *
 * The formation model can only report that two statements disagree; it has no
 * reliable way to tell "this fact changed" from "one of these is wrong". Left
 * alone it flags both as conflicts, so every value that moves over time — a
 * balance, a weight, a job title, a city — accumulates permanent contradiction
 * links and a review flag the owner has to clear by hand. That is the failure
 * this classifier exists to remove: a value moving forward in time is the
 * normal case, not an anomaly.
 */
export type TemporalConflictClass = "contradiction" | "succession" | "stale";

export interface TemporalConflictSide {
  temporal?: Pick<AgentTemporal, "validFrom" | "validUntil"> | null;
  explicitness: AgentExplicitness;
  /**
   * When the statement was actually observed. Used to order two statements that
   * carry no explicit `validFrom`, which is the overwhelming majority of them —
   * open-ended statements are the default and dating them is the exception.
   */
  observedAt: Date;
}

/**
 * Two statements observed in the same sitting are one conversation disagreeing
 * with itself, not a value that moved. Only applied when ordering falls back to
 * observation time; an explicit `validFrom` on both sides is taken at its word
 * however close together the two dates sit.
 */
export const SUCCESSION_MIN_SEPARATION_MS = 60 * 60 * 1_000;

function toTime(value: Date | string | undefined | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

const EXPLICITNESS_RANK: Record<AgentExplicitness, number> = {
  explicit: 2,
  inferred: 1,
  hypothesis: 0,
};

export function classifyTemporalConflict(options: {
  candidate: TemporalConflictSide;
  prior: TemporalConflictSide;
}): TemporalConflictClass {
  const candidateFrom = toTime(options.candidate.temporal?.validFrom);
  const priorFrom = toTime(options.prior.temporal?.validFrom);
  const priorUntil = toTime(options.prior.temporal?.validUntil);

  const candidateStart =
    candidateFrom ?? options.candidate.observedAt.getTime();
  const priorStart = priorFrom ?? options.prior.observedAt.getTime();

  // The prior statement's own window closed before the new one opens, so the
  // two never describe the same instant and cannot disagree.
  if (priorUntil !== null && priorUntil <= candidateStart) return "succession";

  // Downgrading an owner-stated fact on the strength of a guess is exactly the
  // case worth a human look, however much later the guess arrives.
  if (
    EXPLICITNESS_RANK[options.candidate.explicitness] <
    EXPLICITNESS_RANK[options.prior.explicitness]
  ) {
    return "contradiction";
  }

  const bothDated = candidateFrom !== null && priorFrom !== null;
  // Two dated statements about the same instant is the genuine disagreement
  // this whole classifier is trying not to swallow.
  if (bothDated && candidateStart === priorStart) return "contradiction";

  const separation = candidateStart - priorStart;
  const required = bothDated ? 1 : SUCCESSION_MIN_SEPARATION_MS;

  if (separation >= required) return "succession";
  // A statement describing an older state than one already stored is not news;
  // superseding on it would walk the memory backwards.
  if (separation <= -required) return "stale";
  return "contradiction";
}
