"use client";

import type {
  CourseAssignmentStatus,
  ICourseAssignment,
  ICourseDeadline,
  ICourseGradeProjection,
  ICourseKanbanCardSummary,
  ICourseReadingSummary,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { cn } from "@repo/ui/utils";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { CourseReadingsPanel } from "./course-readings";
import {
  ASSIGNMENT_STATUSES,
  BOARD_STATUSES,
  COMPLETED_STATUSES,
  isOverdue,
  STATUS_LABELS,
  STATUS_TONE,
  statusTransition,
} from "./coursework-status";

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function gradePercent(assignment: ICourseAssignment) {
  const score = assignment.grade?.score;
  const maxScore = assignment.grade?.maxScore;
  if (score === undefined || maxScore === undefined || maxScore <= 0) {
    return null;
  }
  return (score / maxScore) * 100;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(1)}%`;
}

function formatGrade(assignment: ICourseAssignment) {
  const grade = assignment.grade;
  if (!grade) return "";
  const parts: string[] = [];
  if (grade.score !== undefined && grade.maxScore !== undefined) {
    parts.push(`${grade.score}/${grade.maxScore}`);
  }
  if (grade.letter) parts.push(grade.letter);
  const percent = gradePercent(assignment);
  if (percent !== null) parts.push(formatPercent(percent));
  return parts.join(" · ");
}

/** One line. Everything editable lives behind the click, on the work page. */
function WorkRow({
  assignment,
  onSelect,
  onStatusChange,
}: {
  assignment: ICourseAssignment;
  onSelect: () => void;
  onStatusChange: (status: CourseAssignmentStatus) => void;
}) {
  const overdue = isOverdue(assignment);
  const done = COMPLETED_STATUSES.has(assignment.status);
  const grade = formatGrade(assignment);

  return (
    <div className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 border-b border-border/60 px-2 py-2 transition-colors last:border-b-0 hover:bg-muted/40">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          overdue
            ? "bg-destructive"
            : done
              ? "bg-muted-foreground/30"
              : "bg-accent",
        )}
      />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm",
          done && "text-muted-foreground",
        )}
      >
        {assignment.title}
      </button>
      <span className="hidden w-24 shrink-0 truncate text-[11px] text-muted-foreground sm:inline">
        {assignment.type}
        {!assignment.assessed && (
          <span className="ml-1.5 uppercase tracking-wide">· no mark</span>
        )}
      </span>
      <span
        className={cn(
          "hidden w-28 shrink-0 text-right text-[11px] tabular-nums sm:inline",
          overdue ? "text-destructive font-medium" : "text-muted-foreground",
        )}
      >
        {assignment.dueAt ? formatDateTime(assignment.dueAt) : "--"}
      </span>
      {/* Grade and status used to share this column, so setting a grade hid the
          status. They are separate now: a graded row still says it is graded. */}
      <span className="hidden w-28 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground lg:inline">
        {grade || "--"}
      </span>
      <StatusControl
        status={assignment.status}
        onChange={onStatusChange}
        className="w-24 shrink-0"
      />
    </div>
  );
}

/** The status pill, and the one click that changes it. */
function StatusControl({
  status,
  onChange,
  className,
}: {
  status: CourseAssignmentStatus;
  onChange: (status: CourseAssignmentStatus) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${STATUS_LABELS[status]}`}
          className={cn(
            "truncate rounded-full border border-transparent px-2 py-0.5 text-[11px] transition-colors hover:border-border hover:bg-background",
            STATUS_TONE[status],
            className,
          )}
        >
          {STATUS_LABELS[status]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ASSIGNMENT_STATUSES.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled={option.value === status}
            onClick={() => onChange(option.value)}
          >
            <span className={STATUS_TONE[option.value]}>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Column headings for the work list, aligned to `WorkRow`'s fixed widths. */
function WorkHeader() {
  return (
    <div className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 border-b px-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span className="size-1.5 shrink-0" />
      <span className="min-w-0 flex-1">Work</span>
      <span className="hidden w-24 shrink-0 sm:inline">Type</span>
      <span className="hidden w-28 shrink-0 text-right sm:inline">Due</span>
      <span className="hidden w-28 shrink-0 text-right lg:inline">Grade</span>
      <span className="w-24 shrink-0 pl-2">Status</span>
    </div>
  );
}

function ReadOnlyRow({
  title,
  meta,
  dueAt,
  overdue,
  completed,
}: {
  title: string;
  meta?: string;
  dueAt?: string;
  overdue?: boolean;
  completed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border/60 py-2 last:border-b-0">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          overdue
            ? "bg-destructive"
            : completed
              ? "bg-muted-foreground/30"
              : "bg-accent",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          completed && "text-muted-foreground",
        )}
      >
        {title}
      </span>
      {meta && (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
          {meta}
        </span>
      )}
      <span
        className={cn(
          "w-28 shrink-0 text-right text-[11px] tabular-nums",
          overdue ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {dueAt ? formatDateTime(dueAt) : "--"}
      </span>
    </div>
  );
}

/** One card on the status board. */
function BoardCard({
  assignment,
  onSelect,
  onStatusChange,
}: {
  assignment: ICourseAssignment;
  onSelect: () => void;
  onStatusChange: (status: CourseAssignmentStatus) => void;
}) {
  const overdue = isOverdue(assignment);
  const grade = formatGrade(assignment);

  return (
    <div className="group space-y-1.5 border-b border-border/60 py-2 last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        className="w-full truncate text-left text-sm hover:underline"
      >
        {assignment.title}
      </button>
      <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
        <span>{assignment.type}</span>
        {assignment.dueAt && (
          <span className={overdue ? "text-destructive" : undefined}>
            {formatDateTime(assignment.dueAt)}
          </span>
        )}
        {grade && <span className="font-mono">{grade}</span>}
        {assignment.submittedAt && (
          <span title={new Date(assignment.submittedAt).toLocaleString()}>
            ✓ {formatDateTime(assignment.submittedAt)}
          </span>
        )}
      </div>
      <StatusControl
        status={assignment.status}
        onChange={onStatusChange}
        className="-ml-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}

type Lane = "all" | "assessments" | "deadlines" | "tasks" | "readings";
type View = "list" | "board";
type StatusFilter = CourseAssignmentStatus | "all";

/**
 * The Work tab: every dated obligation this course carries, in one list.
 *
 * The lanes are the classification decision made visible. A row triage put in
 * the wrong one is fixed by opening it and flipping the toggle, which is the
 * whole reason extraction is allowed to default to the safer lane.
 *
 * Status is the second axis, and until this rebuild it was a field the editor
 * wrote and nothing displayed: the board view, the status filter and the pill
 * on every row are all reading the same value the sheet had been quietly
 * persisting.
 */
export function CourseWorkPanel({
  courseId,
  assignments,
  deadlines,
  kanbanCards,
  readings,
  onRefresh,
}: {
  courseId: string;
  assignments: ICourseAssignment[];
  deadlines: ICourseDeadline[];
  kanbanCards: ICourseKanbanCardSummary[];
  readings: ICourseReadingSummary[];
  onRefresh: () => Promise<void>;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const [lane, setLane] = useState<Lane>("all");
  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // An inline transition should feel instant, but the panel does not own the
  // assignments — the course page does. This overlays the pending value until
  // the refresh brings the real one back.
  const [pending, setPending] = useState<
    Record<string, CourseAssignmentStatus>
  >({});

  const applied = useMemo(
    () =>
      assignments.map((assignment) =>
        pending[assignment._id]
          ? { ...assignment, status: pending[assignment._id] }
          : assignment,
      ),
    [assignments, pending],
  );

  const changeStatus = useCallback(
    async (assignment: ICourseAssignment, status: CourseAssignmentStatus) => {
      setPending((prev) => ({ ...prev, [assignment._id]: status }));
      try {
        await client.patch<{ assignment: ICourseAssignment }>(
          `courses/${courseId}/assignments/${assignment._id}`,
          statusTransition(assignment, status),
        );
        await onRefresh();
      } catch {
        toast.error("Failed to update status");
      } finally {
        setPending((prev) => {
          const next = { ...prev };
          delete next[assignment._id];
          return next;
        });
      }
    },
    [client, courseId, onRefresh],
  );

  const openWork = (assignment: ICourseAssignment | null) => {
    router.push(
      assignment
        ? routes.courses.work(courseId, assignment._id)
        : routes.courses.workNew(courseId),
    );
  };

  const active = useMemo(
    () =>
      applied
        .filter((assignment) => assignment.status !== "archived")
        .sort((left, right) => {
          if (!left.dueAt && !right.dueAt) return 0;
          if (!left.dueAt) return 1;
          if (!right.dueAt) return -1;
          return (
            new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime()
          );
        }),
    [applied],
  );

  // The status filter narrows the assignment rows only. A kanban card, a manual
  // deadline and a reading carry no status, so filtering by one has to hide
  // them rather than pretend they all sit in `planned`.
  const statusFiltered = useMemo(
    () =>
      statusFilter === "all"
        ? active
        : active.filter((assignment) => assignment.status === statusFilter),
    [active, statusFilter],
  );

  const assessments = statusFiltered.filter(
    (assignment) => assignment.assessed,
  );
  const unassessed = statusFiltered.filter(
    (assignment) => !assignment.assessed,
  );
  const manualDeadlines =
    statusFilter === "all"
      ? deadlines.filter((deadline) => deadline.source === "manual")
      : [];
  // A card mirrored by an assignment is already dropped upstream by
  // `buildDeadlines`; undated cards never reach the radar at all.
  const mirrored = new Set(
    assignments
      .map((assignment) => assignment.kanbanCardId)
      .filter((cardId): cardId is string => Boolean(cardId)),
  );
  const tasks =
    statusFilter === "all"
      ? kanbanCards.filter((card) => !mirrored.has(card._id))
      : [];
  const laneReadings = statusFilter === "all" ? readings : [];

  const statusCounts = useMemo(() => {
    const counts = new Map<CourseAssignmentStatus, number>();
    for (const assignment of active) {
      counts.set(assignment.status, (counts.get(assignment.status) ?? 0) + 1);
    }
    return counts;
  }, [active]);

  const counts: Record<Lane, number> = {
    all:
      assessments.length +
      unassessed.length +
      manualDeadlines.length +
      tasks.length +
      laneReadings.length,
    assessments: assessments.length,
    deadlines: unassessed.length + manualDeadlines.length,
    tasks: tasks.length,
    readings: laneReadings.length,
  };

  const showAssessments = lane === "all" || lane === "assessments";
  const showDeadlines = lane === "all" || lane === "deadlines";
  const showTasks = lane === "all" || lane === "tasks";
  const showReadings = lane === "all" || lane === "readings";

  const laneTabs: { value: Lane; label: string }[] = [
    { value: "all", label: "All" },
    { value: "assessments", label: "Assessments" },
    { value: "deadlines", label: "Deadlines" },
    { value: "tasks", label: "Tasks" },
    { value: "readings", label: "Readings" },
  ];

  const boardRows =
    lane === "assessments"
      ? active.filter((assignment) => assignment.assessed)
      : lane === "deadlines"
        ? active.filter((assignment) => !assignment.assessed)
        : active;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 border-b">
        <div className="flex min-w-0 flex-1 gap-4 overflow-x-auto">
          {laneTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setLane(tab.value)}
              className={cn(
                "shrink-0 border-b-2 pb-2 text-xs transition-colors",
                lane === tab.value
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {counts[tab.value]}
              </span>
            </button>
          ))}
        </div>
        <div className="mb-1 flex items-center gap-1">
          {(["list", "board"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                view === option
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "list" ? "List" : "Board"}
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => openWork(null)}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </div>

      {view === "board" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {BOARD_STATUSES.map((status) => {
            const column = boardRows.filter(
              (assignment) => assignment.status === status,
            );
            return (
              <section key={status} className="min-w-0 space-y-1">
                <p className="flex items-baseline gap-1.5 border-b pb-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  <span className={STATUS_TONE[status]}>
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {column.length}
                  </span>
                </p>
                {column.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    —
                  </p>
                ) : (
                  column.map((assignment) => (
                    <BoardCard
                      key={assignment._id}
                      assignment={assignment}
                      onSelect={() => openWork(assignment)}
                      onStatusChange={(next) => changeStatus(assignment, next)}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", ...BOARD_STATUSES] as StatusFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStatusFilter(option)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                  statusFilter === option
                    ? "border-foreground bg-foreground/5 font-medium"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                {option === "all" ? "All" : STATUS_LABELS[option]}
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {option === "all"
                    ? active.length
                    : (statusCounts.get(option) ?? 0)}
                </span>
              </button>
            ))}
          </div>

          {counts[lane] === 0 && lane !== "readings" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">—</p>
          ) : (
            <div className="space-y-5">
              {showAssessments && assessments.length > 0 && (
                <section className="space-y-1">
                  {lane === "all" && (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Assessments
                    </p>
                  )}
                  <div>
                    <WorkHeader />
                    {assessments.map((assignment) => (
                      <WorkRow
                        key={assignment._id}
                        assignment={assignment}
                        onSelect={() => openWork(assignment)}
                        onStatusChange={(next) =>
                          changeStatus(assignment, next)
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {showDeadlines && counts.deadlines > 0 && (
                <section className="space-y-1">
                  {lane === "all" && (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Deadlines
                    </p>
                  )}
                  <div>
                    <WorkHeader />
                    {unassessed.map((assignment) => (
                      <WorkRow
                        key={assignment._id}
                        assignment={assignment}
                        onSelect={() => openWork(assignment)}
                        onStatusChange={(next) =>
                          changeStatus(assignment, next)
                        }
                      />
                    ))}
                    {manualDeadlines.map((deadline) => (
                      <ReadOnlyRow
                        key={deadline._id}
                        title={deadline.title}
                        meta="manual"
                        dueAt={deadline.dueAt}
                        overdue={deadline.overdue}
                        completed={deadline.completed}
                      />
                    ))}
                  </div>
                </section>
              )}

              {showTasks && tasks.length > 0 && (
                <section className="space-y-1">
                  {lane === "all" && (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Tasks
                    </p>
                  )}
                  <div>
                    {tasks.map((card) => (
                      <ReadOnlyRow
                        key={card._id}
                        title={card.title}
                        meta={
                          card.priority !== "none" ? card.priority : undefined
                        }
                        dueAt={card.dueDate}
                        completed={card.completed}
                        overdue={
                          !card.completed &&
                          Boolean(card.dueDate) &&
                          new Date(card.dueDate ?? "").getTime() < Date.now()
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {showReadings &&
                (lane === "readings" || laneReadings.length > 0) && (
                  <section className="space-y-2">
                    {lane === "all" && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Readings
                      </p>
                    )}
                    <CourseReadingsPanel
                      courseId={courseId}
                      readings={laneReadings}
                      onRefresh={onRefresh}
                    />
                  </section>
                )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The Grades tab. Only assessed rows appear here — that is what the flag is
 * for — and the contribution column is what a weight actually buys you.
 */
export function CourseGradebookPanel({
  assignments,
  gradeAverage,
  projection,
}: {
  assignments: ICourseAssignment[];
  gradeAverage: number | null;
  projection?: ICourseGradeProjection;
}) {
  const graded = assignments.filter(
    (assignment) =>
      assignment.assessed &&
      assignment.grade &&
      assignment.status !== "archived",
  );
  const pending = assignments.filter(
    (assignment) =>
      assignment.assessed &&
      !assignment.grade &&
      assignment.status !== "archived",
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <div className="font-mono text-2xl leading-none tabular-nums">
            {formatPercent(gradeAverage)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Weighted avg
          </div>
        </div>
        {projection && projection.worstCase !== null && (
          <>
            <div>
              <div className="font-mono text-2xl leading-none tabular-nums">
                {formatPercent(projection.worstCase)}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Secured
              </div>
            </div>
            <div>
              <div className="font-mono text-2xl leading-none tabular-nums">
                {formatPercent(projection.bestCase)}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Best case
              </div>
            </div>
            <div>
              <div className="font-mono text-2xl leading-none tabular-nums">
                {formatPercent(projection.remainingWeight)}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Still open
              </div>
            </div>
          </>
        )}
      </div>

      {graded.length === 0 && pending.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">—</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 text-left font-medium">Title</th>
                <th className="pb-2 text-left font-medium">Type</th>
                <th className="pb-2 text-right font-medium">Score</th>
                <th className="pb-2 text-right font-medium">%</th>
                <th className="pb-2 text-right font-medium">Weight</th>
                <th className="pb-2 text-right font-medium">Contrib.</th>
              </tr>
            </thead>
            <tbody>
              {graded.map((assignment) => {
                const percent = gradePercent(assignment);
                const weight = assignment.grade?.weight;
                const contribution =
                  percent !== null && weight !== undefined
                    ? (percent * weight) / 100
                    : null;
                return (
                  <tr
                    key={assignment._id}
                    className="border-b border-border/60"
                  >
                    <td className="max-w-0 truncate py-2 pr-3">
                      {assignment.title}
                    </td>
                    <td className="py-2 pr-3 text-[11px] text-muted-foreground">
                      {assignment.type}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-[11px] tabular-nums">
                      {assignment.grade?.score !== undefined &&
                      assignment.grade?.maxScore !== undefined
                        ? `${assignment.grade.score}/${assignment.grade.maxScore}`
                        : (assignment.grade?.letter ?? "--")}
                    </td>
                    <td
                      className={cn(
                        "py-2 pl-3 text-right font-mono text-[11px] tabular-nums",
                        percent !== null && percent < 60 && "text-destructive",
                      )}
                    >
                      {formatPercent(percent)}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {weight !== undefined ? `${weight}%` : "--"}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-[11px] tabular-nums">
                      {contribution !== null
                        ? `${contribution.toFixed(1)}`
                        : "--"}
                    </td>
                  </tr>
                );
              })}
              {pending.map((assignment) => (
                <tr
                  key={assignment._id}
                  className="border-b border-border/60 text-muted-foreground"
                >
                  <td className="max-w-0 truncate py-2 pr-3">
                    {assignment.title}
                  </td>
                  <td className="py-2 pr-3 text-[11px]">{assignment.type}</td>
                  <td
                    className="py-2 pl-3 text-right font-mono text-[11px]"
                    colSpan={3}
                  >
                    {assignment.status}
                  </td>
                  <td className="py-2 pl-3 text-right font-mono text-[11px] tabular-nums">
                    {assignment.grade?.weight !== undefined
                      ? `${assignment.grade.weight}%`
                      : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
