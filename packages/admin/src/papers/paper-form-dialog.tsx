"use client";

import type {
  IPaper,
  KanbanPriority,
  PaperAuthor,
  PaperCourseRef,
  PaperFile,
  PaperLookupKind,
  PaperMutation,
  PaperType,
  ResolvedPaperMetadata,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs } from "@repo/ui/toolbar";
import {
  ChevronDown,
  FileUp,
  Library,
  Search,
  Sigma,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { fromDateInput, toDateInput } from "./reading";

/**
 * Which kind of thing is being added. It decides the lookup source and which
 * bibliographic fields are worth showing — a lecture PDF has no venue, a book
 * has no arXiv id.
 */
type FormMode = "paper" | "book" | "document";

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
  "notes",
  "slides",
  "dataset",
  "other",
];

const MODE_TABS: Array<{
  value: FormMode;
  label: string;
  icon: typeof Sigma;
}> = [
  { value: "paper", label: "Paper", icon: Sigma },
  { value: "book", label: "Book", icon: Library },
  { value: "document", label: "Document", icon: Upload },
];

const MODE_LOOKUP: Record<
  FormMode,
  { kind: PaperLookupKind; placeholder: string } | null
> = {
  paper: {
    kind: "academic",
    placeholder: "DOI, arXiv id, Semantic Scholar URL, or title",
  },
  book: { kind: "book", placeholder: "ISBN or title" },
  document: null,
};

const MODE_DEFAULT_TYPE: Record<FormMode, PaperType> = {
  paper: "article",
  book: "book",
  document: "notes",
};

const BOOKISH_TYPES: PaperType[] = ["book", "chapter"];
const ACADEMIC_TYPES: PaperType[] = [
  "article",
  "conference",
  "preprint",
  "thesis",
  "dataset",
];

/**
 * Which tab an existing reading reopens on. Editing must land on the fields
 * that were filled in, not on whichever tab happens to be first.
 */
function modeForPaper(paper: IPaper): FormMode {
  if (BOOKISH_TYPES.includes(paper.type)) return "book";
  if (ACADEMIC_TYPES.includes(paper.type)) return "paper";
  if (paper.doi || paper.arxivId || paper.venue) return "paper";
  if (paper.isbn.length > 0) return "book";
  return "document";
}

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

