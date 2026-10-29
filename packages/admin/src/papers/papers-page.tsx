"use client";

import type {
  INoteGroup,
  IPaper,
  PaperCourseRef,
  PaperFile,
  PaperMutation,
  PaperNoteRef,
  PaperReadingStatus,
  PaperType,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Meter } from "@repo/ui/meter";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import { Spinner } from "@repo/ui/spinner";
import { Stat, StatGroup } from "@repo/ui/stat";
import { FilterTabs, SearchField, ToolbarSpacer } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  BookOpen,
  Download,
  FileText,
  GraduationCap,
  Highlighter,
  Link2,
  Plus,
  Quote,
  Shapes,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { PaperDetail } from "./paper-detail";
import { PaperFormDialog } from "./paper-form-dialog";
import {
  byReadingRecency,
  dueLabel,
  isOverdue,
  READING_STATUS_LABEL,
  readingPercent,
} from "./reading";

const READING_STATUSES: PaperReadingStatus[] = ["unread", "reading", "read"];

export interface PapersResponse {
  papers: IPaper[];
  notes: PaperNoteRef[];
  courses: PaperCourseRef[];
  groups: INoteGroup[];
}

type StatusFilter = "all" | PaperReadingStatus;

const STATUS_BADGE: Record<PaperReadingStatus, "secondary" | "info" | "good"> =
  {
    unread: "secondary",
    reading: "info",
    read: "good",
  };
type TypeFilter = "all" | PaperType;
type PdfFilter = "all" | "with-pdf" | "missing-pdf";
type CourseFilter = "all" | "none" | string;
type LibraryFilter = "all" | "citable" | "reading-only";

