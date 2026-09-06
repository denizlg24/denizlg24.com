import type { CourseAssignmentStatus, ICourseAssignment } from "@repo/schemas";

export const ASSIGNMENT_STATUSES: {
  value: CourseAssignmentStatus;
  label: string;
}[] = [
  { value: "planned", label: "Planned" },
  { value: "in-progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "graded", label: "Graded" },
  { value: "archived", label: "Archived" },
];

/**
 * The lanes of the status board, in the order work moves through them.
 *
 * `archived` is deliberately absent: it is a way of hiding a row, not a stage
 * of doing it, and giving it a column would put a permanent graveyard next to
 * four working lanes.
 */
export const BOARD_STATUSES: CourseAssignmentStatus[] = [
  "planned",
  "in-progress",
  "submitted",
  "graded",
];

/** Statuses that mean the work is off the radar: dimmed, never overdue. */
export const COMPLETED_STATUSES = new Set<CourseAssignmentStatus>([
  "submitted",
  "graded",
  "archived",
]);

export const STATUS_LABELS: Record<CourseAssignmentStatus, string> =
  Object.fromEntries(
    ASSIGNMENT_STATUSES.map((s) => [s.value, s.label]),
  ) as Record<CourseAssignmentStatus, string>;

/**
 * Tailwind classes for a status pill. Deliberately not tied to the semantic
 * colour tokens: these are five neighbouring states, not five severities.
 */
export const STATUS_TONE: Record<CourseAssignmentStatus, string> = {
  planned: "text-muted-foreground",
  "in-progress": "text-blue-600 dark:text-blue-400",
  submitted: "text-amber-600 dark:text-amber-400",
  graded: "text-emerald-600 dark:text-emerald-400",
  archived: "text-muted-foreground/60",
};

/** Fill colours for the progress strip, matching STATUS_TONE's text colours. */
export const STATUS_BAR: Record<CourseAssignmentStatus, string> = {
  planned: "bg-muted-foreground/30",
  "in-progress": "bg-blue-500",
  submitted: "bg-amber-500",
  graded: "bg-emerald-500",
  archived: "bg-muted-foreground/20",
};

/**
 * How the tracked work is distributed across the board statuses.
 *
 * `archived` is excluded so the strip describes live work — an archived row is
 * hidden everywhere else and would otherwise grow the denominator forever.
 */
export function summariseByStatus(
  assignments: Pick<ICourseAssignment, "status">[],
): {
  counts: Record<CourseAssignmentStatus, number>;
  total: number;
} {
  const counts = {
    planned: 0,
    "in-progress": 0,
    submitted: 0,
    graded: 0,
    archived: 0,
  } as Record<CourseAssignmentStatus, number>;
  let total = 0;
  for (const assignment of assignments) {
    counts[assignment.status] += 1;
    if (assignment.status !== "archived") total += 1;
  }
  return { counts, total };
}

/**
 * The patch that moves a row to `status`, carrying the `submittedAt` stamp.
 *
 * The stamp is written the first time a row reaches a submitted-or-later
 * status and cleared when it goes back to being unfinished, so "when did I hand
 * this in" survives a later regrade. Re-submitting something already stamped
 * keeps the original time rather than resetting it to now.
 */
export function statusTransition(
  assignment: Pick<ICourseAssignment, "status" | "submittedAt">,
  status: CourseAssignmentStatus,
): { status: CourseAssignmentStatus; submittedAt?: string | null } {
  const handedIn = status === "submitted" || status === "graded";
  if (handedIn) {
    return assignment.submittedAt
      ? { status }
      : { status, submittedAt: new Date().toISOString() };
  }
  return assignment.submittedAt ? { status, submittedAt: null } : { status };
}

/** Overdue means dated, past, and not yet off the radar. */
export function isOverdue(assignment: ICourseAssignment): boolean {
  if (!assignment.dueAt) return false;
  if (COMPLETED_STATUSES.has(assignment.status)) return false;
  return new Date(assignment.dueAt).getTime() < Date.now();
}