/**
 * "Family, Given" splits; anything else is kept literal. An institutional
 * author ("MIT OpenCourseWare") and a single lecturer's name both survive
 * unmangled, which is what the lecture-notes case needs.
 */
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
  const [mode, setMode] = useState<FormMode>("paper");
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
  const [edition, setEdition] = useState("");
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
  const [typeTouched, setTypeTouched] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
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
    const nextMode = paper ? modeForPaper(paper) : "paper";
    setMode(nextMode);
    setIdentifier("");
    setTitle(paper?.title ?? "");
    setAuthors(authorsToText(paper?.authors ?? []));
    setAbstract(paper?.abstract ?? "");
    setType(paper?.type ?? MODE_DEFAULT_TYPE[nextMode]);
    setYear(paper?.year ? String(paper.year) : "");
    setVenue(paper?.venue ?? "");
    setPublisher(paper?.publisher ?? "");
    setVolume(paper?.volume ?? "");
    setIssue(paper?.issue ?? "");
    setPages(paper?.pages ?? "");
    setEdition(paper?.edition ?? "");
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
    setTypeTouched(Boolean(paper));
    setShowAllFields(false);
  }, [open, paper]);

  // Switching tabs on a fresh entry re-picks the default type; once the type
  // has been chosen by hand or come back from a lookup, the tab stops
  // overriding it.
  const changeMode = (next: FormMode) => {
    setMode(next);
    setIdentifier("");
    if (!typeTouched) setType(MODE_DEFAULT_TYPE[next]);
  };

  const applyMetadata = (metadata: ResolvedPaperMetadata) => {
    setResolvedMetadata(metadata);
    setTitle(metadata.title);
    setAuthors(authorsToText(metadata.authors ?? []));
    setAbstract(metadata.abstract ?? "");
    setType(metadata.type ?? MODE_DEFAULT_TYPE[mode]);
    setTypeTouched(true);
    setYear(metadata.year ? String(metadata.year) : "");
    setVenue(metadata.venue ?? "");
    setPublisher(metadata.publisher ?? "");
    setVolume(metadata.volume ?? "");
    setIssue(metadata.issue ?? "");
    setPages(metadata.pages ?? "");
    setEdition(metadata.edition ?? "");
    setDoi(metadata.doi ?? "");
    setArxivId(metadata.arxivId ?? "");
    setArxivCategory(metadata.arxivCategory ?? "");
    setUrl(metadata.url ?? "");
    setIsbn(listToText(metadata.isbn ?? []));
    setIssn(listToText(metadata.issn ?? []));
    setMetadataSource(metadata.metadataSource ?? "manual");
    setMetadataFetchedAt(metadata.metadataFetchedAt);
    // Resolving against Crossref, arXiv, OpenAlex or a book catalogue is
    // exactly the evidence that makes something citable, so flip it unless it
    // was set by hand.
    if (!citableTouched) setCitable(true);
  };

  const lookup = MODE_LOOKUP[mode];

  const handleLookup = async () => {
    if (!lookup || !identifier.trim()) return;
    setLookingUp(true);
    try {
      const result = await client.post<{ metadata: ResolvedPaperMetadata }>(
        "papers/resolve",
        { identifier, kind: lookup.kind },
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
    const result = await client.uploadFile<{ pdf: PaperFile }>(
      "papers/upload",
      pdfFile,
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
        edition,
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

  const isBookish = BOOKISH_TYPES.includes(type);
  const showBookFields = showAllFields || mode === "book" || isBookish;
  const showAcademicFields =
    showAllFields ||
    (mode === "paper" && !isBookish) ||
    Boolean(doi || arxivId);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={paper ? "Edit reading" : "Add reading"}
      size="lg"
      onSubmit={handleSubmit}
      submitLabel={paper ? "Save" : "Add"}
      submitDisabled={!title.trim()}
      pending={saving}
    >
      <div className="flex flex-col gap-3">
        <FilterTabs
          value={mode}
          onChange={changeMode}
          options={MODE_TABS.map((tab) => ({
            value: tab.value,
            label: (
              <>
                <tab.icon className="size-3.5" />
                {tab.label}
              </>
            ),
          }))}
        />

        {lookup && (
          <div className="flex gap-2">
            <Input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              onKeyDown={(event) => {
                // Enter resolves here rather than submitting the form.
                if (event.key !== "Enter") return;
                event.preventDefault();
                void handleLookup();
              }}
              placeholder={lookup.placeholder}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              disabled={lookingUp || !identifier.trim()}
              onClick={() => void handleLookup()}
            >
              {lookingUp ? <Spinner className="size-3.5" /> : <Search />}
              Resolve
            </Button>
          </div>
        )}
      </div>

      <FormGrid>
        <FormField label="PDF" className="sm:col-span-2">
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
            className="w-full justify-start font-normal"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp />
            {pdfFile?.name ?? paper?.pdf?.fileName ?? "Choose PDF"}
          </Button>
        </FormField>

        <FormField label="Title" className="sm:col-span-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField label="Authors" className="sm:col-span-2">
          <Textarea
            value={authors}
            onChange={(event) => setAuthors(event.target.value)}
            className="min-h-16 font-mono text-xs"
            placeholder="Family, Given — one per line"
          />
        </FormField>
        <FormField label="Type">
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value as PaperType);
              setTypeTouched(true);
            }}
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
        </FormField>
        <FormField label="Year">
          <Input
            type="number"
            min={1000}
            max={3000}
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
        </FormField>

        {(showBookFields || showAcademicFields) && (
          <FormField label="Pages">
            <Input
              value={pages}
              onChange={(event) => setPages(event.target.value)}
            />
          </FormField>
        )}

        {showBookFields && (
          <>
            <FormField label="Publisher">
              <Input
                value={publisher}
                onChange={(event) => setPublisher(event.target.value)}
              />
            </FormField>
            <FormField label="Edition">
              <Input
                value={edition}
                onChange={(event) => setEdition(event.target.value)}
              />
            </FormField>
            <FormField label="ISBN">
              <Input
                value={isbn}
                onChange={(event) => setIsbn(event.target.value)}
                className="font-mono text-xs"
              />
            </FormField>
          </>
        )}

        {showAcademicFields && (
          <>
            <FormField label="Venue">
              <Input
                value={venue}
                onChange={(event) => setVenue(event.target.value)}
              />
            </FormField>
            <FormField label="Volume / issue">
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
            </FormField>
            <FormField label="DOI">
              <Input
                value={doi}
                onChange={(event) => setDoi(event.target.value)}
                className="font-mono text-xs"
              />
            </FormField>
            <FormField label="arXiv">
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
            </FormField>
          </>
        )}

        <FormField label="Classes" className="sm:col-span-2">
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
            <div className="flex flex-wrap gap-1">
              {courseIds.map((courseId) => {
                const course = courses.find(
                  (candidate) => candidate._id === courseId,
                );
                return (
                  <Badge
                    key={courseId}
                    variant="secondary"
                    className="h-6 gap-1 pr-0.5 text-xs font-normal"
                  >
                    {course?.code || course?.name || courseId}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setCourseIds((current) =>
                          current.filter((id) => id !== courseId),
                        )
                      }
                      aria-label={`Unlink ${course?.name ?? "class"}`}
                    >
                      <X />
                    </Button>
                  </Badge>
                );
              })}
            </div>
          )}
        </FormField>

        <FormField label="Due">
          <Input
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </FormField>
        <FormField label="Priority">
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
        </FormField>

        <FormField label="Tags" className="sm:col-span-2">
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="comma separated"
          />
        </FormField>

        <FormField label="Citable" className="sm:col-span-2">
          <div className="flex items-center gap-3">
            <Switch
              checked={citable}
              onCheckedChange={(next) => {
                setCitable(next);
                setCitableTouched(true);
              }}
            />
            <span className="text-xs text-muted-foreground">
              {citable ? "Bibliography" : "Reading only"}
            </span>
          </div>
        </FormField>

        {!showAllFields && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAllFields(true)}
            className="justify-self-start text-muted-foreground sm:col-span-2"
          >
            <ChevronDown />
            All fields
          </Button>
        )}

        {showAllFields && (
          <>
            <FormField label="URL" className="sm:col-span-2">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </FormField>
            <FormField label="Citation key">
              <Input
                value={citationKey}
                onChange={(event) => setCitationKey(event.target.value)}
                placeholder="auto"
                className="font-mono text-xs"
              />
            </FormField>
            <FormField label="ISSN">
              <Input
                value={issn}
                onChange={(event) => setIssn(event.target.value)}
                className="font-mono text-xs"
              />
            </FormField>
            <FormField label="Abstract" className="sm:col-span-2">
              <Textarea
                value={abstract}
                onChange={(event) => setAbstract(event.target.value)}
                className="min-h-28"
              />
            </FormField>
          </>
        )}
      </FormGrid>
    </FormDialog>
  );
}
