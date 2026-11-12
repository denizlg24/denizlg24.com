export const DEFAULT_NEW_PER_DAY = 20;
export const MAX_DUE_PER_QUEUE = 200;

interface Schedulable {
  suspended: boolean;
  createdAt: Date;
  fsrs: { due: Date; state: string };
}

/** How many unseen cards may still be introduced today. */
export function newCardAllowance(limit: number, introducedToday: number) {
  return Math.max(0, limit - introducedToday);
}

/**
 * Due cards come first, oldest due date first; then unseen cards in creation
 * order, up to what is left of the day's allowance.
 */
export function planReviewQueue<T extends Schedulable>(
  cards: readonly T[],
  now: Date,
  allowance: number,
): { due: T[]; fresh: T[] } {
  const live = cards.filter((card) => !card.suspended);
  const due = live
    .filter(
      (card) =>
        card.fsrs.state !== "new" && card.fsrs.due.getTime() <= now.getTime(),
    )
    .sort((a, b) => a.fsrs.due.getTime() - b.fsrs.due.getTime());
  const fresh = live
    .filter((card) => card.fsrs.state === "new")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, allowance);
  return { due, fresh };
}
