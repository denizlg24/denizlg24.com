"use client";

import type {
  ICourse,
  ICourseEmailPage,
  ICourseEmailRelinkResult,
  ICourseEmailSummary,
  ICourseListItem,
  IFullEmail,
  TriageCategory,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Separator } from "@repo/ui/separator";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import {
  ArrowLeft,
  Link2Off,
  Loader2,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmailIframe } from "../inbox/email-iframe";
import { useAdmin } from "../provider";
import {
  CATEGORY_LABELS,
  CategoryLabel,
  TRIAGE_CATEGORIES,
} from "../triage/category-meta";

const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 250;

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

/** "Prof. Almeida <a@b.pt>" reads as the name alone in a dense column. */
function senderName(from: string) {
  const angle = from.indexOf("<");
  const name = angle > 0 ? from.slice(0, angle).trim() : from.trim();
  return name.replace(/^"|"$/g, "") || from;
}

/**
 * A course email takes over the whole course view rather than opening a rail:
 * the bodies are real mail — quoted threads, tables, attachments listed in the
 * HTML — and a 2xl sheet reflowed all of it into a column.
 */
export function CourseEmailReader({
  email,
  onBack,
}: {
  email: ICourseEmailSummary;
  onBack: () => void;
}) {
  const { client } = useAdmin();
  const [full, setFull] = useState<IFullEmail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFull(null);
    client
      .get<{ email: IFullEmail }>(
        `email-accounts/${email.accountId}/emails/${email.emailId}`,
      )
      .then((result) => {
        if (active) setFull(result.email);
      })
      .catch(() => {
        if (active) toast.error("Failed to load email");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [email.accountId, email.emailId, client]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onBack]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon" className="size-7" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {senderName(email.from)}
        </span>
        <CategoryLabel category={email.category} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-4 py-5 sm:px-8 sm:py-6">
          <h1 className="text-lg font-semibold leading-snug sm:text-xl">
            {email.subject || "(No subject)"}
          </h1>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{email.from}</span>
            <span className="tabular-nums">{formatDateTime(email.date)}</span>
          </div>

          {email.summary && (
            <p className="mt-4 text-sm leading-relaxed">{email.summary}</p>
          )}

          <Separator className="my-5" />

          {loading ? (
            <div className="flex items-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading
            </div>
          ) : full?.htmlBody ? (
            <EmailIframe html={full.htmlBody} />
          ) : full?.textBody ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {full.textBody}
            </pre>
          ) : (
            <p className="py-8 text-xs text-muted-foreground">No body</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The course match is a model verdict, so every row needs a way out of it.
 * Moving also repoints whatever the match produced downstream — see
 * `relinkCourseEmails`.
 */
function RelinkMenu({
  courses,
  currentCourseId,
  loading,
  busy,
  onOpen,
  onSelect,
}: {
  courses: ICourse[] | null;
  currentCourseId: string;
  loading: boolean;
  busy: boolean;
  onOpen: () => void;
  onSelect: (course: ICourse | null) => void;
}) {
  const targets = (courses ?? []).filter(
    (course) => course._id !== currentCourseId,
  );

  return (
    // Radix portals keep the React tree, so this covers the menu content too
    // and a click in it never reaches the row's open handler.
    <div
      className="flex justify-end"
      onClick={(event) => event.stopPropagation()}
    >
      <DropdownMenu onOpenChange={(open) => open && onOpen()}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MoreHorizontal className="size-3.5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">
              Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
              {loading && targets.length === 0 ? (
                <DropdownMenuItem disabled className="text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading
                </DropdownMenuItem>
              ) : targets.length === 0 ? (
                <DropdownMenuItem disabled className="text-xs">
                  No other courses
                </DropdownMenuItem>
              ) : (
                targets.map((course) => (
                  <DropdownMenuItem
                    key={course._id}
                    className="text-xs"
                    onSelect={() => onSelect(course)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {course.name}
                    </span>
                    {course.code && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {course.code}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="text-xs"
            onSelect={() => onSelect(null)}
          >
            <Link2Off className="size-3.5" />
            Unlink
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Related mail, paged from the server.
 *
 * It used to be a stack of bordered blocks inside the detail rail, capped at 50
 * rows with nothing on screen saying so, and shipped in full on every course
 * open. Here it is fetched only when the tab is opened, and the whole history
 * is reachable.
 *
 * Search and the category filter are wired to the query, not to
 * `PaginatedDataTable`'s built-in toolbar: that one filters `data`, which under
 * manual pagination is a single page, so it would narrow 25 visible rows while
 * the total kept claiming hundreds.
 */
export function CourseMailPanel({
  courseId,
  onOpenEmail,
  onRefresh,
}: {
  courseId: string;
  onOpenEmail: (email: ICourseEmailSummary) => void;
  /** A relink changes the course's mail count, which lives on the tab. */
  onRefresh: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [page, setPage] = useState<ICourseEmailPage>({ emails: [], total: 0 });
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TriageCategory | "all">("all");
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<ICourse[] | null>(null);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [relinking, setRelinking] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => setSearch(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchInput]);

  // A narrowed result is usually shorter than the page you were on. Without
  // this you land on page 8 of a one-page result and see nothing.
  const narrowing = `${search}|${category}`;
  const lastNarrowing = useRef(narrowing);
  useEffect(() => {
    if (lastNarrowing.current === narrowing) return;
    lastNarrowing.current = narrowing;
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [narrowing]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.pageIndex),
        pageSize: String(pagination.pageSize),
      });
      if (search) params.set("q", search);
      if (category !== "all") params.set("category", category);
      const result = await client.get<ICourseEmailPage>(
        `courses/${courseId}/emails?${params.toString()}`,
      );
      setPage(result);
    } catch {
      toast.error("Failed to load course mail");
    } finally {
      setLoading(false);
    }
  }, [
    client,
    courseId,
    pagination.pageIndex,
    pagination.pageSize,
    search,
    category,
  ]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  // Only when a menu is opened: the roster is irrelevant until something is
  // being moved, and the tab already costs one request on open.
  const loadCourses = useCallback(() => {
    if (courses || coursesLoading) return;
    setCoursesLoading(true);
    client
      .get<{ courses: ICourseListItem[] }>("courses")
      // The roster ships each course wrapped in its stats and next deadline;
      // the picker wants the course itself.
      .then((result) => setCourses(result.courses.map((item) => item.course)))
      .catch(() => toast.error("Failed to load courses"))
      .finally(() => setCoursesLoading(false));
  }, [client, courses, coursesLoading]);

  const relink = useCallback(
    async (triageId: string, target: ICourse | null) => {
      setRelinking(triageId);
      try {
        const result = await client.patch<ICourseEmailRelinkResult>(
          `courses/${courseId}/emails`,
          { triageIds: [triageId], courseId: target?._id ?? null },
        );
        if (result.moved === 0) {
          toast.error("Email is no longer on this course");
        } else {
          toast.success(target ? `Moved to ${target.name}` : "Unlinked");
        }
        await Promise.all([fetchPage(), onRefresh()]);
      } catch {
        toast.error(target ? "Failed to move email" : "Failed to unlink email");
      } finally {
        setRelinking(null);
      }
    },
    [client, courseId, fetchPage, onRefresh],
  );

  const columns = useMemo<ColumnDef<ICourseEmailSummary, unknown>[]>(
    () => [
      {
        accessorKey: "date",
        header: "Date",
        meta: { className: "w-32" },
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatDateTime(row.original.date)}
          </span>
        ),
      },
      {
        accessorKey: "from",
        header: "From",
        meta: { className: "hidden md:table-cell" },
        cell: ({ row }) => (
          <span className="block max-w-40 truncate text-muted-foreground xl:max-w-56">
            {senderName(row.original.from)}
          </span>
        ),
      },
      {
        accessorKey: "subject",
        header: "Subject",
        cell: ({ row }) => (
          <span className="block max-w-64 truncate font-medium xl:max-w-128">
            {row.original.subject}
          </span>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        meta: { className: "w-36" },
        cell: ({ row }) => <CategoryLabel category={row.original.category} />,
      },
      {
        id: "actions",
        header: "",
        meta: { className: "w-10" },
        cell: ({ row }) => (
          <RelinkMenu
            courses={courses}
            currentCourseId={courseId}
            loading={coursesLoading}
            busy={relinking === row.original.triageId}
            onOpen={loadCourses}
            onSelect={(target) => void relink(row.original.triageId, target)}
          />
        ),
      },
    ],
    [courses, courseId, coursesLoading, relinking, loadCourses, relink],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search subject or sender..."
            className="h-8 w-64 max-w-full pl-7 text-xs"
          />
        </div>
        <Select
          value={category}
          onValueChange={(value) =>
            setCategory(value as TriageCategory | "all")
          }
        >
          <SelectTrigger size="sm" className="w-36 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all" className="text-xs">
              All categories
            </SelectItem>
            {TRIAGE_CATEGORIES.map((value) => (
              <SelectItem key={value} value={value} className="text-xs">
                {CATEGORY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <PaginatedDataTable
        columns={columns}
        data={page.emails}
        emptyMessage="No mail matched to this course"
        onRowClick={onOpenEmail}
        manualPagination={{
          pageIndex: pagination.pageIndex,
          pageSize: pagination.pageSize,
          totalRows: page.total,
          loading,
          onPaginationChange: setPagination,
        }}
      />
    </div>
  );
}
