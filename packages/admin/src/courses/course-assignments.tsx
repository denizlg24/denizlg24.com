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
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Stat, StatGroup } from "@repo/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { FilterTabs, ToolbarSpacer } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { GraduationCap, ListTodo, Plus } from "lucide-react";
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
  if (value === null || value === undefined) return "—";
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

function dotClass(overdue: boolean, done: boolean) {
  return cn(
    "size-1.5 shrink-0 rounded-full",
    overdue
      ? "bg-status-critical"
      : done
        ? "bg-muted-foreground/30"
        : "bg-accent-strong/60",
  );
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
    <ListRow
      leading={<span className={dotClass(overdue, done)} />}
      title={
        <span className={cn(done && "text-muted-foreground")}>
          {assignment.title}
        </span>
      }
      onClick={onSelect}
      meta={
        <>
          <span className="hidden w-24 truncate sm:inline">
            {assignment.type}
            {!assignment.assessed && " · no mark"}
          </span>
          <span
            className={cn(
              "hidden w-28 text-right sm:inline",
              overdue && "text-status-critical",
            )}
          >
            {assignment.dueAt ? formatDateTime(assignment.dueAt) : "—"}
          </span>
          {/* Grade and status are separate columns so a graded row still says it is graded. */}
          <span className="hidden w-28 text-right lg:inline">
            {grade || "—"}
          </span>
        </>
      }
      trailing={
        <StatusControl
          status={assignment.status}
          onChange={onStatusChange}
          className="w-24"
        />
      }
    />
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
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Status: ${STATUS_LABELS[status]}`}
          className={cn(
            "justify-start truncate font-normal",
            STATUS_TONE[status],
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {STATUS_LABELS[status]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ASSIGNMENT_STATUSES.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled={option.value === status}
            onClick={(event) => {
              event.stopPropagation();
              onChange(option.value);
            }}
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
    <div className="flex items-center gap-3 border-b pb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
      <span className="w-5 shrink-0" />
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
  overdue = false,
  completed = false,
}: {
  title: string;
  meta?: string;
  dueAt?: string;
  overdue?: boolean;
  completed?: boolean;
}) {
  return (
    <ListRow
      leading={<span className={dotClass(overdue, completed)} />}
      title={
        <span className={cn(completed && "text-muted-foreground")}>
          {title}
        </span>
      }
      meta={
        <>
          {meta && <span className="hidden sm:inline">{meta}</span>}
          <span
            className={cn("w-28 text-right", overdue && "text-status-critical")}
          >
            {dueAt ? formatDateTime(dueAt) : "—"}
          </span>
        </>
      }
    />
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
    <div className="group/card -mx-2 flex flex-col gap-1 rounded-md px-2 py-2 transition-colors hover:bg-surface/70">
      <button
        type="button"
        onClick={onSelect}
        className="w-full truncate text-left text-sm text-accent-strong focus-visible:outline-none"
      >
        {assignment.title}
      </button>
      <div className="flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums text-muted-foreground">
        <span>{assignment.type}</span>
        {assignment.dueAt && (
          <span className={cn(overdue && "text-status-critical")}>
            {formatDateTime(assignment.dueAt)}
          </span>
        )}
        {grade && <span>{grade}</span>}
        {assignment.submittedAt && (
          <span title={new Date(assignment.submittedAt).toLocaleString()}>
            ✓ {formatDateTime(assignment.submittedAt)}
          </span>
        )}
      </div>
      <StatusControl
        status={assignment.status}
        onChange={onStatusChange}
        className="-ml-2 w-fit opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
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

  const workList = (rows: ICourseAssignment[]) =>
    rows.map((assignment) => (
      <WorkRow
        key={assignment._id}
        assignment={assignment}
        onSelect={() => openWork(assignment)}
        onStatusChange={(next) => changeStatus(assignment, next)}
      />
    ));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs
          value={lane}
          onChange={setLane}
          options={laneTabs.map((tab) => ({
            ...tab,
            count: counts[tab.value],
          }))}
          className="min-w-0 overflow-x-auto"
        />
        <ToolbarSpacer />
        <FilterTabs
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List" },
            { value: "board", label: "Board" },
          ]}
        />
        <Button variant="ghost" size="sm" onClick={() => openWork(null)}>
          <Plus />
          Add
        </Button>
      </div>

      {view === "board" ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {BOARD_STATUSES.map((status) => {
            const column = boardRows.filter(
              (assignment) => assignment.status === status,
            );
            return (
              <Section
                key={status}
                title={
                  <span className={STATUS_TONE[status]}>
                    {STATUS_LABELS[status]}
                  </span>
                }
                count={column.length}
                className="min-w-0 gap-1"
              >
                {column.length === 0 ? (
                  <p className="py-3 text-xs text-muted-foreground">—</p>
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
              </Section>
            );
          })}
        </div>
      ) : (
        <>
          <FilterTabs
            value={statusFilter}
            onChange={setStatusFilter}
            options={(["all", ...BOARD_STATUSES] as StatusFilter[]).map(
              (option) => ({
                value: option,
                label: option === "all" ? "All" : STATUS_LABELS[option],
                count:
                  option === "all"
                    ? active.length
                    : (statusCounts.get(option) ?? 0),
              }),
            )}
          />

          {counts[lane] === 0 && lane !== "readings" ? (
            <EmptyState compact icon={<ListTodo />} label="No work" />
          ) : (
            <>
              {showAssessments && assessments.length > 0 && (
                <Section title="Assessments" count={assessments.length}>
                  <div className="flex flex-col">
                    <WorkHeader />
                    <List>{workList(assessments)}</List>
                  </div>
                </Section>
              )}

              {showDeadlines && counts.deadlines > 0 && (
                <Section title="Deadlines" count={counts.deadlines}>
                  <div className="flex flex-col">
                    <WorkHeader />
                    <List>
                      {workList(unassessed)}
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
                    </List>
                  </div>
                </Section>
              )}

              {showTasks && tasks.length > 0 && (
                <Section title="Tasks" count={tasks.length}>
                  <List>
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
                  </List>
                </Section>
              )}

              {showReadings &&
                (lane === "readings" || laneReadings.length > 0) && (
                  <Section title="Readings" count={laneReadings.length}>
                    <CourseReadingsPanel
                      courseId={courseId}
                      readings={laneReadings}
                      onRefresh={onRefresh}
                    />
                  </Section>
                )}
            </>
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
    <div className="flex flex-col gap-8">
      <StatGroup>
        <Stat label="Weighted avg" value={formatPercent(gradeAverage)} />
        {projection && projection.worstCase !== null && (
          <>
            <Stat label="Secured" value={formatPercent(projection.worstCase)} />
            <Stat
              label="Best case"
              value={formatPercent(projection.bestCase)}
            />
            <Stat
              label="Still open"
              value={formatPercent(projection.remainingWeight)}
              tone="muted"
            />
          </>
        )}
      </StatGroup>

      {graded.length === 0 && pending.length === 0 ? (
        <EmptyState compact icon={<GraduationCap />} label="No assessments" />
      ) : (
        <Table className="min-w-[32rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Contrib.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {graded.map((assignment) => {
              const percent = gradePercent(assignment);
              const weight = assignment.grade?.weight;
              const contribution =
                percent !== null && weight !== undefined
                  ? (percent * weight) / 100
                  : null;
              return (
                <TableRow key={assignment._id}>
                  <TableCell className="max-w-0 truncate text-accent-strong">
                    {assignment.title}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {assignment.type}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {assignment.grade?.score !== undefined &&
                    assignment.grade?.maxScore !== undefined
                      ? `${assignment.grade.score}/${assignment.grade.maxScore}`
                      : (assignment.grade?.letter ?? "—")}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-xs tabular-nums",
                      percent !== null &&
                        percent < 60 &&
                        "text-status-critical",
                    )}
                  >
                    {formatPercent(percent)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {weight !== undefined ? `${weight}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {contribution !== null ? contribution.toFixed(1) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
            {pending.map((assignment) => (
              <TableRow key={assignment._id} className="text-muted-foreground">
                <TableCell className="max-w-0 truncate">
                  {assignment.title}
                </TableCell>
                <TableCell className="text-xs">{assignment.type}</TableCell>
                <TableCell
                  className={cn(
                    "text-right text-xs",
                    STATUS_TONE[assignment.status],
                  )}
                  colSpan={3}
                >
                  {STATUS_LABELS[assignment.status]}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {assignment.grade?.weight !== undefined
                    ? `${assignment.grade.weight}%`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
