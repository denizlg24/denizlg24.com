"use client";

import type {
  IPaper,
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
  Download,
  FileText,
  Highlighter,
  Link2,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { PaperDetail } from "./paper-detail";
import { PaperFormDialog } from "./paper-form-dialog";

interface PapersResponse {
  papers: IPaper[];
  notes: PaperNoteRef[];
}

type StatusFilter = "all" | PaperReadingStatus;
type TypeFilter = "all" | PaperType;
type PdfFilter = "all" | "with-pdf" | "missing-pdf";

export function PapersPage() {
  const { client, platform, slots } = useAdmin();
  const [papers, setPapers] = useState<IPaper[]>([]);
  const [notes, setNotes] = useState<PaperNoteRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [pdfFilter, setPdfFilter] = useState<PdfFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<IPaper | null>(null);
  const [deleting, setDeleting] = useState<IPaper | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await client.get<PapersResponse>("papers");
      setPapers(result.papers);
      setNotes(result.notes);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load papers",
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
  }, [papers, pdfFilter, query, status, type]);

  const selectedPaper = papers.find((paper) => paper._id === selectedId);

  const createPaper = async (input: PaperMutation & { title: string }) => {
    const result = await client.post<{ paper: IPaper }>("papers", input);
    setPapers((current) => [result.paper, ...current]);
    setSelectedId(result.paper._id);
    toast.success("Paper added");
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
    toast.success("Paper updated");
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
      toast.success("Paper deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const exportLibrary = async () => {
    const bibtex = visiblePapers.map((paper) => paper.bibtex).join("\n\n");
    await platform.downloadFile(
      "papers.bib",
      `${bibtex}\n`,
      "application/x-bibtex",
    );
  };

  if (loading) return <PapersSkeleton />;

  if (selectedPaper) {
    return (
      <>
        <PaperDetail
          paper={selectedPaper}
          notes={notes}
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
        />
        <PaperFormDialog
          open={editing !== null}
          paper={editing}
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
  const highlightCount = papers.reduce(
    (total, paper) => total + paper.highlights.length,
    0,
  );
  const missingPdfCount = papers.filter((paper) => !paper.pdf).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
        {slots?.sidebarTrigger}
        <BookOpen className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Papers</h1>
        <div className="hidden items-center gap-3 font-mono text-[10px] text-muted-foreground sm:flex">
          <span>{papers.length} total</span>
          <span>{readingCount} reading</span>
          <span>{highlightCount} highlights</span>
          <span>{missingPdfCount} missing PDF</span>
        </div>
        <div className="min-w-44 flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={visiblePapers.length === 0}
          onClick={() => void exportLibrary()}
        >
          <Download className="size-3.5" />
          <span className="hidden sm:inline">Export .bib</span>
        </Button>
        <Button size="sm" className="h-7" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search papers"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as StatusFilter)}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="reading">Reading</SelectItem>
            <SelectItem value="read">Read</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={pdfFilter}
          onValueChange={(value) => setPdfFilter(value as PdfFilter)}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All PDFs</SelectItem>
            <SelectItem value="with-pdf">With PDF</SelectItem>
            <SelectItem value="missing-pdf">Missing PDF</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={type}
          onValueChange={(value) => setType(value as TypeFilter)}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {[...new Set(papers.map((paper) => paper.type))]
              .sort()
              .map((paperType) => (
                <SelectItem key={paperType} value={paperType}>
                  {paperType}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        {visiblePapers.map((paper) => (
          <PaperRow
            key={paper._id}
            paper={paper}
            onSelect={() => setSelectedId(paper._id)}
          />
        ))}
        {visiblePapers.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            —
          </div>
        )}
      </div>

      <PaperFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
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

function PaperRow({
  paper,
  onSelect,
}: {
  paper: IPaper;
  onSelect: () => void;
}) {
  const authors = paper.authors
    .slice(0, 3)
    .map((author) => author.family || author.literal || author.given)
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_9rem_8rem]"
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
        </div>
        <p className="mt-1 truncate pl-5.5 text-xs text-muted-foreground">
          {[authors || "—", paper.year, paper.venue]
            .filter(Boolean)
            .join(" · ")}
        </p>
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
          {paper.readingStatus}
        </Badge>
        <span className="font-mono text-[9px] text-muted-foreground">
          {paper.type}
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
          <AlertDialogTitle>Delete paper?</AlertDialogTitle>
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
        <span className="text-sm font-semibold">Papers</span>
        <div className="flex-1" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-16" />
      </div>
      <div className="flex gap-2 border-b px-4 py-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}
