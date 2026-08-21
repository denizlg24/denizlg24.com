import type { IPaper, PaperReadingStatus } from "@repo/schemas";

export const READING_STATUS_LABEL: Record<PaperReadingStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Completed",
};

export function percentRead(
  currentPage: number | undefined,
  totalPages: number | undefined,
  readingStatus: PaperReadingStatus,
): number | undefined {
  if (!currentPage || !totalPages) {
    return readingStatus === "read" ? 100 : undefined;
  }
  return Math.min(100, Math.round((currentPage / totalPages) * 100));
}

export function readingPercent(paper: IPaper): number | undefined {
  const { currentPage, totalPages } = paper.progress ?? {};
  return percentRead(currentPage, totalPages, paper.readingStatus);
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

/**
 * Against the deadline itself, not the day count: `daysUntil` rounds up, so a
 * deadline that passed an hour ago still reports zero days left.
 */
export function isOverdue(item: {
  dueAt?: string;
  readingStatus: PaperReadingStatus;
}): boolean {
  if (!item.dueAt || item.readingStatus === "read") return false;
  const due = new Date(item.dueAt).getTime();
  return !Number.isNaN(due) && due < Date.now();
}

/**
 * A `<input type="date">` speaks calendar days and `dueAt` is an instant, so
 * both directions go through local time. Slicing the ISO string instead reads
 * back the UTC day, which is the day after the one that was picked for any
 * negative offset.
 */
export function toDateInput(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromDateInput(day: string): string | null {
  if (!day) return null;
  const date = new Date(`${day}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
