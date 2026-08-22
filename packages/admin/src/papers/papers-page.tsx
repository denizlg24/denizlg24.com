"use client";

import type {
  IPaper,
  PaperCourseRef,
  PaperFile,
  PaperMutation,
  PaperNoteRef,
  PaperReadingStatus,
  PaperType,
} from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import {
  BookOpen,
  CircleDashed,
  Download,
  FileText,
  GraduationCap,
  Highlighter,
  Link2,
  Loader2,
  Plus,
  Quote,
  Search,
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
}

type StatusFilter = "all" | PaperReadingStatus;
type TypeFilter = "all" | PaperType;
type PdfFilter = "all" | "with-pdf" | "missing-pdf";
type CourseFilter = "all" | "none" | string;
type LibraryFilter = "all" | "citable" | "reading-only";

export function PapersPage() {
  const { client, platform, slots } = useAdmin();
  const [papers, setPapers] = useState<IPaper[]>([]);
  const [notes, setNotes] = useState<PaperNoteRef[]>([]);
  const [courses, setCourses] = useState<PaperCourseRef[]>([]);
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

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        void importDroppedPdfs([...event.dataTransfer.files]);
      }}
    >
      <div className="flex min-h-12 items-center gap-2 border-b px-3 py-2 sm:px-4">
        {slots?.sidebarTrigger}
        <BookOpen className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Reading</h1>
        <div className="hidden items-center gap-3 font-mono text-[10px] text-muted-foreground sm:flex">
          <span>{papers.length} total</span>
          <span>{readingCount} reading</span>
          {dueCount > 0 && (
            <span className="text-destructive">{dueCount} overdue</span>
          )}
          <span>{highlightCount} highlights</span>
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={citablePapers.length === 0}
          onClick={() => void exportLibrary()}
        >
          <Download className="size-3.5" />
          <span className="hidden sm:inline">
            Export .bib · {citablePapers.length}
          </span>
        </Button>
        <Button size="sm" className="h-7" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>

      <div className="border-b px-3 py-2 sm:px-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, author, tag"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* One scrolling row rather than a wrapping grid: five stacked
            dropdowns took most of a phone screen before the first reading. */}
        <div className="mt-2 flex gap-1.5 overflow-x-auto sm:flex-wrap">
          <FilterSelect
            value={status}
            onValueChange={(value) => setStatus(value as StatusFilter)}
            icon={CircleDashed}
            className="w-30"
          >
            <SelectItem value="all">Any status</SelectItem>
            {READING_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {READING_STATUS_LABEL[value]}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={pdfFilter}
            onValueChange={(value) => setPdfFilter(value as PdfFilter)}
            icon={FileText}
            className="w-28"
          >
            <SelectItem value="all">Any file</SelectItem>
            <SelectItem value="with-pdf">Has PDF</SelectItem>
            <SelectItem value="missing-pdf">No PDF</SelectItem>
          </FilterSelect>
          <FilterSelect
            value={type}
            onValueChange={(value) => setType(value as TypeFilter)}
            icon={Shapes}
            className="w-30"
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
            onValueChange={(value) => setCourseFilter(value as CourseFilter)}
            icon={GraduationCap}
            className="w-36"
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
            className="w-34"
          >
            <SelectItem value="all">Everything</SelectItem>
            <SelectItem value="citable">In bibliography</SelectItem>
            <SelectItem value="reading-only">Reading only</SelectItem>
          </FilterSelect>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={clearFilters}
            >
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {continueReading.length > 0 && courseFilter === "all" && (
        <div className="border-b">
          <div className="px-3 pt-2.5 pb-1 font-mono sm:px-4 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Continue reading
          </div>
          {continueReading.map((paper) => (
            <ContinueRow
              key={paper._id}
              paper={paper}
              onSelect={() => setSelectedId(paper._id)}
            />
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {visiblePapers.map((paper) => (
          <PaperRow
            key={paper._id}
            paper={paper}
            courses={courses}
            onSelect={() => setSelectedId(paper._id)}
          />
        ))}
        {visiblePapers.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            —
          </div>
        )}
      </div>

      {(dropping || importing) && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 border border-dashed px-4 py-2 font-mono text-[11px] text-muted-foreground">
            {importing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Importing
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
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  icon: typeof FileText;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger size="sm" className={`h-8 shrink-0 text-xs ${className}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent position="popper">{children}</SelectContent>
    </Select>
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
  const due = dueLabel(paper.dueAt);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group block w-full px-3 py-2 text-left sm:px-4 transition-colors hover:bg-muted/30"
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{paper.title}</span>
        {due && (
          <span
            className={`shrink-0 font-mono text-[10px] tabular-nums ${
              isOverdue(paper) ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {due}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {percent}%
        </span>
      </div>
      <div className="mt-1.5 h-px w-full bg-border">
        <div className="h-px bg-foreground" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
        p. {paper.progress?.currentPage ?? "—"} /{" "}
        {paper.progress?.totalPages ?? "—"}
      </div>
    </button>
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
  const due = dueLabel(paper.dueAt);
  const linkedCourses = paper.courseIds.flatMap(
    (id) => courses.find((course) => course._id === id) ?? [],
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_9rem_8rem] sm:px-4"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <FileText
            className={`size-3.5 shrink-0 ${paper.pdf ? "text-foreground" : "text-muted-foreground/40"}`}
          />
          <span className="truncate text-sm font-medium">{paper.title}</span>
          {paper.doi && (
            <Badge
              variant="outline"
              className="hidden h-5 font-mono text-[9px] md:inline-flex"
            >
              DOI
            </Badge>
          )}
          {paper.arxivId && (
            <Badge
              variant="outline"
              className="hidden h-5 font-mono text-[9px] md:inline-flex"
            >
              arXiv
            </Badge>
          )}
          {!paper.pdf && (
            <Badge
              variant="secondary"
              className="hidden h-5 font-mono text-[9px] text-amber-600 md:inline-flex"
            >
              PDF missing
            </Badge>
          )}
          {due && (
            <span
              className={`ml-auto shrink-0 font-mono text-[10px] tabular-nums ${
                isOverdue(paper) ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {due}
            </span>
          )}
        </div>
        <p className="mt-1 truncate pl-5.5 text-xs text-muted-foreground">
          {[authors || "—", paper.year, paper.venue]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {linkedCourses.length > 0 && (
          <p className="mt-1 flex items-center gap-1.5 pl-5.5 font-mono text-[10px] text-muted-foreground">
            <GraduationCap className="size-2.5" />
            {linkedCourses
              .map((course) => course.code || course.name)
              .join(" · ")}
          </p>
        )}
        {percent !== undefined && (
          <div className="mt-1.5 ml-5.5 h-px bg-border">
            <div
              className="h-px bg-foreground/60"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 font-mono text-[10px] text-muted-foreground sm:justify-start">
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
      </div>
      <div className="hidden items-center justify-between sm:flex">
        <Badge
          variant={paper.readingStatus === "reading" ? "default" : "secondary"}
          className="text-[9px]"
        >
          {READING_STATUS_LABEL[paper.readingStatus]}
        </Badge>
        <span className="font-mono text-[9px] text-muted-foreground">
          {percent !== undefined ? `${percent}%` : paper.type}
        </span>
      </div>
    </button>
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
    <AlertDialog open={paper !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete reading?</AlertDialogTitle>
          <AlertDialogDescription>
            “{paper?.title}” and its stored PDF will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void onConfirm()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PapersSkeleton() {
  const { slots } = useAdmin();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        {slots?.sidebarTrigger}
        <BookOpen className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Reading</span>
        <div className="flex-1" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-16" />
      </div>
      <div className="border-b px-3 py-2 sm:px-4">
        <Skeleton className="h-8 w-full" />
        <div className="mt-2 flex gap-1.5">
          <Skeleton className="h-8 w-30" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-30" />
          <Skeleton className="hidden h-8 w-36 sm:block" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}
