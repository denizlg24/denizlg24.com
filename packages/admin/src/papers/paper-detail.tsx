"use client";

import type {
  INoteGroup,
  IPaper,
  PaperCourseRef,
  PaperHighlight,
  PaperHighlightColor,
  PaperMutation,
  PaperNoteRef,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@repo/ui/sheet";
import { Textarea } from "@repo/ui/textarea";
import {
  ArrowLeft,
  BookOpen,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  FolderTree,
  GraduationCap,
  Highlighter,
  Link2,
  Pencil,
  Plus,
  Quote,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { buildPathLabelMap } from "../notes/group-tree";
import { GroupTreeCombobox } from "../notes/group-tree-combobox";
import { useAdmin } from "../provider";
import {
  authorLine,
  dueLabel,
  fromDateInput,
  isOverdue,
  readingPercent,
  requiredPace,
  toDateInput,
} from "./reading";

const PROGRESS_DEBOUNCE_MS = 900;
const MOBILE_BREAKPOINT_PX = 768;

// pdf.js touches DOMMatrix at module scope, so importing it into a
// server-rendered chunk throws before anything renders. Both readers load
// browser-side only, the same way the LaTeX PDF preview does.
const InlinePdfReader = dynamic(
  () => import("./pdf-reader").then((module) => module.InlinePdfReader),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[32rem] items-center justify-center border-b bg-muted/20 text-xs text-muted-foreground">
        Loading PDF…
      </div>
    ),
  },
);

const MobilePdfReader = dynamic(
  () => import("./pdf-reader").then((module) => module.MobilePdfReader),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-xs text-muted-foreground">
        Loading PDF…
      </div>
    ),
  },
);

interface PaperDetailProps {
  paper: IPaper;
  notes: PaperNoteRef[];
  courses: PaperCourseRef[];
  groups: INoteGroup[];
  onCreateGroup?: (name: string) => Promise<INoteGroup | null>;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPatch: (input: PaperMutation) => Promise<void>;
  onProgress: (currentPage: number, totalPages?: number) => Promise<void>;
  onTotalPages: (totalPages: number) => Promise<void>;
}

