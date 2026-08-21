import type { IPaper, PaperReadingStatus } from "@repo/schemas";

export const READING_STATUS_LABEL: Record<PaperReadingStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Completed",
};

export function readingPercent(paper: IPaper): number | undefined {
  const { currentPage, totalPages } = paper.progress ?? {};
  if (!currentPage || !totalPages) {
    return paper.readingStatus === "read" ? 100 : undefined;
  }
  return Math.min(100, Math.round((currentPage / totalPages) * 100));
}

export function pagesRemaining(paper: IPaper): number | undefined {
  const { currentPage, totalPages } = paper.progress ?? {};
  if (!currentPage || !totalPages) return undefined;
  return Math.max(0, totalPages - currentPage);
}

/**
 * Whole days from now until the deadline, floored at zero. Today counts as one
 * day left rather than zero, so the pace line never divides by nothing.
 */
export function daysUntil(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return undefined;
  return Math.ceil((due - Date.now()) / 86_400_000);
}

/**
 * Pages per day needed to finish by the deadline. Undefined when there is no
 * deadline, no page count, or nothing left to read.
 */
export function requiredPace(paper: IPaper): number | undefined {
  const remaining = pagesRemaining(paper);
  const days = daysUntil(paper.dueAt);
  if (!remaining || days === undefined) return undefined;
  return Math.ceil(remaining / Math.max(1, days));
}

export function dueLabel(iso: string | undefined): string | undefined {
  const days = daysUntil(iso);
  if (days === undefined) return undefined;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `${days}d left`;
}

export function isOverdue(item: {
  dueAt?: string;
  readingStatus: PaperReadingStatus;
}): boolean {
  const days = daysUntil(item.dueAt);
  return days !== undefined && days < 0 && item.readingStatus !== "read";
}

export function authorLine(paper: Pick<IPaper, "authors">): string {
  return paper.authors
    .map(
      (author) =>
        author.literal ||
        [author.given, author.family].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join(", ");
}

/**
 * Continue-reading order: overdue first, then by deadline, then by whatever was
 * touched most recently. Anything without either signal sinks to the bottom.
 */
export function byReadingRecency(a: IPaper, b: IPaper): number {
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  const aSeen = a.progress?.updatedAt ?? a.updatedAt;
  const bSeen = b.progress?.updatedAt ?? b.updatedAt;
  return new Date(bSeen).getTime() - new Date(aSeen).getTime();
}
