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
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Meter } from "@repo/ui/meter";
import { Page, PageBody, PageHeader, PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@repo/ui/sheet";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  BookOpen,
  CalendarClock,
  CircleDashed,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  FolderTree,
  Gauge,
  GraduationCap,
  Highlighter,
  Link2,
  Pencil,
  Plus,
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
      <div className="flex min-h-[32rem] items-center justify-center border-b bg-surface/40">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    ),
  },
);

const MobilePdfReader = dynamic(
  () => import("./pdf-reader").then((module) => module.MobilePdfReader),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    ),
  },
);

const DesktopPdfReader = dynamic(
  () => import("./pdf-reader").then((module) => module.DesktopPdfReader),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Spinner className="size-4 text-muted-foreground" />
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

// The highlight's own colour is data (it matches the mark in the PDF), not
// theme, so it is the one place literal hues stay.
const HIGHLIGHT_BAR: Record<PaperHighlightColor, string> = {
  yellow: "border-amber-400",
  green: "border-emerald-400",
  blue: "border-sky-400",
  pink: "border-rose-400",
  purple: "border-violet-400",
};

const HIGHLIGHT_COLORS = Object.keys(HIGHLIGHT_BAR) as PaperHighlightColor[];

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
  const { platform, slots } = useAdmin();
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

  if (readerOpen && paper.pdf) {
    return (
      <>
        {isMobile ? (
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
        ) : (
          <DesktopPdfReader
            url={paper.pdf.url}
            fileName={paper.pdf.fileName}
            title={paper.title}
            page={currentPage}
            onPageChange={goToPage}
            onTotalPages={handleTotalPages}
            onClose={() => setReaderOpen(false)}
            onOpenDetails={() => setDetailsOpen(true)}
            onHighlightSelection={captureSelection}
          />
        )}
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

  const header = (
    <PageHeader
      leading={slots?.sidebarTrigger}
      crumbs={[{ label: "Reading", onClick: onBack }]}
      icon={<BookOpen />}
      title={paper.title}
    >
      {paper.citable && (
        <Button
          variant="ghost"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={() => void copyBibtex()}
        >
          <Clipboard /> BibTeX
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit reading"
        onClick={onEdit}
      >
        <Pencil />
      </Button>
      <RowActions>
        {paper.citable && (
          <DropdownMenuItem onSelect={() => void downloadBibtex()}>
            <Download /> Download .bib
          </DropdownMenuItem>
        )}
        {paper.doi && (
          <DropdownMenuItem
            onSelect={() =>
              platform.openExternal(`https://doi.org/${paper.doi}`)
            }
          >
            <ExternalLink /> DOI
          </DropdownMenuItem>
        )}
        {paper.arxivId && (
          <DropdownMenuItem
            onSelect={() =>
              platform.openExternal(`https://arxiv.org/abs/${paper.arxivId}`)
            }
          >
            <ExternalLink /> arXiv
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </RowActions>
      {paper.pdf && (
        <Button size="sm" onClick={() => setReaderOpen(true)}>
          <BookOpen /> Read
        </Button>
      )}
    </PageHeader>
  );

  return (
    <Page>
      {header}
      <PageBody bleed>
        <div className="h-full overflow-y-auto overscroll-contain">
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
                <EmptyState
                  icon={<FileText />}
                  label="No PDF"
                  className="border-b"
                />
              )}

              <div className="flex flex-col gap-8 px-5 py-6 sm:px-8">
                <PageTitle
                  title={paper.title}
                  meta={
                    <>
                      <Badge variant="outline">{paper.type}</Badge>
                      {paper.year && (
                        <span className="tabular-nums">{paper.year}</span>
                      )}
                      {paper.citationCount !== undefined && (
                        <span className="tabular-nums">
                          {paper.citationCount} cited
                        </span>
                      )}
                      {!paper.citable && (
                        <Badge variant="secondary">Not citable</Badge>
                      )}
                      {!paper.pdf && <Badge variant="warning">No PDF</Badge>}
                      <span className="font-mono">{paper.citationKey}</span>
                    </>
                  }
                />
                <div className="-mt-5 flex flex-col gap-1">
                  <p className="text-sm text-muted-foreground">
                    {authorLine(paper) || "—"}
                  </p>
                  {(paper.venue || paper.publisher) && (
                    <p className="text-xs italic text-muted-foreground">
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
                  <Section title="Abstract">
                    <p className="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {paper.abstract}
                    </p>
                  </Section>
                )}

                {paper.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {paper.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </main>

            <aside className="flex min-w-0 flex-col gap-8 px-5 py-6">
              <Properties>
                <Property icon={<CircleDashed />} label="Status">
                  <Select
                    value={paper.readingStatus}
                    onValueChange={(value) =>
                      void onPatch({
                        readingStatus: value as IPaper["readingStatus"],
                      })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="-ml-2.5 border-transparent"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unread">Unread</SelectItem>
                      <SelectItem value="reading">Reading</SelectItem>
                      <SelectItem value="read">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </Property>
                {percent !== undefined && (
                  <Property icon={<BookOpen />} label="Progress">
                    <div className="flex items-center gap-3">
                      <Meter value={percent / 100} className="flex-1" />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {currentPage} /{" "}
                        {totalPages ?? paper.progress?.totalPages ?? "—"} ·{" "}
                        {percent}%
                      </span>
                    </div>
                  </Property>
                )}
                <Property icon={<CalendarClock />} label="Due">
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      className="h-7 w-auto border-transparent px-0 shadow-none"
                      value={toDateInput(paper.dueAt)}
                      onChange={(event) =>
                        void onPatch({
                          dueAt: fromDateInput(event.target.value),
                        })
                      }
                    />
                    {paper.dueAt && (
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums text-muted-foreground",
                          isOverdue(paper) && "text-status-critical",
                        )}
                      >
                        {dueLabel(paper.dueAt)}
                      </span>
                    )}
                  </div>
                </Property>
                {pace !== undefined && (
                  <Property icon={<Gauge />} label="Pace">
                    <span className="tabular-nums">{pace} p/day</span>
                  </Property>
                )}
              </Properties>

              <Section title="Classes" count={linkedCourses.length}>
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
                {linkedCourses.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {linkedCourses.map((course) => (
                      <RemovableChip
                        key={course._id}
                        icon={<GraduationCap />}
                        label={course.code || course.name}
                        removeLabel={`Unlink ${course.name}`}
                        onRemove={() =>
                          void onPatch({
                            courseIds: paper.courseIds.filter(
                              (id) => id !== course._id,
                            ),
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Groups" count={noteGroupIds.length}>
                <GroupTreeCombobox
                  groups={groups}
                  value={noteGroupIds}
                  onChange={(next) => void onPatch({ noteGroupIds: next })}
                  onCreateGroup={onCreateGroup}
                />
                {noteGroupIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {noteGroupIds.map((groupId) => {
                      const label = groupPathLabels.get(groupId) ?? groupId;
                      return (
                        <RemovableChip
                          key={groupId}
                          icon={<FolderTree />}
                          label={label}
                          removeLabel={`Remove from ${label}`}
                          onRemove={() =>
                            void onPatch({
                              noteGroupIds: noteGroupIds.filter(
                                (id) => id !== groupId,
                              ),
                            })
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </Section>

              <Section title="Notes" count={linkedNotes.length}>
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
                {linkedNotes.length > 0 && (
                  <List>
                    {linkedNotes.map((note) => (
                      <ListRow
                        key={note._id}
                        leading={<Link2 />}
                        title={note.title}
                        onClick={() =>
                          platform.navigate(
                            `/notes?note=${encodeURIComponent(note._id)}`,
                          )
                        }
                        trailing={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                            aria-label={`Unlink ${note.title}`}
                            onClick={() =>
                              void onPatch({
                                noteIds: paper.noteIds.filter(
                                  (id) => id !== note._id,
                                ),
                              })
                            }
                          >
                            <X />
                          </Button>
                        }
                      />
                    ))}
                  </List>
                )}
              </Section>

              <Section
                title="Highlights"
                count={paper.highlights.length}
                actions={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add highlight"
                    onClick={() => setHighlightOpen(true)}
                  >
                    <Plus />
                  </Button>
                }
              >
                {paper.highlights.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Highlighter />}
                    label="No highlights"
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    {paper.highlights.map((highlight) => (
                      <HighlightEntry
                        key={highlight.id}
                        highlight={highlight}
                        onJump={
                          highlight.page
                            ? () => goToPage(highlight.page ?? 1)
                            : undefined
                        }
                        onDelete={() =>
                          void onPatch({
                            highlights: paper.highlights.filter(
                              (item) => item.id !== highlight.id,
                            ),
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </Section>
            </aside>
          </div>
        </div>
      </PageBody>

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
    </Page>
  );
}

function RemovableChip({
  icon,
  label,
  removeLabel,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <Badge
      variant="secondary"
      className="h-6 max-w-full gap-1 pr-0.5 text-xs font-normal"
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={removeLabel}
      >
        <X />
      </Button>
    </Badge>
  );
}

function HighlightEntry({
  highlight,
  onJump,
  onDelete,
}: {
  highlight: PaperHighlight;
  onJump?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group/highlight flex flex-col gap-1 border-l-2 pl-3",
        HIGHLIGHT_BAR[highlight.color],
      )}
    >
      <div className="flex min-h-5 items-center gap-2">
        {highlight.page &&
          (onJump ? (
            <Button
              variant="link"
              size="xs"
              className="text-xs text-muted-foreground tabular-nums"
              onClick={onJump}
            >
              p. {highlight.page}
            </Button>
          ) : (
            <span className="text-xs tabular-nums text-muted-foreground">
              p. {highlight.page}
            </span>
          ))}
        <span className="flex-1" />
        {onDelete && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-0 group-hover/highlight:opacity-100 focus-visible:opacity-100"
            onClick={onDelete}
            aria-label="Delete highlight"
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <blockquote className="whitespace-pre-wrap text-sm leading-6 text-accent-strong">
        {highlight.text}
      </blockquote>
      {highlight.note && (
        <p className="text-xs text-muted-foreground">{highlight.note}</p>
      )}
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
      <SheetContent
        side="bottom"
        className="max-h-[80vh] gap-0 overflow-y-auto"
      >
        <SheetHeader className="border-b">
          <SheetTitle className="leading-tight">{paper.title}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {authorLine(paper) || "—"}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
            {percent !== undefined && <span>{percent}%</span>}
            {paper.dueAt && (
              <span className={cn(isOverdue(paper) && "text-status-critical")}>
                {dueLabel(paper.dueAt)}
              </span>
            )}
            {courses.map((course) => (
              <span key={course._id}>{course.code || course.name}</span>
            ))}
          </div>
          {percent !== undefined && (
            <Meter value={percent / 100} className="mt-1" />
          )}
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 py-5">
          <Section title="Highlights" count={paper.highlights.length}>
            {paper.highlights.length === 0 ? (
              <EmptyState
                compact
                icon={<Highlighter />}
                label="No highlights"
              />
            ) : (
              <div className="flex flex-col gap-4">
                {paper.highlights.map((highlight) => (
                  <HighlightEntry
                    key={highlight.id}
                    highlight={highlight}
                    onJump={
                      highlight.page
                        ? () => {
                            onJumpToPage(highlight.page ?? 1);
                            onOpenChange(false);
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </Section>

          {paper.abstract && (
            <Section title="Abstract">
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {paper.abstract}
              </p>
            </Section>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
  const [pending, setPending] = useState(false);

  // The dialog is always opened by its parent (a selection, the add button),
  // which Radix does not report through onOpenChange, so the prefill keys on
  // `open` itself.
  useEffect(() => {
    if (!open) return;
    setHighlightPage(String(page));
    setText(quote ?? "");
    setNote("");
  }, [open, page, quote]);

  const handleAdd = async () => {
    if (!text.trim()) return;
    setPending(true);
    try {
      await onAdd({
        id: crypto.randomUUID(),
        page: highlightPage ? Number(highlightPage) : undefined,
        text: text.trim(),
        note: note.trim() || undefined,
        color,
        createdAt: new Date().toISOString(),
      });
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add highlight"
      onSubmit={handleAdd}
      submitLabel="Add"
      submitDisabled={!text.trim()}
      pending={pending}
    >
      <FormGrid>
        <FormField label="Page" htmlFor="highlight-page">
          <Input
            id="highlight-page"
            type="number"
            min={1}
            value={highlightPage}
            onChange={(event) => setHighlightPage(event.target.value)}
          />
        </FormField>
        <FormField label="Colour">
          <div className="flex h-8 items-center gap-1.5">
            {HIGHLIGHT_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={value}
                aria-pressed={color === value}
                onClick={() => setColor(value)}
                className={cn(
                  "size-6 rounded-full border-4 border-l-4 transition-shadow",
                  HIGHLIGHT_BAR[value],
                  color === value
                    ? "ring-2 ring-ring/60 ring-offset-2 ring-offset-background"
                    : "opacity-60 hover:opacity-100",
                )}
              />
            ))}
          </div>
        </FormField>
        <FormField
          label="Quote"
          htmlFor="highlight-quote"
          className="sm:col-span-2"
        >
          <Textarea
            id="highlight-quote"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-40"
          />
        </FormField>
        <FormField
          label="Note"
          htmlFor="highlight-note"
          className="sm:col-span-2"
        >
          <Textarea
            id="highlight-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-24"
          />
        </FormField>
      </FormGrid>
    </FormDialog>
  );
}
