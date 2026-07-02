"use client";

import type {
  ISemesterCourseStanding,
  ISemesterDeadline,
  ISemesterOverview,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Separator } from "@repo/ui/separator";
import { cn } from "@repo/ui/utils";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "../provider";

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(1)}%`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDayHeading(dateKey: string, today: string, tomorrow: string) {
  if (dateKey === today) return "Today";
  if (dateKey === tomorrow) return "Tomorrow";
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function toDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </h2>
      <Separator className="flex-1" />
      {meta && (
        <span className="text-[11px] text-muted-foreground">{meta}</span>
      )}
    </div>
  );
}

function CockpitStat({
  label,
  value,
  alert,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          "font-mono text-xl leading-none tabular-nums",
          alert && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function CourseDot({ color }: { color?: string }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "var(--accent)" }}
    />
  );
}

function DeadlineRow({
  deadline,
  onSelectCourse,
}: {
  deadline: ISemesterDeadline;
  onSelectCourse?: (courseId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectCourse?.(deadline.courseId)}
      className="flex w-full items-center gap-2 py-1 text-left transition-colors hover:text-foreground/70"
    >
      <CourseDot color={deadline.courseColor} />
      <span className="min-w-0 flex-1 truncate text-sm">{deadline.title}</span>
      {deadline.sourceLabel && (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
          {deadline.sourceLabel}
        </span>
      )}
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {deadline.courseCode ?? deadline.courseName}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
          deadline.overdue ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {deadline.overdue ? "overdue" : formatTime(deadline.dueAt)}
      </span>
    </button>
  );
}

function StandingRow({
  standing,
  onSelectCourse,
}: {
  standing: ISemesterCourseStanding;
  onSelectCourse?: (courseId: string) => void;
}) {
  const { projection } = standing;
  const hasProjection =
    projection.worstCase !== null && projection.bestCase !== null;

  return (
    <button
      type="button"
      onClick={() => onSelectCourse?.(standing.courseId)}
      className="w-full space-y-1.5 py-2 text-left"
    >
      <div className="flex items-center gap-2">
        <CourseDot color={standing.color} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {standing.name}
        </span>
        {standing.overdue > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-destructive">
            <AlertCircle className="size-3" />
            {standing.overdue} overdue
          </span>
        )}
        <span className="shrink-0 font-mono text-sm tabular-nums">
          {formatPercent(standing.gradeAverage)}
        </span>
      </div>
      {hasProjection ? (
        <>
          {/* Secured (worst case) in the course color; the lighter band up to
              best case is the share of the final grade still in play. */}
          <div className="relative h-px w-full bg-border">
            <div
              className="absolute inset-y-0 left-0 h-px bg-muted-foreground/40"
              style={{ width: `${Math.min(100, projection.bestCase ?? 0)}%` }}
            />
            <div
              className="absolute -top-px left-0 h-[3px]"
              style={{
                width: `${Math.min(100, projection.worstCase ?? 0)}%`,
                backgroundColor: standing.color ?? "var(--accent)",
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              secured {formatPercent(projection.worstCase)}
            </span>
            <span className="tabular-nums">
              {formatPercent(projection.remainingWeight)} still open · best case{" "}
              {formatPercent(projection.bestCase)}
            </span>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {standing.gradeAverage === null
            ? "No grades yet"
            : "Add grade weights to unlock projections"}
          {standing.openAssignments > 0 &&
            ` · ${standing.openAssignments} open`}
        </p>
      )}
    </button>
  );
}

function CockpitSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-8">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-5 w-12 animate-pulse rounded bg-muted" />
            <div className="h-2 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

export function SemesterCockpit({
  onSelectCourse,
  reloadSignal,
}: {
  onSelectCourse?: (courseId: string) => void;
  reloadSignal?: number | string;
}) {
  const { client } = useAdmin();
  const [overview, setOverview] = useState<ISemesterOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchOverview = useCallback(async () => {
    setFailed(false);
    try {
      const result = await client.get<{ overview: ISemesterOverview }>(
        "courses/overview",
      );
      setOverview(result.overview);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview, reloadSignal]);

  const { todayKey, tomorrowKey } = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    return { todayKey: toDateKey(now), tomorrowKey: toDateKey(tomorrow) };
  }, []);

  if (loading) return <CockpitSkeleton />;

  if (failed) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>Couldn't load the semester overview.</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={() => {
            setLoading(true);
            void fetchOverview();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!overview || overview.stats.activeCourses === 0) return null;

  const { stats, deadlines, week, courses } = overview;
  const overdue = deadlines.filter((deadline) => deadline.overdue);
  const upcoming = deadlines.filter((deadline) => !deadline.overdue);
  const upcomingByDay = new Map<string, ISemesterDeadline[]>();
  for (const deadline of upcoming) {
    const key = toDateKey(new Date(deadline.dueAt));
    const list = upcomingByDay.get(key) ?? [];
    list.push(deadline);
    upcomingByDay.set(key, list);
  }
  const classesThisWeek = week.reduce(
    (sum, day) => sum + day.classes.length,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <CockpitStat
          label="Semester avg"
          value={formatPercent(stats.semesterAverage)}
        />
        <CockpitStat label="Due in 7 days" value={stats.dueNext7Days} />
        <CockpitStat
          label="Overdue"
          value={stats.overdue}
          alert={stats.overdue > 0}
        />
        <CockpitStat label="Open work" value={stats.openAssignments} />
        <CockpitStat label="Classes this week" value={classesThisWeek} />
      </div>

      {classesThisWeek > 0 && (
        <section className="space-y-3">
          <SectionHeading title="This week" />
          <div className="overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-7 gap-x-4">
              {week.map((day) => (
                <div key={day.date} className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span
                      className={cn(
                        "text-[10px] uppercase",
                        day.isToday
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {day.label} {day.date.slice(8)}
                    </span>
                    {day.deadlineCount > 0 && (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {day.deadlineCount} due
                      </span>
                    )}
                  </div>
                  {day.classes.map((entry, index) => (
                    <button
                      key={`${entry.courseId}-${index}`}
                      type="button"
                      onClick={() => onSelectCourse?.(entry.courseId)}
                      className="flex w-full items-center gap-1.5 py-0.5 text-left transition-colors hover:text-foreground/70"
                    >
                      <CourseDot color={entry.courseColor} />
                      <span className="truncate text-[11px]">
                        <span className="font-mono tabular-nums">
                          {entry.startTime}
                        </span>{" "}
                        {entry.courseName}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <section className="space-y-3">
          <SectionHeading title="Deadline radar" meta="next 14 days" />
          {deadlines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing due in the next two weeks
            </p>
          ) : (
            <div className="space-y-3">
              {overdue.length > 0 && (
                <div>
                  <p className="pb-1 text-[10px] font-semibold uppercase text-destructive">
                    Overdue
                  </p>
                  {overdue.map((deadline) => (
                    <DeadlineRow
                      key={deadline._id}
                      deadline={deadline}
                      onSelectCourse={onSelectCourse}
                    />
                  ))}
                </div>
              )}
              {[...upcomingByDay.entries()].map(([dateKey, items]) => (
                <div key={dateKey}>
                  <p className="pb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    {formatDayHeading(dateKey, todayKey, tomorrowKey)}
                  </p>
                  {items.map((deadline) => (
                    <DeadlineRow
                      key={deadline._id}
                      deadline={deadline}
                      onSelectCourse={onSelectCourse}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <SectionHeading title="Grade standings" meta="secured vs best case" />
          <div className="space-y-1">
            {courses.map((standing) => (
              <StandingRow
                key={standing.courseId}
                standing={standing}
                onSelectCourse={onSelectCourse}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
