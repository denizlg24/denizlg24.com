"use client";

import type {
  ICourse,
  ICourseDeadline,
  ICourseDetail,
  ICourseEmailSummary,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import {
  type Crumb,
  Page,
  PageBody,
  PageHeader,
  PageToolbar,
} from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Stat, StatGroup } from "@repo/ui/stat";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Home,
  Link as LinkIcon,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { CourseGradebookPanel, CourseWorkPanel } from "./course-assignments";
import { CourseEmailReader, CourseMailPanel } from "./course-mail";
import {
  BOARD_STATUSES,
  STATUS_BAR,
  STATUS_LABELS,
  STATUS_TONE,
  summariseByStatus,
} from "./coursework-status";
import {
  CockpitSkeleton,
  CourseDot,
  formatPercent,
  SemesterCockpit,
  StandingBar,
} from "./semester-cockpit";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CourseTab = "overview" | "work" | "grades" | "mail" | "linked";

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
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

function None() {
  return <p className="text-sm text-muted-foreground">—</p>;
}

function DeadlineLine({ deadline }: { deadline: ICourseDeadline }) {
  return (
    <ListRow
      leading={
        <span
          className={cn(
            "size-1.5 rounded-full",
            deadline.overdue ? "bg-status-critical" : "bg-accent-strong/60",
          )}
        />
      }
      title={deadline.title}
      meta={
        <>
          <span className="hidden sm:inline">
            {deadline.sourceLabel ?? deadline.source}
          </span>
          <span className={cn(deadline.overdue && "text-status-critical")}>
            {formatDateTime(deadline.dueAt)}
          </span>
        </>
      }
    />
  );
}

