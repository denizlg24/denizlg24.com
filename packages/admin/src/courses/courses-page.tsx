"use client";

import type {
  ICourse,
  ICourseDeadline,
  ICourseDetail,
  ICourseEmailSummary,
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
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/empty";
import { PageHeader } from "@repo/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { cn } from "@repo/ui/utils";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Home,
  Link as LinkIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { CourseGradebookPanel, CourseWorkPanel } from "./course-assignments";
import { CourseEmailReader, CourseMailPanel } from "./course-mail";
import { CourseDot, SectionHeading, SemesterCockpit } from "./semester-cockpit";

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

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(1)}%`;
}

function Stat({
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

function ListRow({
  title,
  meta,
  trailing,
  trailingTone,
  onClick,
}: {
  title: string;
  meta?: string;
  trailing?: string;
  trailingTone?: "muted" | "destructive";
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      {meta && (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
          {meta}
        </span>
      )}
      {trailing && (
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums",
            trailingTone === "destructive"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {trailing}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 border-b border-border/60 px-2 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5 border-b border-border/60 py-2 last:border-b-0">
      {content}
    </div>
  );
}

function EmptyLine() {
  return <p className="py-4 text-sm text-muted-foreground">—</p>;
}

function DeadlineLine({ deadline }: { deadline: ICourseDeadline }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border/60 py-2 last:border-b-0">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          deadline.overdue ? "bg-destructive" : "bg-accent",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{deadline.title}</span>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
        {deadline.sourceLabel ?? deadline.source}
      </span>
      <span
        className={cn(
          "shrink-0 text-[11px] tabular-nums",
          deadline.overdue ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {formatDateTime(deadline.dueAt)}
      </span>
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
  const { course, stats, projection } = detail;
  const openDeadlines = detail.deadlines.filter(
    (deadline) => !deadline.completed,
  );
  const dateRange = courseDates(course);
  const hasProjection =
    projection.worstCase !== null && projection.bestCase !== null;
  const [openEmail, setOpenEmail] = useState<ICourseEmailSummary | null>(null);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon" className="size-7" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <CourseDot color={course.color} />
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
            aria-label="Homepage"
          >
            <Home className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onEdit}
          aria-label="Edit"
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          onClick={onDelete}
          aria-label="Delete"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Tabs
        defaultValue="overview"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList
          variant="line"
          className="shrink-0 justify-start overflow-x-auto px-4"
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="work">
            Work
            <span className="ml-1 tabular-nums text-muted-foreground">
              {stats.openDeadlines}
            </span>
          </TabsTrigger>
          <TabsTrigger value="grades">
            Grades
            <span className="ml-1 tabular-nums text-muted-foreground">
              {stats.gradedAssessments}
            </span>
          </TabsTrigger>
          <TabsTrigger value="mail">
            Mail
            <span className="ml-1 tabular-nums text-muted-foreground">
              {stats.emails}
            </span>
          </TabsTrigger>
          <TabsTrigger value="linked">Linked</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="overview" className="space-y-8">
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <Stat label="Average" value={formatPercent(stats.gradeAverage)} />
              <Stat label="Open work" value={stats.openAssessments} />
              <Stat
                label="Overdue"
                value={stats.overdue}
                alert={stats.overdue > 0}
              />
              <Stat label="Graded" value={stats.gradedAssessments} />
              <Stat label="Readings" value={stats.openReadings} />
            </div>

            {hasProjection && (
              <section className="space-y-2">
                <SectionHeading title="Standing" meta="secured vs best case" />
                <div className="relative h-px w-full bg-border">
                  <div
                    className="absolute inset-y-0 left-0 h-px bg-muted-foreground/40"
                    style={{
                      width: `${Math.min(100, projection.bestCase ?? 0)}%`,
                    }}
                  />
                  <div
                    className="absolute -top-px left-0 h-[3px]"
                    style={{
                      width: `${Math.min(100, projection.worstCase ?? 0)}%`,
                      backgroundColor: course.color ?? "var(--accent)",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    secured {formatPercent(projection.worstCase)}
                  </span>
                  <span className="tabular-nums">
                    {formatPercent(projection.remainingWeight)} open · best{" "}
                    {formatPercent(projection.bestCase)}
                  </span>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <SectionHeading
                title="Next up"
                meta={`${openDeadlines.length} open`}
              />
              {openDeadlines.length === 0 ? (
                <EmptyLine />
              ) : (
                <div>
                  {openDeadlines.slice(0, 6).map((deadline) => (
                    <DeadlineLine key={deadline._id} deadline={deadline} />
                  ))}
                </div>
              )}
            </section>

            {detail.timetableEntries.length > 0 && (
              <section className="space-y-2">
                <SectionHeading title="Schedule" />
                <div>
                  {detail.timetableEntries.map((entry) => (
                    <ListRow
                      key={entry._id}
                      title={entry.title}
                      meta={entry.place}
                      trailing={`${DAY_NAMES[entry.dayOfWeek] ?? ""} ${entry.startTime}-${entry.endTime}`}
                    />
                  ))}
                </div>
              </section>
            )}

            {(course.description ||
              course.location ||
              course.homepageUrl ||
              course.links.length > 0 ||
              course.customFields.length > 0) && (
              <section className="space-y-3">
                <SectionHeading title="About" />
                {course.description && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {course.description}
                  </p>
                )}
                {course.customFields.length > 0 && (
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
                    {course.customFields.map((field) => (
                      <div
                        key={field._id}
                        className="flex items-baseline gap-3 border-b border-border/60 py-1.5"
                      >
                        <dt className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {field.label}
                        </dt>
                        <dd className="min-w-0 flex-1 truncate text-right text-sm">
                          {field.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {(course.location ||
                  course.homepageUrl ||
                  course.links.length > 0) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {course.location && (
                      <span className="text-muted-foreground">
                        {course.location}
                      </span>
                    )}
                    {course.homepageUrl && (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 hover:underline"
                        onClick={() => onOpenExternal(course.homepageUrl ?? "")}
                      >
                        <ExternalLink className="size-3" />
                        Homepage
                      </button>
                    )}
                    {course.links.map((link) => (
                      <button
                        key={link._id}
                        type="button"
                        className="flex items-center gap-1.5 hover:underline"
                        onClick={() => onOpenExternal(link.url)}
                      >
                        <LinkIcon className="size-3" />
                        {link.label}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </TabsContent>

          <TabsContent value="work">
            <CourseWorkPanel
              courseId={course._id}
              assignments={detail.assignments}
              deadlines={detail.deadlines}
              kanbanCards={detail.kanbanCards}
              readings={detail.readings}
              onOpenExternal={onOpenExternal}
              onRefresh={onRefresh}
            />
          </TabsContent>

          <TabsContent value="grades">
            <CourseGradebookPanel
              assignments={detail.assignments}
              gradeAverage={stats.gradeAverage}
              projection={projection}
            />
          </TabsContent>

          <TabsContent value="mail">
            <CourseMailPanel
              courseId={course._id}
              onOpenEmail={setOpenEmail}
              onRefresh={onRefresh}
            />
          </TabsContent>

          <TabsContent value="linked" className="space-y-8">
            <section className="space-y-2">
              <SectionHeading
                title="Calendar"
                meta={String(detail.calendarEvents.length)}
              />
              {detail.calendarEvents.length === 0 ? (
                <EmptyLine />
              ) : (
                <div>
                  {detail.calendarEvents.map((event) => (
                    <ListRow
                      key={event._id}
                      title={event.title}
                      meta={event.place ?? event.kind}
                      trailing={
                        event.isAllDay
                          ? event.calendarDate
                          : formatDateTime(event.date)
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeading
                title="Boards"
                meta={String(detail.kanbanBoards.length)}
              />
              {detail.kanbanBoards.length === 0 ? (
                <EmptyLine />
              ) : (
                <div>
                  {detail.kanbanBoards.map((board) => (
                    <ListRow
                      key={board._id}
                      title={board.title}
                      trailing={`${board.cardCount} cards · ${board.dueCardCount} due`}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeading
                title="Notes"
                meta={String(detail.notes.length)}
              />
              {detail.notes.length === 0 ? (
                <EmptyLine />
              ) : (
                <div>
                  {detail.notes.map((note) => (
                    <ListRow
                      key={note._id}
                      title={note.title}
                      meta={note.tags.slice(0, 3).join(" · ") || undefined}
                      onClick={
                        note.url
                          ? () => onOpenExternal(note.url ?? "")
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeading
                title="People"
                meta={String(detail.people.length)}
              />
              {detail.people.length === 0 ? (
                <EmptyLine />
              ) : (
                <div>
                  {detail.people.map((person) => (
                    <ListRow
                      key={person._id}
                      title={person.name}
                      trailing={person.email ?? person.phone}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeading
                title="Resources"
                meta={String(detail.resources.length)}
              />
              {detail.resources.length === 0 ? (
                <EmptyLine />
              ) : (
                <div>
                  {detail.resources.map((resource) => (
                    <button
                      key={resource._id}
                      type="button"
                      onClick={() => onOpenExternal(resource.url)}
                      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 border-b border-border/60 px-2 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                    >
                      {resource.isActive ? (
                        <CheckCircle2 className="size-3 shrink-0 text-accent" />
                      ) : (
                        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {resource.name}
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                        {resource.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeading
                title="Triage context"
                meta={String(course.triageContext.length)}
              />
              {course.triageContext.length === 0 ? (
                <EmptyLine />
              ) : (
                <div>
                  {course.triageContext.map((field) => (
                    <ListRow
                      key={field._id}
                      title={field.label}
                      meta={field.value}
                      trailing={field.includeInTriage ? "triage" : "private"}
                    />
                  ))}
                </div>
              )}
            </section>
          </TabsContent>
        </div>
      </Tabs>

      {openEmail && (
        <div className="absolute inset-0 z-20">
          <CourseEmailReader
            email={openEmail}
            onBack={() => setOpenEmail(null)}
          />
        </div>
      )}
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

  const [detail, setDetail] = useState<ICourseDetail | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ICourse | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  // The roster and the cockpit are one fetch now, so emptiness is reported up
  // rather than derived from a second list request.
  const [isEmpty, setIsEmpty] = useState(false);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [listLoading, setListLoading] = useState(true);

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
    if (!selectedCourseId) {
      setDetail(null);
      return;
    }
    void fetchDetail(selectedCourseId);
  }, [selectedCourseId, fetchDetail]);

  const handleEmpty = useCallback((empty: boolean) => {
    setIsEmpty(empty);
    setListLoading(false);
  }, []);

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
      setReloadSignal((signal) => signal + 1);
      toast.success("Course deleted");
    } catch {
      toast.error("Failed to delete course");
    } finally {
      setIsMutating(false);
    }
  };

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
          <div className="space-y-6 p-4">
            <div className="flex gap-10">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <div className="h-5 w-12 animate-pulse rounded bg-muted" />
                  <div className="h-2 w-16 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-3 w-full animate-pulse rounded bg-muted"
              />
            ))}
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
        {isEmpty && !listLoading ? (
          <Empty className="h-full border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GraduationCap />
              </EmptyMedia>
              <EmptyTitle>No courses</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-3.5" />
                Add Class
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <SemesterCockpit
            onSelectCourse={setSelectedCourseId}
            reloadSignal={reloadSignal}
            onEmpty={handleEmpty}
          />
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