export function PapersPage() {
  const { client, platform, slots } = useAdmin();
  const [papers, setPapers] = useState<IPaper[]>([]);
  const [notes, setNotes] = useState<PaperNoteRef[]>([]);
  const [courses, setCourses] = useState<PaperCourseRef[]>([]);
  const [groups, setGroups] = useState<INoteGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [pdfFilter, setPdfFilter] = useState<PdfFilter>("all");
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("all");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<IPaper | null>(null);
  const [deleting, setDeleting] = useState<IPaper | null>(null);
  const [dropping, setDropping] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await client.get<PapersResponse>("papers");
      setPapers(result.papers);
      setNotes(result.notes);
      setCourses(result.courses ?? []);
      setGroups(result.groups ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load readings",
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const paperId = new URLSearchParams(window.location.search).get("paper");
    if (!paperId || papers.length === 0) return;
    if (papers.some((paper) => paper._id === paperId)) setSelectedId(paperId);
  }, [papers]);

  const visiblePapers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return papers.filter((paper) => {
      if (status !== "all" && paper.readingStatus !== status) return false;
      if (type !== "all" && paper.type !== type) return false;
      if (pdfFilter === "with-pdf" && !paper.pdf) return false;
      if (pdfFilter === "missing-pdf" && paper.pdf) return false;
      if (libraryFilter === "citable" && !paper.citable) return false;
      if (libraryFilter === "reading-only" && paper.citable) return false;
      if (courseFilter === "none" && paper.courseIds.length > 0) return false;
      if (
        courseFilter !== "all" &&
        courseFilter !== "none" &&
        !paper.courseIds.includes(courseFilter)
      ) {
        return false;
      }
      if (!needle) return true;
      const searchable = [
        paper.title,
        paper.abstract,
        paper.venue,
        paper.doi,
        paper.arxivId,
        paper.citationKey,
        ...paper.tags,
        ...paper.authors.flatMap((author) => [
          author.literal,
          author.given,
          author.family,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(needle);
    });
  }, [courseFilter, libraryFilter, papers, pdfFilter, query, status, type]);

  const continueReading = useMemo(
    () =>
      papers
        .filter((paper) => paper.readingStatus === "reading")
        .sort(byReadingRecency)
        .slice(0, 4),
    [papers],
  );

  const selectedPaper = papers.find((paper) => paper._id === selectedId);

  const filtersActive =
    Boolean(query) ||
    status !== "all" ||
    type !== "all" ||
    pdfFilter !== "all" ||
    courseFilter !== "all" ||
    libraryFilter !== "all";

  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setType("all");
    setPdfFilter("all");
    setCourseFilter("all");
    setLibraryFilter("all");
  };

  const createPaper = async (input: PaperMutation & { title: string }) => {
    const result = await client.post<{ paper: IPaper }>("papers", input);
    setPapers((current) => [result.paper, ...current]);
    setSelectedId(result.paper._id);
    toast.success("Reading added");
  };

  const updatePaper = async (paperId: string, input: PaperMutation) => {
    const result = await client.patch<{ paper: IPaper }>(
      `papers/${paperId}`,
      input,
    );
    setPapers((current) =>
      current.map((paper) => (paper._id === paperId ? result.paper : paper)),
    );
  };

  const createGroup = useCallback(
    async (name: string) => {
      try {
        const result = await client.post<{ group: INoteGroup }>("note-groups", {
          name,
        });
        setGroups((current) =>
          [...current, result.group].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        );
        return result.group;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create group",
        );
        return null;
      }
    },
    [client],
  );

  const editPaper = async (input: PaperMutation & { title: string }) => {
    if (!editing) return;
    await updatePaper(editing._id, input);
    setEditing(null);
    toast.success("Reading updated");
  };

  const deletePaper = async () => {
    if (!deleting) return;
    try {
      await client.del(`papers/${deleting._id}`);
      setPapers((current) =>
        current.filter((paper) => paper._id !== deleting._id),
      );
      if (selectedId === deleting._id) setSelectedId(null);
      setDeleting(null);
      toast.success("Reading deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const saveProgress = async (
    paperId: string,
    currentPage: number,
    totalPages?: number,
  ) => {
    const result = await client.put<{ paper: IPaper }>(
      `papers/${paperId}/progress`,
      { currentPage, totalPages },
    );
    setPapers((current) =>
      current.map((paper) => (paper._id === paperId ? result.paper : paper)),
    );
  };

  const saveTotalPages = async (paperId: string, totalPages: number) => {
    const result = await client.patch<{ paper: IPaper }>(
      `papers/${paperId}/progress`,
      { totalPages },
    );
    setPapers((current) =>
      current.map((paper) => (paper._id === paperId ? result.paper : paper)),
    );
  };

  // Only citable rows belong in a .bib — the rest are readings that would
  // become fabricated bibliography entries.
  const citablePapers = visiblePapers.filter((paper) => paper.citable);

  const exportLibrary = async () => {
    const bibtex = citablePapers.map((paper) => paper.bibtex).join("\n\n");
    await platform.downloadFile(
      "papers.bib",
      `${bibtex}\n`,
      "application/x-bibtex",
    );
  };

  /**
   * A dropped PDF becomes a reading immediately, with the filename as a
   * placeholder title. It stays non-citable unless metadata resolution or the
   * owner says otherwise.
   */
  const importDroppedPdfs = async (files: File[]) => {
    const pdfs = files.filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length === 0) {
      toast.error("No PDFs in that drop");
      return;
    }

    setImporting(true);
    let added = 0;
    let failed = 0;
    // Per file, so one bad PDF does not silently discard everything dropped
    // after it.
    for (const file of pdfs) {
      try {
        const uploaded = await client.uploadFile<{ pdf: PaperFile }>(
          "papers/upload",
          file,
        );
        const result = await client.post<{ paper: IPaper }>("papers", {
          title: file.name.replace(/\.pdf$/i, ""),
          type: "other",
          pdf: uploaded.pdf,
          citable: false,
          courseIds:
            courseFilter !== "all" && courseFilter !== "none"
              ? [courseFilter]
              : undefined,
        });
        setPapers((current) => [result.paper, ...current]);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    setImporting(false);
    if (added > 0) {
      toast.success(added === 1 ? "Reading added" : `${added} readings added`);
    }
    if (failed > 0) {
      toast.error(failed === 1 ? "1 file failed" : `${failed} files failed`);
    }
  };

  if (loading) return <PapersSkeleton />;

  if (selectedPaper) {
    return (
      <>
        <PaperDetail
          paper={selectedPaper}
          notes={notes}
          courses={courses}
          groups={groups}
          onCreateGroup={createGroup}
          onBack={() => setSelectedId(null)}
          onEdit={() => setEditing(selectedPaper)}
          onDelete={() => setDeleting(selectedPaper)}
          onPatch={async (input) => {
            try {
              await updatePaper(selectedPaper._id, input);
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Update failed",
              );
            }
          }}
          onProgress={async (currentPage, totalPages) => {
            await saveProgress(selectedPaper._id, currentPage, totalPages);
          }}
          onTotalPages={async (totalPages) => {
            await saveTotalPages(selectedPaper._id, totalPages);
          }}
        />
        <PaperFormDialog
          open={editing !== null}
          paper={editing}
          courses={courses}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={editPaper}
        />
        <DeletePaperDialog
          paper={deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
          onConfirm={deletePaper}
        />
      </>
    );
  }

  const readingCount = papers.filter(
    (paper) => paper.readingStatus === "reading",
  ).length;
  const dueCount = papers.filter((paper) => isOverdue(paper)).length;
  const highlightCount = papers.reduce(
    (total, paper) => total + paper.highlights.length,
    0,
  );
  const statusCounts = READING_STATUSES.map(
    (value) => papers.filter((paper) => paper.readingStatus === value).length,
  );

  return (
    <div
      className="relative h-full"
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        void importDroppedPdfs([...event.dataTransfer.files]);
      }}
    >
      <Page>
        <PageHeader
          leading={slots?.sidebarTrigger}
          icon={<BookOpen />}
          title="Reading"
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={citablePapers.length === 0}
            onClick={() => void exportLibrary()}
          >
            <Download />
            <span className="hidden sm:inline">.bib</span>
            <span className="tabular-nums text-muted-foreground">
              {citablePapers.length}
            </span>
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Add
          </Button>
        </PageHeader>

        <PageToolbar>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Title, author, tag"
            className="w-56"
          />
          <FilterTabs
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All", count: papers.length },
              ...READING_STATUSES.map((value, index) => ({
                value,
                label: READING_STATUS_LABEL[value],
                count: statusCounts[index],
              })),
            ]}
          />
          <ToolbarSpacer />
          <FilterSelect
            value={pdfFilter}
            onValueChange={(value) => setPdfFilter(value as PdfFilter)}
            icon={FileText}
          >
            <SelectItem value="all">Any file</SelectItem>
            <SelectItem value="with-pdf">Has PDF</SelectItem>
            <SelectItem value="missing-pdf">No PDF</SelectItem>
          </FilterSelect>
          <FilterSelect
            value={type}
            onValueChange={(value) => setType(value as TypeFilter)}
            icon={Shapes}
          >
            <SelectItem value="all">Any kind</SelectItem>
            {[...new Set(papers.map((paper) => paper.type))]
              .sort()
              .map((paperType) => (
                <SelectItem key={paperType} value={paperType}>
                  {paperType}
                </SelectItem>
              ))}
          </FilterSelect>
          <FilterSelect
            value={courseFilter}
            onValueChange={setCourseFilter}
            icon={GraduationCap}
          >
            <SelectItem value="all">Any class</SelectItem>
            <SelectItem value="none">Unlinked</SelectItem>
            {courses
              .filter((course) => course.status === "active")
              .map((course) => (
                <SelectItem key={course._id} value={course._id}>
                  {course.code ? `${course.code} · ` : ""}
                  {course.name}
                </SelectItem>
              ))}
          </FilterSelect>
          <FilterSelect
            value={libraryFilter}
            onValueChange={(value) => setLibraryFilter(value as LibraryFilter)}
            icon={Quote}
          >
            <SelectItem value="all">Everything</SelectItem>
            <SelectItem value="citable">In bibliography</SelectItem>
            <SelectItem value="reading-only">Reading only</SelectItem>
          </FilterSelect>
          {filtersActive && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear filters"
              onClick={clearFilters}
            >
              <X />
            </Button>
          )}
        </PageToolbar>

        <PageBody>
          <StatGroup>
            <Stat label="Readings" value={papers.length} />
            <Stat label="Reading" value={readingCount} />
            <Stat
              label="Overdue"
              value={dueCount}
              tone={dueCount > 0 ? "critical" : "muted"}
            />
            <Stat label="Highlights" value={highlightCount} />
          </StatGroup>

          {continueReading.length > 0 && courseFilter === "all" && (
            <Section title="Continue reading">
              <List>
                {continueReading.map((paper) => (
                  <ContinueRow
                    key={paper._id}
                    paper={paper}
                    onSelect={() => setSelectedId(paper._id)}
                  />
                ))}
              </List>
            </Section>
          )}

          <Section
            title="Library"
            count={
              filtersActive
                ? `${visiblePapers.length}/${papers.length}`
                : papers.length
            }
          >
            {visiblePapers.length === 0 ? (
              <EmptyState
                compact
                icon={<BookOpen />}
                label={filtersActive ? "No matches" : "No readings"}
              />
            ) : (
              <List divided>
                {visiblePapers.map((paper) => (
                  <PaperRow
                    key={paper._id}
                    paper={paper}
                    courses={courses}
                    onSelect={() => setSelectedId(paper._id)}
                  />
                ))}
              </List>
            )}
          </Section>
        </PageBody>
      </Page>

      {(dropping || importing) && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-xs text-muted-foreground">
            {importing ? (
              <>
                <Spinner className="size-3.5" /> Importing
              </>
            ) : (
              <>
                <FileText className="size-3.5" /> Drop PDFs
              </>
            )}
          </div>
        </div>
      )}

      <PaperFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        courses={courses}
        onSubmit={createPaper}
      />
      <DeletePaperDialog
        paper={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={deletePaper}
      />
    </div>
  );
}