const HIGHLIGHT_STYLE: Record<PaperHighlightColor, string> = {
  yellow: "border-amber-400/30 bg-amber-400/10",
  green: "border-emerald-400/30 bg-emerald-400/10",
  blue: "border-sky-400/30 bg-sky-400/10",
  pink: "border-rose-400/30 bg-rose-400/10",
  purple: "border-violet-400/30 bg-violet-400/10",
};

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`,
    );
    const sync = () => setIsMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return isMobile;
}

export function PaperDetail({
  paper,
  notes,
  courses,
  groups,
  onCreateGroup,
  onBack,
  onEdit,
  onDelete,
  onPatch,
  onProgress,
  onTotalPages,
}: PaperDetailProps) {
  const { platform } = useAdmin();
  const isMobile = useIsMobile();
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(
    paper.progress?.currentPage ?? 1,
  );
  const [totalPages, setTotalPages] = useState(paper.progress?.totalPages);
  const [pendingHighlight, setPendingHighlight] = useState<{
    text: string;
    page: number;
  } | null>(null);

  const linkedNotes = useMemo(
    () =>
      paper.noteIds.flatMap(
        (id) => notes.find((note) => note._id === id) ?? [],
      ),
    [notes, paper.noteIds],
  );
  const availableNotes = useMemo(
    () => notes.filter((note) => !paper.noteIds.includes(note._id)),
    [notes, paper.noteIds],
  );
  const linkedCourses = useMemo(
    () =>
      paper.courseIds.flatMap(
        (id) => courses.find((course) => course._id === id) ?? [],
      ),
    [courses, paper.courseIds],
  );
  const availableCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          course.status === "active" && !paper.courseIds.includes(course._id),
      ),
    [courses, paper.courseIds],
  );
  // Groups live on the linked knowledge note, so this is the note's list, not
  // a field of the paper.
  const noteGroupIds = useMemo(
    () => paper.noteGroupIds ?? [],
    [paper.noteGroupIds],
  );
  const groupPathLabels = useMemo(() => buildPathLabelMap(groups), [groups]);

  // A page turn is cheap to make and expensive to send, so the write trails
  // the reader rather than blocking it.
  const pendingPage = useRef<{ page: number; total?: number } | null>(null);
  const flushTimer = useRef<number | null>(null);

  const flushProgress = useCallback(() => {
    const pending = pendingPage.current;
    pendingPage.current = null;
    if (!pending) return;
    void onProgress(pending.page, pending.total).catch(() => {
      // The reader stays where it is; the next turn retries the write.
    });
  }, [onProgress]);

  const queueProgress = useCallback(
    (page: number, total?: number) => {
      pendingPage.current = { page, total: total ?? totalPages };
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(
        flushProgress,
        PROGRESS_DEBOUNCE_MS,
      );
    },
    [flushProgress, totalPages],
  );

  // Leaving the reader mid-debounce must not lose the page it was left on.
  // This has to be an unmount-only effect: onProgress is an inline callback, so
  // depending on it would re-run the cleanup every render and flush on every
  // page turn, defeating the debounce it exists to preserve.
  const flushRef = useRef(flushProgress);
  flushRef.current = flushProgress;
  useEffect(
    () => () => {
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushRef.current();
    },
    [],
  );

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(page);
      queueProgress(page);
    },
    [queueProgress],
  );

  // Loading the PDF is not reading it, so the page count goes through the
  // metadata path. Writing it as progress would stamp startedAt and move the
  // status to "reading" just for opening the record.
  const handleTotalPages = useCallback(
    (total: number) => {
      setTotalPages(total);
      if (total === paper.progress?.totalPages) return;
      void onTotalPages(total).catch(() => {
        // The next load re-reports it; nothing here depends on the write.
      });
    },
    [onTotalPages, paper.progress?.totalPages],
  );

  const copyBibtex = async () => {
    await platform.copyText(paper.bibtex);
    toast.success("BibTeX copied");
  };

  const downloadBibtex = async () => {
    await platform.downloadFile(
      `${paper.citationKey}.bib`,
      `${paper.bibtex}\n`,
      "application/x-bibtex",
    );
  };

  const addHighlight = async (highlight: PaperHighlight) => {
    await onPatch({ highlights: [...paper.highlights, highlight] });
    setCurrentPage(highlight.page ?? currentPage);
  };

  const captureSelection = useCallback((text: string, page: number) => {
    setPendingHighlight({ text, page });
    setHighlightOpen(true);
  }, []);

  // On a phone the point of opening a reading is to read it, so the reader is
  // the landing surface. Closing it falls back to the metadata page and must
  // not bounce straight back in.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!isMobile || autoOpened.current || !paper.pdf) return;
    autoOpened.current = true;
    setReaderOpen(true);
  }, [isMobile, paper.pdf]);

  const percent = readingPercent(paper);
  const pace = requiredPace(paper);

  if (isMobile && readerOpen && paper.pdf) {
    return (
      <>
        <MobilePdfReader
          url={paper.pdf.url}
          fileName={paper.pdf.fileName}
          title={paper.title}
          page={currentPage}
          onPageChange={goToPage}
          onTotalPages={handleTotalPages}
          onClose={() => setReaderOpen(false)}
          onOpenDetails={() => setDetailsOpen(true)}
          onHighlightSelection={captureSelection}
          footnote={pace ? `${pace} p/day` : dueLabel(paper.dueAt)}
        />
        <ReadingSheet
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          paper={paper}
          courses={linkedCourses}
          onJumpToPage={goToPage}
        />
        <HighlightDialog
          open={highlightOpen}
          page={pendingHighlight?.page ?? currentPage}
          quote={pendingHighlight?.text}
          onOpenChange={(open) => {
            setHighlightOpen(open);
            if (!open) setPendingHighlight(null);
          }}
          onAdd={addHighlight}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onBack}
          aria-label="Back to reading list"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <BookOpen className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{paper.title}</h1>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {paper.citationKey}
          </p>
        </div>
        {paper.pdf && (
          <Button
            size="sm"
            className="h-7 md:hidden"
            onClick={() => setReaderOpen(true)}
          >
            <BookOpen className="size-3.5" /> Read
          </Button>
        )}
        {paper.citable && (
          <Button
            variant="outline"
            size="sm"
            className="hidden h-7 sm:inline-flex"
            onClick={() => void copyBibtex()}
          >
            <Clipboard className="size-3.5" />
            BibTeX
          </Button>
        )}
        {paper.citable && (
          <Button
            variant="outline"
            size="icon"
            className="hidden size-7 sm:inline-flex"
            onClick={() => void downloadBibtex()}
            title="Download BibTeX"
          >
            <Download className="size-3.5" />
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={onEdit}
          title="Edit reading"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive"
          onClick={onDelete}
          title="Delete reading"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid min-h-full xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.8fr)]">
          <main className="min-w-0 border-b xl:border-r xl:border-b-0">
            {paper.pdf ? (
              <InlinePdfReader
                url={paper.pdf.url}
                fileName={paper.pdf.fileName}
                page={currentPage}
                onPageChange={goToPage}
                onTotalPages={handleTotalPages}
                onHighlightSelection={captureSelection}
              />
            ) : (
              <div className="flex min-h-64 items-center justify-center border-b text-muted-foreground/50">
                <FileText className="size-8" />
              </div>
            )}

            <section className="space-y-4 p-4 sm:p-6">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {paper.type}
                  </Badge>
                  {paper.year && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {paper.year}
                    </span>
                  )}
                  {paper.citationCount !== undefined && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {paper.citationCount} cited
                    </span>
                  )}
                  {!paper.citable && (
                    <Badge
                      variant="secondary"
                      className="font-mono text-[10px]"
                    >
                      not citable
                    </Badge>
                  )}
                  {!paper.pdf && (
                    <Badge
                      variant="secondary"
                      className="font-mono text-[10px] text-amber-600"
                    >
                      PDF missing
                    </Badge>
                  )}
                  {paper.doi && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 font-mono text-[10px]"
                      onClick={() =>
                        platform.openExternal(`https://doi.org/${paper.doi}`)
                      }
                    >
                      DOI <ExternalLink className="size-2.5" />
                    </Button>
                  )}
                  {paper.arxivId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 font-mono text-[10px]"
                      onClick={() =>
                        platform.openExternal(
                          `https://arxiv.org/abs/${paper.arxivId}`,
                        )
                      }
                    >
                      arXiv:{paper.arxivId}{" "}
                      <ExternalLink className="size-2.5" />
                    </Button>
                  )}
                </div>
                <h2 className="max-w-4xl text-xl font-semibold leading-tight sm:text-2xl">
                  {paper.title}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {authorLine(paper) || "—"}
                </p>
                {(paper.venue || paper.publisher) && (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    {[
                      paper.venue,
                      paper.publisher,
                      paper.volume && `vol. ${paper.volume}`,
                      paper.issue && `no. ${paper.issue}`,
                      paper.pages && `pp. ${paper.pages}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>

              {paper.abstract && (
                <div>
                  <SectionLabel>Abstract</SectionLabel>
                  <p className="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {paper.abstract}
                  </p>
                </div>
              )}

              {paper.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {paper.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px]"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </section>
          </main>

          <aside className="min-w-0 p-4">
            <section className="border-b pb-4">
              <SectionLabel>Reading</SectionLabel>
              <Select
                value={paper.readingStatus}
                onValueChange={(value) =>
                  void onPatch({
                    readingStatus: value as IPaper["readingStatus"],
                  })
                }
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unread">Unread</SelectItem>
                  <SelectItem value="reading">Reading</SelectItem>
                  <SelectItem value="read">Completed</SelectItem>
                </SelectContent>
              </Select>

              {percent !== undefined && (
                <div className="mt-3">
                  <div className="h-0.5 w-full bg-border">
                    <div
                      className="h-0.5 bg-foreground"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                    <span>
                      {currentPage} /{" "}
                      {totalPages ?? paper.progress?.totalPages ?? "—"}
                    </span>
                    <span>{percent}%</span>
                  </div>
                </div>
              )}

              <div className="mt-3 grid gap-2">
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    className="h-7 text-xs"
                    value={toDateInput(paper.dueAt)}
                    onChange={(event) =>
                      void onPatch({ dueAt: fromDateInput(event.target.value) })
                    }
                  />
                  {paper.dueAt && (
                    <span
                      className={`shrink-0 font-mono text-[10px] tabular-nums ${
                        isOverdue(paper)
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {dueLabel(paper.dueAt)}
                    </span>
                  )}
                </div>
                {pace !== undefined && (
                  <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {pace} p/day
                  </p>
                )}
              </div>
            </section>

            <section className="border-b py-4">
              <SectionLabel>Classes · {linkedCourses.length}</SectionLabel>
              <Select
                value=""
                disabled={availableCourses.length === 0}
                onValueChange={(courseId) =>
                  void onPatch({ courseIds: [...paper.courseIds, courseId] })
                }
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="Link class" />
                </SelectTrigger>
                <SelectContent>
                  {availableCourses.map((course) => (
                    <SelectItem key={course._id} value={course._id}>
                      {course.code ? `${course.code} · ` : ""}
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-2 flex flex-wrap gap-1">
                {linkedCourses.map((course) => (
                  <span
                    key={course._id}
                    className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    <GraduationCap className="size-2.5 text-muted-foreground" />
                    {course.code || course.name}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        void onPatch({
                          courseIds: paper.courseIds.filter(
                            (id) => id !== course._id,
                          ),
                        })
                      }
                      aria-label={`Unlink ${course.name}`}
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                {linkedCourses.length === 0 && (
                  <p className="py-1 text-xs text-muted-foreground">—</p>
                )}
              </div>
            </section>

            <section className="border-b py-4">
              <SectionLabel>Groups · {noteGroupIds.length}</SectionLabel>
              <GroupTreeCombobox
                groups={groups}
                value={noteGroupIds}
                onChange={(next) => void onPatch({ noteGroupIds: next })}
                onCreateGroup={onCreateGroup}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {noteGroupIds.map((groupId) => (
                  <span
                    key={groupId}
                    className="inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px]"
                    title={groupPathLabels.get(groupId) ?? groupId}
                  >
                    <FolderTree className="size-2.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {groupPathLabels.get(groupId) ?? groupId}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        void onPatch({
                          noteGroupIds: noteGroupIds.filter(
                            (id) => id !== groupId,
                          ),
                        })
                      }
                      aria-label={`Remove from ${
                        groupPathLabels.get(groupId) ?? "group"
                      }`}
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                {noteGroupIds.length === 0 && (
                  <p className="py-1 text-xs text-muted-foreground">—</p>
                )}
              </div>
            </section>

            <section className="border-b py-4">
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel className="mb-0">
                  Linked notes · {linkedNotes.length}
                </SectionLabel>
              </div>
              <Select
                value=""
                disabled={availableNotes.length === 0}
                onValueChange={(noteId) =>
                  void onPatch({ noteIds: [...paper.noteIds, noteId] })
                }
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="Link note" />
                </SelectTrigger>
                <SelectContent>
                  {availableNotes.map((note) => (
                    <SelectItem key={note._id} value={note._id}>
                      {note.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-2 space-y-1">
                {linkedNotes.map((note) => (
                  <div
                    key={note._id}
                    className="group flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                  >
                    <Link2 className="size-3 text-muted-foreground" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      onClick={() =>
                        platform.navigate(
                          `/notes?note=${encodeURIComponent(note._id)}`,
                        )
                      }
                    >
                      {note.title}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 opacity-50 group-hover:opacity-100"
                      onClick={() =>
                        void onPatch({
                          noteIds: paper.noteIds.filter(
                            (id) => id !== note._id,
                          ),
                        })
                      }
                      aria-label={`Unlink ${note.title}`}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
                {linkedNotes.length === 0 && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    —
                  </p>
                )}
              </div>
            </section>

            <section className="py-4">
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel className="mb-0">
                  Highlights · {paper.highlights.length}
                </SectionLabel>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => setHighlightOpen(true)}
                >
                  <Plus className="size-3" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {paper.highlights.map((highlight) => (
                  <div
                    key={highlight.id}
                    className={`group rounded-md border p-2.5 ${HIGHLIGHT_STYLE[highlight.color]}`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Quote className="size-3 text-muted-foreground" />
                      {highlight.page && (
                        <button
                          type="button"
                          className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => goToPage(highlight.page ?? 1)}
                        >
                          p. {highlight.page}
                        </button>
                      )}
                      <span className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 opacity-0 group-hover:opacity-100"
                        onClick={() =>
                          void onPatch({
                            highlights: paper.highlights.filter(
                              (item) => item.id !== highlight.id,
                            ),
                          })
                        }
                        aria-label="Delete highlight"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                    <blockquote className="whitespace-pre-wrap text-xs leading-5">
                      {highlight.text}
                    </blockquote>
                    {highlight.note && (
                      <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                        {highlight.note}
                      </p>
                    )}
                  </div>
                ))}
                {paper.highlights.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    —
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>

      <HighlightDialog
        open={highlightOpen}
        page={pendingHighlight?.page ?? currentPage}
        quote={pendingHighlight?.text}
        onOpenChange={(open) => {
          setHighlightOpen(open);
          if (!open) setPendingHighlight(null);
        }}
        onAdd={addHighlight}
      />
    </div>
  );
}

function ReadingSheet({
  open,
  onOpenChange,
  paper,
  courses,
  onJumpToPage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paper: IPaper;
  courses: PaperCourseRef[];
  onJumpToPage: (page: number) => void;
}) {
  const percent = readingPercent(paper);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm leading-tight">
            {paper.title}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <p className="text-xs text-muted-foreground">
            {authorLine(paper) || "—"}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums text-muted-foreground">
            {percent !== undefined && <span>{percent}% read</span>}
            {paper.dueAt && (
              <span className={isOverdue(paper) ? "text-destructive" : ""}>
                {dueLabel(paper.dueAt)}
              </span>
            )}
            {courses.map((course) => (
              <span key={course._id}>{course.code || course.name}</span>
            ))}
          </div>

          <div>
            <SectionLabel>Highlights · {paper.highlights.length}</SectionLabel>
            <div className="space-y-2">
              {paper.highlights.map((highlight) => (
                <button
                  key={highlight.id}
                  type="button"
                  className={`block w-full rounded-md border p-2.5 text-left ${HIGHLIGHT_STYLE[highlight.color]}`}
                  onClick={() => {
                    if (highlight.page) onJumpToPage(highlight.page);
                    onOpenChange(false);
                  }}
                >
                  {highlight.page && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      p. {highlight.page}
                    </span>
                  )}
                  <blockquote className="mt-1 whitespace-pre-wrap text-xs leading-5">
                    {highlight.text}
                  </blockquote>
                </button>
              ))}
              {paper.highlights.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  —
                </p>
              )}
            </div>
          </div>

          {paper.abstract && (
            <div>
              <SectionLabel>Abstract</SectionLabel>
              <p className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                {paper.abstract}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={`mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground ${className}`}
    >
      {children}
    </h3>
  );
}

function HighlightDialog({
  open,
  page,
  quote,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  page: number;
  quote?: string;
  onOpenChange: (open: boolean) => void;
  onAdd: (highlight: PaperHighlight) => Promise<void>;
}) {
  const [highlightPage, setHighlightPage] = useState(String(page));
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [color, setColor] = useState<PaperHighlightColor>("yellow");

  const handleAdd = async () => {
    if (!text.trim()) return;
    await onAdd({
      id: crypto.randomUUID(),
      page: highlightPage ? Number(highlightPage) : undefined,
      text: text.trim(),
      note: note.trim() || undefined,
      color,
      createdAt: new Date().toISOString(),
    });
    setText("");
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setHighlightPage(String(page));
          setText(quote ?? "");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add highlight</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Page</Label>
              <Input
                type="number"
                min={1}
                value={highlightPage}
                onChange={(event) => setHighlightPage(event.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Color</Label>
              <Select
                value={color}
                onValueChange={(value) =>
                  setColor(value as PaperHighlightColor)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(HIGHLIGHT_STYLE).map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Quote</Label>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-28"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Note</Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!text.trim()} onClick={() => void handleAdd()}>
            <Highlighter className="size-3.5" /> Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
