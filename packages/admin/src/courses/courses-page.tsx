"use client";

import type {
  ICourse,
  ICourseDeadline,
  ICourseDetail,
  ICourseListItem,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/empty";
import { PageHeader } from "@repo/ui/page-header";
import { Separator } from "@repo/ui/separator";
import { cn } from "@repo/ui/utils";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Home,
  Inbox,
  Kanban,
  Link as LinkIcon,
  MapPin,
  Pencil,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  CourseAssignmentsPanel,
  CourseGradebookPanel,
} from "./course-assignments";
import { SemesterCockpit } from "./semester-cockpit";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function courseDates(course: ICourse) {
  const start = formatDate(course.startsOn);
  const end = formatDate(course.endsOn);
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

function deadlineTone(deadline: ICourseDeadline) {
  if (deadline.completed) return "text-muted-foreground";
  if (deadline.overdue) return "text-destructive";
  return "text-foreground";
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(1)}%`;
}

function CourseSkeleton() {
  const { slots } = useAdmin();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<GraduationCap className="size-4 text-muted-foreground" />}
        title="Courses"
      >
        <Button size="sm" disabled>
          <Plus />
          Add Class
        </Button>
      </PageHeader>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-40 rounded-md border bg-card/70 p-4">
            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-5 w-44 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border bg-card/60", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function InlineEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function CourseCard({
  item,
  onSelect,
}: {
  item: ICourseListItem;
  onSelect: () => void;
}) {
  const { course, stats, nextDeadline } = item;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col rounded-md border bg-card text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className="h-1 rounded-t-md"
        style={{ backgroundColor: course.color ?? "var(--accent)" }}
      />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {course.code && (
              <Badge variant="outline" className="font-mono">
                {course.code}
              </Badge>
            )}
            {course.semester && (
              <span className="truncate text-xs text-muted-foreground">
                {course.semester}
              </span>
            )}
          </div>
          <h2 className="line-clamp-2 min-h-[2.75rem] text-base font-semibold leading-snug">
            {course.name}
          </h2>
          {course.description && (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {course.description}
            </p>
          )}
        </div>

        <div className="mt-auto grid grid-cols-4 gap-2 text-[11px]">
          <span className="rounded-md bg-muted/60 px-2 py-1">
            {stats.timetableEntries} time
          </span>
          <span className="rounded-md bg-muted/60 px-2 py-1">
            {stats.dueCards + stats.openManualDeadlines + stats.openAssignments}{" "}
            due
          </span>
          <span className="rounded-md bg-muted/60 px-2 py-1">
            {stats.assignments} work
          </span>
          <span className="rounded-md bg-muted/60 px-2 py-1">
            {formatPercent(stats.gradeAverage)}
          </span>
        </div>

        {nextDeadline && (
          <div className="flex items-center gap-2 border-t pt-3 text-xs">
            <Clock className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {nextDeadline.title}
            </span>
            <span className={cn("shrink-0", deadlineTone(nextDeadline))}>
              {formatDateTime(nextDeadline.dueAt)}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="font-mono text-lg leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function CourseHome({
  detail,
  onBack,
  onEdit,
  onDelete,
  onOpenExternal,
  onRefresh,
}: {
  detail: ICourseDetail;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenExternal: (url: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { course, stats } = detail;
  const activeDeadlines = detail.deadlines.filter(
    (deadline) => !deadline.completed,
  );
  const dateRange = courseDates(course);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon" className="size-7" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div
          className="size-3 rounded-full"
          style={{ backgroundColor: course.color ?? "var(--accent)" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{course.name}</h1>
            {course.code && (
              <Badge
                variant="outline"
                className="hidden font-mono sm:inline-flex"
              >
                {course.code}
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[course.semester, course.instructorName, dateRange]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {course.homepageUrl && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onOpenExternal(course.homepageUrl ?? "")}
          >
            <Home className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]">
          <div className="space-y-4">
            <Section
              title="Overview"
              icon={<BookOpen className="size-4 text-muted-foreground" />}
            >
              <div className="space-y-4">
                {course.description && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {course.description}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                  <Stat label="Schedule" value={stats.timetableEntries} />
                  <Stat label="Events" value={stats.calendarEvents} />
                  <Stat label="Cards" value={stats.kanbanCards} />
                  <Stat label="Work" value={stats.assignments} />
                  <Stat label="Graded" value={stats.gradedAssignments} />
                  <Stat label="Overdue" value={stats.overdueDeadlines} />
                </div>
                {(course.location ||
                  course.homepageUrl ||
                  course.links.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {course.location && (
                      <Badge variant="secondary">
                        <MapPin className="size-3" />
                        {course.location}
                      </Badge>
                    )}
                    {course.homepageUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenExternal(course.homepageUrl ?? "")}
                      >
                        <ExternalLink className="size-3.5" />
                        Homepage
                      </Button>
                    )}
                    {course.links.map((link) => (
                      <Button
                        key={link._id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenExternal(link.url)}
                      >
                        <LinkIcon className="size-3.5" />
                        {link.label}
                      </Button>
                    ))}
                  </div>
                )}
                {course.customFields.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {course.customFields.map((field) => (
                      <div
                        key={field._id}
                        className="rounded-md border px-3 py-2"
                      >
                        <div className="text-[10px] uppercase text-muted-foreground">
                          {field.label}
                        </div>
                        <div className="truncate text-sm">{field.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            <Section
              title="Deadlines"
              icon={<AlertCircle className="size-4 text-muted-foreground" />}
            >
              {activeDeadlines.length === 0 ? (
                <InlineEmpty label="No open deadlines" />
              ) : (
                <div className="space-y-2">
                  {activeDeadlines.map((deadline) => (
                    <div
                      key={deadline._id}
                      className="flex items-start gap-3 rounded-md border px-3 py-2"
                    >
                      <div
                        className={cn(
                          "mt-1 size-2 rounded-full",
                          deadline.overdue ? "bg-destructive" : "bg-accent",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {deadline.title}
                          </span>
                          <Badge variant="outline">{deadline.source}</Badge>
                          {deadline.priority &&
                            deadline.priority !== "none" && (
                              <Badge variant="secondary">
                                {deadline.priority}
                              </Badge>
                            )}
                        </div>
                        {(deadline.sourceLabel || deadline.notes) && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {[deadline.sourceLabel, deadline.notes]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-right text-xs",
                          deadlineTone(deadline),
                        )}
                      >
                        {formatDateTime(deadline.dueAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Assignments"
              icon={<ClipboardList className="size-4 text-muted-foreground" />}
            >
              <CourseAssignmentsPanel
                courseId={course._id}
                assignments={detail.assignments}
                onOpenExternal={onOpenExternal}
                onRefresh={onRefresh}
              />
            </Section>

            <Section
              title="Timetable"
              icon={<Clock className="size-4 text-muted-foreground" />}
            >
              {detail.timetableEntries.length === 0 ? (
                <InlineEmpty label="No timetable entries" />
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {detail.timetableEntries.map((entry) => (
                    <div
                      key={entry._id}
                      className="rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={entry.isActive ? "default" : "secondary"}
                        >
                          {DAY_NAMES[entry.dayOfWeek] ?? "Day"}
                        </Badge>
                        <span className="text-sm font-medium">
                          {entry.startTime} - {entry.endTime}
                        </span>
                      </div>
                      <div className="mt-2 truncate text-sm">{entry.title}</div>
                      {entry.place && (
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {entry.place}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          <div className="space-y-4">
            <Section
              title="Gradebook"
              icon={<Award className="size-4 text-muted-foreground" />}
            >
              <CourseGradebookPanel
                assignments={detail.assignments}
                gradeAverage={stats.gradeAverage}
              />
            </Section>

            <Section
              title="Triage Context"
              icon={<ShieldCheck className="size-4 text-muted-foreground" />}
            >
              {course.triageContext.length === 0 ? (
                <InlineEmpty label="No triage context" />
              ) : (
                <div className="space-y-2">
                  {course.triageContext.map((field) => (
                    <div
                      key={field._id}
                      className="rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {field.label}
                        </span>
                        <Badge
                          variant={
                            field.includeInTriage ? "secondary" : "outline"
                          }
                        >
                          {field.includeInTriage ? "triage" : "private"}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {field.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Related Emails"
              icon={<Inbox className="size-4 text-muted-foreground" />}
            >
              {detail.emails.length === 0 ? (
                <InlineEmpty label="No emails matched to this course yet" />
              ) : (
                <div className="space-y-2">
                  {detail.emails.map((email) => (
                    <div
                      key={email._id}
                      className="rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {email.subject}
                        </span>
                        <Badge variant="secondary">{email.category}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">
                          {email.from}
                        </span>
                        <span className="shrink-0">
                          {formatDateTime(email.date)}
                        </span>
                      </div>
                      {email.summary && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {email.summary}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Calendar"
              icon={<CalendarDays className="size-4 text-muted-foreground" />}
            >
              {detail.calendarEvents.length === 0 ? (
                <InlineEmpty label="No linked events" />
              ) : (
                <div className="space-y-2">
                  {detail.calendarEvents.map((event) => (
                    <div
                      key={event._id}
                      className="rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {event.title}
                        </span>
                        <Badge variant="secondary">{event.kind}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {event.isAllDay
                            ? event.calendarDate
                            : formatDateTime(event.date)}
                        </span>
                        {event.place && (
                          <span className="truncate">· {event.place}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Kanban"
              icon={<Kanban className="size-4 text-muted-foreground" />}
            >
              {detail.kanbanBoards.length === 0 ? (
                <InlineEmpty label="No linked boards" />
              ) : (
                <div className="space-y-2">
                  {detail.kanbanBoards.map((board) => (
                    <div
                      key={board._id}
                      className="rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor: board.color ?? "var(--accent)",
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {board.title}
                        </span>
                      </div>
                      <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
                        <span>{board.cardCount} cards</span>
                        <span>{board.dueCardCount} due</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Notes"
              icon={<FileText className="size-4 text-muted-foreground" />}
            >
              {detail.notes.length === 0 ? (
                <InlineEmpty label="No linked notes" />
              ) : (
                <div className="space-y-2">
                  {detail.notes.map((note) => (
                    <button
                      key={note._id}
                      type="button"
                      className="w-full rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                      onClick={() => note.url && onOpenExternal(note.url)}
                    >
                      <div className="truncate text-sm font-medium">
                        {note.title}
                      </div>
                      {note.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {note.tags.slice(0, 4).map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="People"
              icon={<UsersRound className="size-4 text-muted-foreground" />}
            >
              {detail.people.length === 0 ? (
                <InlineEmpty label="No linked people" />
              ) : (
                <div className="space-y-2">
                  {detail.people.map((person) => (
                    <div
                      key={person._id}
                      className="rounded-md border px-3 py-2"
                    >
                      <div className="truncate text-sm font-medium">
                        {person.name}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {[person.email, person.phone, person.website]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Resources"
              icon={<Radio className="size-4 text-muted-foreground" />}
            >
              {detail.resources.length === 0 ? (
                <InlineEmpty label="No linked resources" />
              ) : (
                <div className="space-y-2">
                  {detail.resources.map((resource) => (
                    <button
                      key={resource._id}
                      type="button"
                      className="w-full rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                      onClick={() => onOpenExternal(resource.url)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {resource.name}
                        </span>
                        {resource.isActive ? (
                          <CheckCircle2 className="size-3.5 text-accent" />
                        ) : (
                          <AlertCircle className="size-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {resource.type} · {resource.url}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeBasePath(path = "/admin/dashboard/courses") {
  return path.replace(/\/$/, "");
}

export function CoursesPage({
  routeBasePath = "/admin/dashboard/courses",
  buildEditPath,
}: {
  routeBasePath?: string;
  /** Desktop's static export cannot serve dynamic segments, so it routes
      edits through a query-param page instead of `{basePath}/{id}/edit`. */
  buildEditPath?: (courseId: string) => string;
}) {
  const { client, platform, slots } = useAdmin();
  const router = useRouter();
  const basePath = normalizeBasePath(routeBasePath);

  const [courses, setCourses] = useState<ICourseListItem[]>([]);
  const [detail, setDetail] = useState<ICourseDetail | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ICourse | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const fetchCourses = useCallback(async () => {
    const result = await client.get<{ courses: ICourseListItem[] }>("courses");
    setCourses(result.courses ?? []);
  }, [client]);

  const fetchDetail = useCallback(
    async (courseId: string) => {
      setDetailLoading(true);
      try {
        const result = await client.get<{ detail: ICourseDetail }>(
          `courses/${courseId}`,
        );
        setDetail(result.detail);
      } catch {
        toast.error("Failed to load course");
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    let active = true;
    fetchCourses()
      .catch(() => {
        if (active) toast.error("Failed to load courses");
      })
      .finally(() => {
        if (active) setInitialLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchCourses]);

  useEffect(() => {
    if (!selectedCourseId) {
      setDetail(null);
      return;
    }
    void fetchDetail(selectedCourseId);
  }, [selectedCourseId, fetchDetail]);

  const groupedCourses = useMemo(() => {
    const groups = new Map<string, ICourseListItem[]>();
    for (const item of courses) {
      const key = item.course.semester || "Unscheduled";
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [courses]);

  const openCreate = () => {
    router.push(`${basePath}/new`);
  };

  const openEdit = () => {
    if (!detail) return;
    router.push(
      buildEditPath
        ? buildEditPath(detail.course._id)
        : `${basePath}/${detail.course._id}/edit`,
    );
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsMutating(true);
    try {
      await client.del<{ success: true }>(`courses/${deleteTarget._id}`);
      setDeleteTarget(null);
      setSelectedCourseId(null);
      setDetail(null);
      await fetchCourses();
      toast.success("Course deleted");
    } catch {
      toast.error("Failed to delete course");
    } finally {
      setIsMutating(false);
    }
  };

  if (initialLoading) {
    return <CourseSkeleton />;
  }

  if (selectedCourseId) {
    if (detailLoading || !detail) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-12 items-center gap-2 border-b px-4">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setSelectedCourseId(null)}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
          <div className="grid gap-4 p-4 xl:grid-cols-[1.45fr_0.8fr]">
            <div className="h-80 animate-pulse rounded-md border bg-muted/30" />
            <div className="h-80 animate-pulse rounded-md border bg-muted/30" />
          </div>
        </div>
      );
    }

    return (
      <>
        <CourseHome
          detail={detail}
          onBack={() => setSelectedCourseId(null)}
          onEdit={openEdit}
          onDelete={() => setDeleteTarget(detail.course)}
          onOpenExternal={(url) => platform.openExternal(url)}
          onRefresh={() => fetchDetail(detail.course._id)}
        />
        <DeleteCourseDialog
          deleteTarget={deleteTarget}
          setDeleteTarget={setDeleteTarget}
          onDelete={handleDelete}
          isMutating={isMutating}
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<GraduationCap className="size-4 text-muted-foreground" />}
        title="Courses"
      >
        <Button size="sm" onClick={openCreate}>
          <Plus />
          Add Class
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {courses.length === 0 ? (
          <Empty className="h-full border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GraduationCap />
              </EmptyMedia>
              <EmptyTitle>No courses</EmptyTitle>
              <EmptyDescription>No class home screens yet</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-3.5" />
                Add Class
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-6">
            <SemesterCockpit
              onSelectCourse={setSelectedCourseId}
              reloadSignal={courses.length}
            />
            {groupedCourses.map(([semester, items]) => (
              <section key={semester} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase text-muted-foreground">
                    {semester}
                  </h2>
                  <Separator className="flex-1" />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => (
                    <CourseCard
                      key={item.course._id}
                      item={item}
                      onSelect={() => setSelectedCourseId(item.course._id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <DeleteCourseDialog
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        onDelete={handleDelete}
        isMutating={isMutating}
      />
    </div>
  );
}

function DeleteCourseDialog({
  deleteTarget,
  setDeleteTarget,
  onDelete,
  isMutating,
}: {
  deleteTarget: ICourse | null;
  setDeleteTarget: (course: ICourse | null) => void;
  onDelete: () => Promise<void>;
  isMutating: boolean;
}) {
  return (
    <Dialog
      open={!!deleteTarget}
      onOpenChange={(open) => !open && setDeleteTarget(null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Class</DialogTitle>
          <DialogDescription>
            Delete &quot;{deleteTarget?.name}&quot;? Linked records stay in
            their original tools.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteTarget(null)}
            disabled={isMutating}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onDelete}
            disabled={isMutating}
          >
            {isMutating ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