function FilterSelect({
  value,
  onValueChange,
  icon: Icon,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        className={cn(
          "max-w-44 shrink-0 border-transparent text-[13px]",
          value !== "all" && "bg-surface text-accent-strong",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent position="popper">{children}</SelectContent>
    </Select>
  );
}

function DueLabel({ paper }: { paper: IPaper }) {
  const due = dueLabel(paper.dueAt);
  if (!due) return null;
  return (
    <span className={cn(isOverdue(paper) && "text-status-critical")}>
      {due}
    </span>
  );
}

function ContinueRow({
  paper,
  onSelect,
}: {
  paper: IPaper;
  onSelect: () => void;
}) {
  const percent = readingPercent(paper) ?? 0;
  return (
    <ListRow
      onClick={onSelect}
      className="items-start"
      leading={<BookOpen />}
      title={paper.title}
      description={
        <span className="mt-1.5 flex flex-col gap-1">
          <Meter value={percent / 100} />
          <span className="tabular-nums">
            p. {paper.progress?.currentPage ?? "—"} /{" "}
            {paper.progress?.totalPages ?? "—"}
          </span>
        </span>
      }
      meta={
        <>
          <DueLabel paper={paper} />
          <span>{percent}%</span>
        </>
      }
    />
  );
}

function PaperRow({
  paper,
  courses,
  onSelect,
}: {
  paper: IPaper;
  courses: PaperCourseRef[];
  onSelect: () => void;
}) {
  const authors = paper.authors
    .slice(0, 3)
    .map((author) => author.family || author.literal || author.given)
    .filter(Boolean)
    .join(", ");
  const percent = readingPercent(paper);
  const linkedCourses = paper.courseIds.flatMap(
    (id) => courses.find((course) => course._id === id) ?? [],
  );
  return (
    <ListRow
      onClick={onSelect}
      className="py-2.5"
      leading={
        <FileText className={cn(!paper.pdf && "text-muted-foreground/40")} />
      }
      title={paper.title}
      description={[
        authors || "—",
        paper.year,
        paper.venue,
        linkedCourses.map((course) => course.code || course.name).join(", "),
      ]
        .filter(Boolean)
        .join(" · ")}
      meta={
        <>
          {paper.doi && (
            <Badge variant="outline" className="hidden md:inline-flex">
              DOI
            </Badge>
          )}
          {paper.arxivId && (
            <Badge variant="outline" className="hidden md:inline-flex">
              arXiv
            </Badge>
          )}
          {!paper.pdf && (
            <Badge variant="warning" className="hidden md:inline-flex">
              No PDF
            </Badge>
          )}
          <DueLabel paper={paper} />
          {paper.highlights.length > 0 && (
            <span className="flex items-center gap-1">
              <Highlighter className="size-3" />
              {paper.highlights.length}
            </span>
          )}
          {paper.noteIds.length > 0 && (
            <span className="flex items-center gap-1">
              <Link2 className="size-3" />
              {paper.noteIds.length}
            </span>
          )}
          <span className="hidden w-14 text-right sm:inline">
            {percent !== undefined ? `${percent}%` : paper.type}
          </span>
        </>
      }
      trailing={
        <Badge
          variant={STATUS_BADGE[paper.readingStatus]}
          className="hidden w-16 sm:inline-flex"
        >
          {READING_STATUS_LABEL[paper.readingStatus]}
        </Badge>
      }
    />
  );
}

function DeletePaperDialog({
  paper,
  onOpenChange,
  onConfirm,
}: {
  paper: IPaper | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={paper !== null}
      onOpenChange={onOpenChange}
      title="Delete reading?"
      description={`“${paper?.title ?? ""}” and its stored PDF are deleted.`}
      actionLabel="Delete"
      destructive
      onConfirm={onConfirm}
    />
  );
}

export function PapersSkeleton() {
  return (
    <Page>
      <HeaderBarSkeleton
        icon={<BookOpen className="size-4 text-muted-foreground" />}
        title="Reading"
        actions={["w-16", "w-14"]}
      />
      <div className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-7 w-48" />
        <div className="flex-1" />
        <Skeleton className="hidden h-7 w-24 sm:block" />
        <Skeleton className="hidden h-7 w-24 sm:block" />
        <Skeleton className="hidden h-7 w-28 sm:block" />
      </div>
      <PageBody>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-1.5">
              <Skeleton className="size-4" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}
