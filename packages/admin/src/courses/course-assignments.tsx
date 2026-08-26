"use client";

import type {
  ICourseAssignment,
  ICourseDeadline,
  ICourseGradeProjection,
  ICourseKanbanCardSummary,
  ICourseReadingSummary,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { CourseReadingsPanel } from "./course-readings";
import { CourseWorkSheet } from "./course-work-sheet";

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

const COMPLETED_STATUSES = new Set(["submitted", "graded", "archived"]);

function isOverdue(assignment: ICourseAssignment) {
  if (!assignment.dueAt) return false;
  if (COMPLETED_STATUSES.has(assignment.status)) return false;
  return new Date(assignment.dueAt).getTime() < Date.now();
}

/** One line. Everything editable lives behind the click, in the sheet. */
function WorkRow({
  assignment,
  onSelect,
}: {
  assignment: ICourseAssignment;
  onSelect: () => void;
}) {
  const overdue = isOverdue(assignment);
  const done = COMPLETED_STATUSES.has(assignment.status);
  const grade = formatGrade(assignment);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 border-b border-border/60 px-2 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
    >
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
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          done && "text-muted-foreground",
        )}
      >
        {assignment.title}
      </span>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
        {assignment.type}
      </span>
      {!assignment.assessed && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          no mark
        </span>
      )}
      <span
        className={cn(
          "w-28 shrink-0 text-right text-[11px] tabular-nums",
          overdue ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {assignment.dueAt ? formatDateTime(assignment.dueAt) : "--"}
      </span>
      <span className="w-32 shrink-0 text-right font-mono text-[11px] tabular-nums">
        {grade || (
          <span className="text-muted-foreground">{assignment.status}</span>
        )}
      </span>
    </button>
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

type Lane = "all" | "assessments" | "deadlines" | "tasks" | "readings";

/**
 * The Work tab: every dated obligation this course carries, in one list.
 *
 * The lanes are the classification decision made visible. A row triage put in
 * the wrong one is fixed by opening it and flipping the toggle, which is the
 * whole reason extraction is allowed to default to the safer lane.
 */
export function CourseWorkPanel({
  courseId,
  assignments,
  deadlines,
  kanbanCards,
  readings,
  onOpenExternal,
  onRefresh,
}: {
  courseId: string;
  assignments: ICourseAssignment[];
  deadlines: ICourseDeadline[];
  kanbanCards: ICourseKanbanCardSummary[];
  readings: ICourseReadingSummary[];
  onOpenExternal: (url: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [lane, setLane] = useState<Lane>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ICourseAssignment | null>(null);

  const active = useMemo(
    () =>
      assignments
        .filter((assignment) => assignment.status !== "archived")
        .sort((left, right) => {
          if (!left.dueAt && !right.dueAt) return 0;
          if (!left.dueAt) return 1;
          if (!right.dueAt) return -1;
          return (
            new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime()
          );
        }),
    [assignments],
  );

  const assessments = active.filter((assignment) => assignment.assessed);
  const unassessed = active.filter((assignment) => !assignment.assessed);
  const manualDeadlines = deadlines.filter(
    (deadline) => deadline.source === "manual",
  );
  // A card mirrored by an assignment is already dropped upstream by
  // `buildDeadlines`; undated cards never reach the radar at all.
  const mirrored = new Set(
    assignments
      .map((assignment) => assignment.kanbanCardId)
      .filter((cardId): cardId is string => Boolean(cardId)),
  );
  const tasks = kanbanCards.filter((card) => !mirrored.has(card._id));

  const counts: Record<Lane, number> = {
    all:
      assessments.length +
      unassessed.length +
      manualDeadlines.length +
      tasks.length +
      readings.length,
    assessments: assessments.length,
    deadlines: unassessed.length + manualDeadlines.length,
    tasks: tasks.length,
    readings: readings.length,
  };

  const openSheet = (assignment: ICourseAssignment | null) => {
    setEditing(assignment);
    setSheetOpen(true);
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-1 h-7"
          onClick={() => openSheet(null)}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
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
                {assessments.map((assignment) => (
                  <WorkRow
                    key={assignment._id}
                    assignment={assignment}
                    onSelect={() => openSheet(assignment)}
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
                {unassessed.map((assignment) => (
                  <WorkRow
                    key={assignment._id}
                    assignment={assignment}
                    onSelect={() => openSheet(assignment)}
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
                    meta={card.priority !== "none" ? card.priority : undefined}
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

          {showReadings && (lane === "readings" || readings.length > 0) && (
            <section className="space-y-2">
              {lane === "all" && (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Readings
                </p>
              )}
              <CourseReadingsPanel
                courseId={courseId}
                readings={readings}
                onRefresh={onRefresh}
              />
            </section>
          )}
        </div>
      )}

      <CourseWorkSheet
        courseId={courseId}
        assignment={editing}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={onRefresh}
        onOpenExternal={onOpenExternal}
      />
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
