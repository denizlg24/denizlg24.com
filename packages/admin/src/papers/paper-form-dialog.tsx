"use client";

import type {
  IPaper,
  KanbanPriority,
  PaperAuthor,
  PaperCourseRef,
  PaperFile,
  PaperMutation,
  PaperType,
  ResolvedPaperMetadata,
} from "@repo/schemas";
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
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { FileUp, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { fromDateInput, toDateInput } from "./reading";

interface PaperFormDialogProps {
  open: boolean;
  paper?: IPaper | null;
  courses: PaperCourseRef[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PaperMutation & { title: string }) => Promise<void>;
}

const PRIORITIES: KanbanPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];

const PAPER_TYPES: PaperType[] = [
  "article",
  "conference",
  "preprint",
  "thesis",
  "book",
  "chapter",
  "report",
  "dataset",
  "other",
];

function authorsToText(authors: PaperAuthor[]): string {
  return authors
    .map((author) => {
      if (author.literal) return author.literal;
      if (author.family && author.given)
        return `${author.family}, ${author.given}`;
      return author.family || author.given || "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseAuthors(value: string): PaperAuthor[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const comma = line.indexOf(",");
      if (comma < 0) return { literal: line };
      return {
        family: line.slice(0, comma).trim(),
        given: line.slice(comma + 1).trim() || undefined,
      };
    });
}