function CourseChrome({
  crumbs,
  icon,
  title,
  actions,
  toolbar,
  children,
}: {
  crumbs?: Crumb[];
  icon: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const { slots } = useAdmin();
  return (
    <Page className="relative">
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={crumbs}
        icon={icon}
        title={title}
      >
        {actions}
      </PageHeader>
      {toolbar ? <PageToolbar>{toolbar}</PageToolbar> : null}
      <PageBody width="wide">{children}</PageBody>
    </Page>
  );
}

function CourseHome({
  detail,
  onBack,
  onEdit,
  onDelete,
  deleting,
  onOpenExternal,
  onRefresh,
}: {
  detail: ICourseDetail;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  deleting: boolean;
  onOpenExternal: (url: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { course, stats, projection } = detail;
  const openDeadlines = detail.deadlines.filter(
    (deadline) => !deadline.completed,
  );
  const dateRange = courseDates(course);
  const workByStatus = summariseByStatus(detail.assignments);
  const hasProjection =
    projection.worstCase !== null && projection.bestCase !== null;
  const [tab, setTab] = useState<CourseTab>("overview");
  const [openEmail, setOpenEmail] = useState<ICourseEmailSummary | null>(null);
  const hasAbout = Boolean(
    course.description ||
      course.location ||
      course.homepageUrl ||
      course.links.length > 0 ||
      course.customFields.length > 0,
  );

  return (
    <CourseChrome
      crumbs={[{ label: "Courses", onClick: onBack }]}
      icon={<CourseDot color={course.color} />}
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{course.name}</span>
          {course.code && (
            <Badge variant="outline" className="hidden sm:inline-flex">
              {course.code}
            </Badge>
          )}
        </span>
      }
      actions={
        <>
          {course.homepageUrl && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenExternal(course.homepageUrl ?? "")}
              aria-label="Homepage"
            >
              <Home />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label="Edit"
          >
            <Pencil />
          </Button>
          <ConfirmButton
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            }
            title={`Delete "${course.name}"?`}
            description="Linked records stay in their own tools."
            actionLabel="Delete"
            destructive
            pending={deleting}
            onConfirm={onDelete}
          />
        </>
      }
      toolbar={
        <>
          <FilterTabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "work", label: "Work", count: stats.openDeadlines },
              {
                value: "grades",
                label: "Grades",
                count: stats.gradedAssessments,
              },
              { value: "mail", label: "Mail", count: stats.emails },
              { value: "linked", label: "Linked" },
            ]}
            className="min-w-0 overflow-x-auto"
          />
          <span className="ml-auto hidden truncate text-xs text-muted-foreground md:inline">
            {[course.semester, course.instructorName, dateRange]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </>
      }
    >
      {tab === "overview" && (
        <>
          <StatGroup>
            <Stat label="Average" value={formatPercent(stats.gradeAverage)} />
            <Stat label="Open work" value={stats.openAssessments} />
            <Stat
              label="Overdue"
              value={stats.overdue}
              tone={stats.overdue > 0 ? "critical" : "default"}
            />
            <Stat label="Graded" value={stats.gradedAssessments} />
            <Stat label="Readings" value={stats.openReadings} />
          </StatGroup>

          {/* Where the open work stands: "Open work: 7" cannot tell seven rows
              not started from seven half-finished ones. */}
          {workByStatus.total > 0 && (
            <Section title="Progress" count={workByStatus.total}>
              <div className="flex h-1 w-full overflow-hidden rounded-full bg-border">
                {BOARD_STATUSES.map((status) =>
                  workByStatus.counts[status] > 0 ? (
                    <div
                      key={status}
                      className={STATUS_BAR[status]}
                      style={{
                        width: `${(workByStatus.counts[status] / workByStatus.total) * 100}%`,
                      }}
                    />
                  ) : null,
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {BOARD_STATUSES.map((status) => (
                  <span
                    key={status}
                    className="flex items-baseline gap-1.5 text-xs"
                  >
                    <span className={STATUS_TONE[status]}>
                      {STATUS_LABELS[status]}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {workByStatus.counts[status]}
                    </span>
                  </span>
                ))}
              </div>
            </Section>
          )}

          <div className="grid gap-8 xl:grid-cols-[1.4fr_1fr]">
            <div className="flex min-w-0 flex-col gap-8">
              {hasProjection && (
                <Section title="Standing">
                  <StandingBar
                    worstCase={projection.worstCase}
                    bestCase={projection.bestCase}
                    remainingWeight={projection.remainingWeight}
                    color={course.color}
                  />
                </Section>
              )}

              <Section title="Next up" count={openDeadlines.length}>
                {openDeadlines.length === 0 ? (
                  <None />
                ) : (
                  <List>
                    {openDeadlines.slice(0, 8).map((deadline) => (
                      <DeadlineLine key={deadline._id} deadline={deadline} />
                    ))}
                  </List>
                )}
              </Section>
            </div>

            <div className="flex min-w-0 flex-col gap-8">
              {detail.timetableEntries.length > 0 && (
                <Section
                  title="Schedule"
                  count={detail.timetableEntries.length}
                >
                  <List>
                    {detail.timetableEntries.map((entry) => (
                      <ListRow
                        key={entry._id}
                        title={entry.title}
                        description={entry.place || undefined}
                        meta={`${DAY_NAMES[entry.dayOfWeek] ?? ""} ${entry.startTime}–${entry.endTime}`}
                      />
                    ))}
                  </List>
                </Section>
              )}

              {hasAbout && (
                <Section title="About">
                  {course.description && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {course.description}
                    </p>
                  )}
                  {(course.customFields.length > 0 || course.location) && (
                    <Properties>
                      {course.location && (
                        <Property icon={<MapPin />} label="Location">
                          {course.location}
                        </Property>
                      )}
                      {course.customFields.map((field) => (
                        <Property key={field._id} label={field.label}>
                          <span className="block truncate">{field.value}</span>
                        </Property>
                      ))}
                    </Properties>
                  )}
                  {(course.homepageUrl || course.links.length > 0) && (
                    <List>
                      {course.homepageUrl && (
                        <ListRow
                          leading={<ExternalLink />}
                          title="Homepage"
                          description={course.homepageUrl}
                          onClick={() =>
                            onOpenExternal(course.homepageUrl ?? "")
                          }
                        />
                      )}
                      {course.links.map((link) => (
                        <ListRow
                          key={link._id}
                          leading={<LinkIcon />}
                          title={link.label}
                          description={link.url}
                          onClick={() => onOpenExternal(link.url)}
                        />
                      ))}
                    </List>
                  )}
                </Section>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "work" && (
        <CourseWorkPanel
          courseId={course._id}
          assignments={detail.assignments}
          deadlines={detail.deadlines}
          kanbanCards={detail.kanbanCards}
          readings={detail.readings}
          onRefresh={onRefresh}
        />
      )}

      {tab === "grades" && (
        <CourseGradebookPanel
          assignments={detail.assignments}
          gradeAverage={stats.gradeAverage}
          projection={projection}
        />
      )}

      {tab === "mail" && (
        <CourseMailPanel
          courseId={course._id}
          onOpenEmail={setOpenEmail}
          onRefresh={onRefresh}
        />
      )}

      {tab === "linked" && (
        <>
          <Section title="Calendar" count={detail.calendarEvents.length}>
            {detail.calendarEvents.length === 0 ? (
              <None />
            ) : (
              <List>
                {detail.calendarEvents.map((event) => (
                  <ListRow
                    key={event._id}
                    title={event.title}
                    description={event.place || event.kind}
                    meta={
                      event.isAllDay
                        ? event.calendarDate
                        : formatDateTime(event.date)
                    }
                  />
                ))}
              </List>
            )}
          </Section>

          <Section title="Boards" count={detail.kanbanBoards.length}>
            {detail.kanbanBoards.length === 0 ? (
              <None />
            ) : (
              <List>
                {detail.kanbanBoards.map((board) => (
                  <ListRow
                    key={board._id}
                    title={board.title}
                    meta={`${board.cardCount} cards · ${board.dueCardCount} due`}
                  />
                ))}
              </List>
            )}
          </Section>

          <Section title="Notes" count={detail.notes.length}>
            {detail.notes.length === 0 ? (
              <None />
            ) : (
              <List>
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
              </List>
            )}
          </Section>

          <Section title="People" count={detail.people.length}>
            {detail.people.length === 0 ? (
              <None />
            ) : (
              <List>
                {detail.people.map((person) => (
                  <ListRow
                    key={person._id}
                    title={person.name}
                    meta={person.email ?? person.phone}
                  />
                ))}
              </List>
            )}
          </Section>

          <Section title="Resources" count={detail.resources.length}>
            {detail.resources.length === 0 ? (
              <None />
            ) : (
              <List>
                {detail.resources.map((resource) => (
                  <ListRow
                    key={resource._id}
                    leading={
                      resource.isActive ? (
                        <CheckCircle2 className="size-3.5 text-status-good" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                      )
                    }
                    title={resource.name}
                    meta={resource.type}
                    onClick={() => onOpenExternal(resource.url)}
                  />
                ))}
              </List>
            )}
          </Section>

          <Section title="Triage context" count={course.triageContext.length}>
            {course.triageContext.length === 0 ? (
              <None />
            ) : (
              <Properties>
                {course.triageContext.map((field) => (
                  <Property key={field._id} label={field.label}>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {field.value}
                      </span>
                      <Badge
                        variant={field.includeInTriage ? "info" : "outline"}
                      >
                        {field.includeInTriage ? "Triage" : "Private"}
                      </Badge>
                    </span>
                  </Property>
                ))}
              </Properties>
            )}
          </Section>
        </>
      )}

      {openEmail && (
        <div className="absolute inset-0 z-20">
          <CourseEmailReader
            email={openEmail}
            onBack={() => setOpenEmail(null)}
          />
        </div>
      )}
    </CourseChrome>
  );
}

/**
 * The course roster, and one course's home when the URL names one.
 *
 * The selected course used to be local state, which is why nothing could be
 * linked to, restored on reload or opened from the agent. It comes from the
 * host's route now: a path segment on web, a query parameter on desktop, both
 * resolved by `routes.courses.detail`.
 */
export function CoursesPage({ courseId }: { courseId?: string }) {
  const { client, platform, routes } = useAdmin();
  const router = useRouter();

  const [detail, setDetail] = useState<ICourseDetail | null>(null);
  const selectedCourseId = courseId ?? null;
  const selectCourse = useCallback(
    (id: string | null) => {
      router.push(id ? routes.courses.detail(id) : routes.courses.root);
    },
    [router, routes],
  );
  const [detailLoading, setDetailLoading] = useState(false);
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
    router.push(routes.courses.new);
  };

  const openEdit = () => {
    if (!detail) return;
    router.push(routes.courses.edit(detail.course._id));
  };

  const handleDelete = async (course: ICourse) => {
    setIsMutating(true);
    try {
      await client.del<{ success: true }>(`courses/${course._id}`);
      setDetail(null);
      selectCourse(null);
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
        <CourseChrome
          crumbs={[{ label: "Courses", onClick: () => selectCourse(null) }]}
          icon={<GraduationCap />}
          title={<Skeleton className="h-4 w-48" />}
        >
          <CockpitSkeleton />
        </CourseChrome>
      );
    }

    return (
      <CourseHome
        key={detail.course._id}
        detail={detail}
        onBack={() => selectCourse(null)}
        onEdit={openEdit}
        onDelete={() => handleDelete(detail.course)}
        deleting={isMutating}
        onOpenExternal={(url) => platform.openExternal(url)}
        onRefresh={() => fetchDetail(detail.course._id)}
      />
    );
  }

  return (
    <CourseChrome
      icon={<GraduationCap />}
      title="Courses"
      actions={
        <Button size="sm" onClick={openCreate}>
          <Plus />
          Add
        </Button>
      }
    >
      {isEmpty && !listLoading ? (
        <EmptyState
          icon={<GraduationCap />}
          label="No courses"
          action={
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus />
              Add
            </Button>
          }
        />
      ) : (
        <SemesterCockpit
          onSelectCourse={selectCourse}
          reloadSignal={reloadSignal}
          onEmpty={handleEmpty}
        />
      )}
    </CourseChrome>
  );
}
