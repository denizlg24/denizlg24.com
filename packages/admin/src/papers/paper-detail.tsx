"use client";

import type {
  IPaper,
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
import { Textarea } from "@repo/ui/textarea";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Highlighter,
  Link2,
  Pencil,
  Plus,
  Quote,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { toast } from "sonner";
import { useAdmin } from "../provider";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PaperDetailProps {
  paper: IPaper;
  notes: PaperNoteRef[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPatch: (input: PaperMutation) => Promise<void>;
}

const HIGHLIGHT_STYLE: Record<PaperHighlightColor, string> = {
  yellow: "border-amber-400/30 bg-amber-400/10",
  green: "border-emerald-400/30 bg-emerald-400/10",
  blue: "border-sky-400/30 bg-sky-400/10",
  pink: "border-rose-400/30 bg-rose-400/10",
  purple: "border-violet-400/30 bg-violet-400/10",
};

function authorLine(paper: IPaper): string {
  return paper.authors
    .map(
      (author) =>
        author.literal ||
        [author.given, author.family].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join(", ");
}

export function PaperDetail({
  paper,
  notes,
  onBack,
  onEdit,
  onDelete,
  onPatch,
}: PaperDetailProps) {
  const { platform } = useAdmin();
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onBack}
          aria-label="Back to papers"
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
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => void copyBibtex()}
        >
          <Clipboard className="size-3.5" />
          <span className="hidden sm:inline">BibTeX</span>
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={() => void downloadBibtex()}
          title="Download BibTeX"
        >
          <Download className="size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={onEdit}
          title="Edit paper"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive"
          onClick={onDelete}
          title="Delete paper"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid min-h-full xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.8fr)]">
          <main className="min-w-0 border-b xl:border-r xl:border-b-0">
            {paper.pdf ? (
              <PdfPreview
                url={paper.pdf.url}
                fileName={paper.pdf.fileName}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
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
                  <SelectItem value="read">Read</SelectItem>
                </SelectContent>
              </Select>
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
                          onClick={() => setCurrentPage(highlight.page ?? 1)}
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
        page={currentPage}
        onOpenChange={setHighlightOpen}
        onAdd={addHighlight}
      />
    </div>
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

function PdfPreview({
  url,
  fileName,
  currentPage,
  onPageChange,
}: {
  url: string;
  fileName: string;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(720);

  return (
    <div className="border-b bg-muted/20">
      <div className="flex h-9 items-center gap-2 border-b bg-background/80 px-3">
        <FileText className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {fileName}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="min-w-14 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
          {currentPage} / {numPages || "—"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={!numPages || currentPage >= numPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
      <div
        ref={(node) => {
          containerRef.current = node;
          if (node) setWidth(node.clientWidth);
        }}
        className="flex min-h-[32rem] max-h-[70vh] justify-center overflow-auto p-3"
      >
        <Document
          file={url}
          onLoadSuccess={({ numPages: count }) => {
            setNumPages(count);
            onPageChange(Math.min(Math.max(currentPage, 1), count));
          }}
          loading={
            <div className="flex min-h-80 items-center text-xs text-muted-foreground">
              Loading PDF…
            </div>
          }
          error={
            <div className="flex min-h-80 items-center text-xs text-destructive">
              PDF unavailable
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={Math.min(Math.max(width - 24, 280), 900)}
            renderAnnotationLayer
            renderTextLayer
          />
        </Document>
      </div>
    </div>
  );
}

function HighlightDialog({
  open,
  page,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  page: number;
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
        if (next) setHighlightPage(String(page));
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