function listToText(values: string[]): string {
  return values.join(", ");
}

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function PaperFormDialog({
  open,
  paper,
  courses,
  onOpenChange,
  onSubmit,
}: PaperFormDialogProps) {
  const { client } = useAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [identifier, setIdentifier] = useState("");
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [abstract, setAbstract] = useState("");
  const [type, setType] = useState<PaperType>("article");
  const [year, setYear] = useState("");
  const [venue, setVenue] = useState("");
  const [publisher, setPublisher] = useState("");
  const [volume, setVolume] = useState("");
  const [issue, setIssue] = useState("");
  const [pages, setPages] = useState("");
  const [doi, setDoi] = useState("");
  const [arxivId, setArxivId] = useState("");
  const [arxivCategory, setArxivCategory] = useState("");
  const [url, setUrl] = useState("");
  const [citationKey, setCitationKey] = useState("");
  const [tags, setTags] = useState("");
  const [isbn, setIsbn] = useState("");
  const [issn, setIssn] = useState("");
  const [metadataSource, setMetadataSource] =
    useState<IPaper["metadataSource"]>("manual");
  const [metadataFetchedAt, setMetadataFetchedAt] = useState<string>();
  const [resolvedMetadata, setResolvedMetadata] =
    useState<ResolvedPaperMetadata | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<KanbanPriority>("none");
  const [citable, setCitable] = useState(true);
  const [citableTouched, setCitableTouched] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);

  const linkableCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          course.status === "active" && !courseIds.includes(course._id),
      ),
    [courses, courseIds],
  );

  useEffect(() => {
    if (!open) return;
    setIdentifier("");
    setTitle(paper?.title ?? "");
    setAuthors(authorsToText(paper?.authors ?? []));
    setAbstract(paper?.abstract ?? "");
    setType(paper?.type ?? "article");
    setYear(paper?.year ? String(paper.year) : "");
    setVenue(paper?.venue ?? "");
    setPublisher(paper?.publisher ?? "");
    setVolume(paper?.volume ?? "");
    setIssue(paper?.issue ?? "");
    setPages(paper?.pages ?? "");
    setDoi(paper?.doi ?? "");
    setArxivId(paper?.arxivId ?? "");
    setArxivCategory(paper?.arxivCategory ?? "");
    setUrl(paper?.url ?? "");
    setCitationKey(paper?.citationKey ?? "");
    setTags(listToText(paper?.tags ?? []));
    setIsbn(listToText(paper?.isbn ?? []));
    setIssn(listToText(paper?.issn ?? []));
    setMetadataSource(paper?.metadataSource ?? "manual");
    setMetadataFetchedAt(paper?.metadataFetchedAt);
    setResolvedMetadata(null);
    setPdfFile(null);
    setCourseIds(paper?.courseIds ?? []);
    setDueAt(toDateInput(paper?.dueAt));
    setPriority(paper?.priority ?? "none");
    setCitable(paper?.citable ?? false);
    setCitableTouched(Boolean(paper));
  }, [open, paper]);

  const applyMetadata = (metadata: ResolvedPaperMetadata) => {
    setResolvedMetadata(metadata);
    setTitle(metadata.title);
    setAuthors(authorsToText(metadata.authors ?? []));
    setAbstract(metadata.abstract ?? "");
    setType(metadata.type ?? "article");
    setYear(metadata.year ? String(metadata.year) : "");
    setVenue(metadata.venue ?? "");
    setPublisher(metadata.publisher ?? "");
    setVolume(metadata.volume ?? "");
    setIssue(metadata.issue ?? "");
    setPages(metadata.pages ?? "");
    setDoi(metadata.doi ?? "");
    setArxivId(metadata.arxivId ?? "");
    setArxivCategory(metadata.arxivCategory ?? "");
    setUrl(metadata.url ?? "");
    setIsbn(listToText(metadata.isbn ?? []));
    setIssn(listToText(metadata.issn ?? []));
    setMetadataSource(metadata.metadataSource ?? "manual");
    setMetadataFetchedAt(metadata.metadataFetchedAt);
    // Resolving against Crossref, arXiv or OpenAlex is exactly the evidence
    // that makes something citable, so flip it unless it was set by hand.
    if (!citableTouched) setCitable(true);
  };

  const handleLookup = async () => {
    if (!identifier.trim()) return;
    setLookingUp(true);
    try {
      const result = await client.post<{ metadata: ResolvedPaperMetadata }>(
        "papers/resolve",
        { identifier },
      );
      applyMetadata(result.metadata);
      toast.success("Metadata resolved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  };

  const uploadPdf = async (): Promise<PaperFile | undefined> => {
    if (!pdfFile) return undefined;
    const data = new FormData();
    data.append("file", pdfFile);
    const result = await client.upload<{ pdf: PaperFile }>(
      "papers/upload",
      data,
    );
    return result.pdf;
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const pdf = await uploadPdf();
      const numericYear = year ? Number(year) : undefined;
      const parsedYear =
        numericYear !== undefined && Number.isFinite(numericYear)
          ? numericYear
          : undefined;
      await onSubmit({
        title: title.trim(),
        authors: parseAuthors(authors),
        abstract,
        type,
        year: parsedYear ?? (paper ? null : undefined),
        venue,
        publisher,
        volume,
        issue,
        pages,
        doi,
        arxivId,
        arxivCategory,
        url,
        citationKey: citationKey || undefined,
        tags: parseList(tags),
        isbn: parseList(isbn),
        issn: parseList(issn),
        metadataSource,
        metadataFetchedAt,
        ...(resolvedMetadata?.publishedDate
          ? { publishedDate: resolvedMetadata.publishedDate }
          : {}),
        ...(resolvedMetadata?.language
          ? { language: resolvedMetadata.language }
          : {}),
        ...(resolvedMetadata?.citationCount !== undefined
          ? { citationCount: resolvedMetadata.citationCount }
          : {}),
        ...(pdf ? { pdf } : {}),
        citable,
        courseIds,
        priority: priority === "none" ? null : priority,
        dueAt: fromDateInput(dueAt),
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{paper ? "Edit reading" : "Add reading"}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 rounded-md border bg-muted/20 p-2">
          <Input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleLookup();
            }}
            placeholder="DOI, arXiv id, or Semantic Scholar URL"
            className="h-8 font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={lookingUp || !identifier.trim()}
            onClick={() => void handleLookup()}
          >
            {lookingUp ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Resolve
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Authors" className="sm:col-span-2">
            <Textarea
              value={authors}
              onChange={(event) => setAuthors(event.target.value)}
              className="min-h-20 font-mono text-xs"
              placeholder="Family, Given — one per line"
            />
          </Field>
          <Field label="Type">
            <Select
              value={type}
              onValueChange={(value) => setType(value as PaperType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPER_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Year">
            <Input
              type="number"
              min={1000}
              max={3000}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </Field>
          <Field label="Venue">
            <Input
              value={venue}
              onChange={(event) => setVenue(event.target.value)}
            />
          </Field>
          <Field label="Publisher">
            <Input
              value={publisher}
              onChange={(event) => setPublisher(event.target.value)}
            />
          </Field>
          <Field label="Volume / issue">
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={volume}
                onChange={(event) => setVolume(event.target.value)}
                placeholder="volume"
              />
              <Input
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
                placeholder="issue"
              />
            </div>
          </Field>
          <Field label="Pages">
            <Input
              value={pages}
              onChange={(event) => setPages(event.target.value)}
            />
          </Field>
          <Field label="DOI">
            <Input
              value={doi}
              onChange={(event) => setDoi(event.target.value)}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="arXiv">
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <Input
                value={arxivId}
                onChange={(event) => setArxivId(event.target.value)}
                className="font-mono text-xs"
              />
              <Input
                value={arxivCategory}
                onChange={(event) => setArxivCategory(event.target.value)}
                placeholder="cs.HC"
                className="font-mono text-xs"
              />
            </div>
          </Field>
          <Field label="URL" className="sm:col-span-2">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <Field label="Citation key">
            <Input
              value={citationKey}
              onChange={(event) => setCitationKey(event.target.value)}
              placeholder="auto"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Tags">
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="comma separated"
            />
          </Field>
          <Field label="ISBN">
            <Input
              value={isbn}
              onChange={(event) => setIsbn(event.target.value)}
            />
          </Field>
          <Field label="ISSN">
            <Input
              value={issn}
              onChange={(event) => setIssn(event.target.value)}
            />
          </Field>
          <Field label="Abstract" className="sm:col-span-2">
            <Textarea
              value={abstract}
              onChange={(event) => setAbstract(event.target.value)}
              className="min-h-28"
            />
          </Field>
          <Field label="PDF" className="sm:col-span-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="size-3.5" />
              {pdfFile?.name ?? paper?.pdf?.fileName ?? "Choose PDF"}
            </Button>
          </Field>

          <Field label="Classes" className="sm:col-span-2">
            <Select
              value=""
              disabled={linkableCourses.length === 0}
              onValueChange={(courseId) =>
                setCourseIds((current) =>
                  current.includes(courseId) ? current : [...current, courseId],
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Link class" />
              </SelectTrigger>
              <SelectContent>
                {linkableCourses.map((course) => (
                  <SelectItem key={course._id} value={course._id}>
                    {course.code ? `${course.code} · ` : ""}
                    {course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {courseIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {courseIds.map((courseId) => {
                  const course = courses.find(
                    (candidate) => candidate._id === courseId,
                  );
                  return (
                    <span
                      key={courseId}
                      className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {course?.code || course?.name || courseId}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setCourseIds((current) =>
                            current.filter((id) => id !== courseId),
                          )
                        }
                        aria-label={`Unlink ${course?.name ?? "class"}`}
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Due">
            <Input
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={priority}
              onValueChange={(value) => setPriority(value as KanbanPriority)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Citable" className="sm:col-span-2">
            <div className="flex items-center gap-3">
              <Switch
                checked={citable}
                onCheckedChange={(next) => {
                  setCitable(next);
                  setCitableTouched(true);
                }}
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                {citable ? "bibliography" : "reading only"}
              </span>
            </div>
          </Field>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={saving || !title.trim()}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {paper ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
