"use client";

import type {
  CourseAssignmentStatus,
  CourseAssignmentType,
  ICourseAssignment,
  ICourseAssignmentFile,
  ICourseAssignmentLink,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  ExternalLink,
  GraduationCap,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import {
  ASSIGNMENT_STATUSES,
  STATUS_TONE,
  statusTransition,
} from "./coursework-status";

export const ASSIGNMENT_TYPES: {
  value: CourseAssignmentType;
  label: string;
}[] = [
  { value: "assignment", label: "Assignment" },
  { value: "exam", label: "Exam" },
  { value: "quiz", label: "Quiz" },
  { value: "project", label: "Project" },
  { value: "lab", label: "Lab" },
  { value: "reading", label: "Reading" },
];

const ICON = <GraduationCap />;
const FORM_ID = "coursework-form";

type LinkDraft = Omit<ICourseAssignmentLink, "_id"> & { _id?: string };
type FileDraft = Omit<ICourseAssignmentFile, "_id"> & { _id?: string };

interface AssignmentPayload {
  title?: string;
  type?: CourseAssignmentType;
  assessed?: boolean;
  status?: CourseAssignmentStatus;
  /** Null clears the stored value; undefined is dropped by JSON and no-ops. */
  dueAt?: string | null;
  submittedAt?: string | null;
  notes?: string;
  links?: LinkDraft[];
  files?: FileDraft[];
  grade?: {
    score?: number;
    maxScore?: number;
    letter?: string;
    weight?: number;
    notes?: string;
    gradedAt?: string;
  } | null;
}

function toDateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeInput(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseNumberInput(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isAssignmentType(value: string): value is CourseAssignmentType {
  return ASSIGNMENT_TYPES.some((option) => option.value === value);
}

export function CourseworkEditorPage({
  courseId,
  workId,
}: {
  courseId: string;
  /** Absent opens the page in create mode. */
  workId?: string;
}) {
  const { client, platform, routes } = useAdmin();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backTo = routes.courses.detail(courseId);
  const mode = workId ? "edit" : "create";

  const [assignment, setAssignment] = useState<ICourseAssignment | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState("");
  const [assessed, setAssessed] = useState(true);
  const [type, setType] = useState<CourseAssignmentType>("assignment");
  const [status, setStatus] = useState<CourseAssignmentStatus>("planned");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [files, setFiles] = useState<FileDraft[]>([]);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [score, setScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [letter, setLetter] = useState("");
  const [weight, setWeight] = useState("");
  const [gradeNotes, setGradeNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const hydrate = useCallback((row: ICourseAssignment | null) => {
    setTitle(row?.title ?? "");
    setAssessed(row?.assessed ?? true);
    setType(row?.type ?? "assignment");
    setStatus(row?.status ?? "planned");
    setDueAt(toDateTimeInput(row?.dueAt));
    setNotes(row?.notes ?? "");
    setLinks(row?.links ?? []);
    setFiles(row?.files ?? []);
    setScore(row?.grade?.score?.toString() ?? "");
    setMaxScore(row?.grade?.maxScore?.toString() ?? "");
    setLetter(row?.grade?.letter ?? "");
    setWeight(row?.grade?.weight?.toString() ?? "");
    setGradeNotes(row?.grade?.notes ?? "");
  }, []);

  const load = useCallback(async () => {
    if (mode !== "edit" || !workId) return;
    setLoading(true);
    try {
      // The list endpoint is the only read for a single row: there is no
      // GET .../assignments/:id, and adding one to serve a page that already
      // has the course loaded would be a second round trip for the same data.
      const result = await client.get<{ assignments: ICourseAssignment[] }>(
        `courses/${courseId}/assignments`,
      );
      const row = result.assignments.find((item) => item._id === workId);
      if (!row) {
        setNotFound(true);
        return;
      }
      setAssignment(row);
      hydrate(row);
    } catch {
      toast.error("Failed to load work");
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [client, courseId, workId, mode, hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const addLink = () => {
    const label = linkLabel.trim() || linkUrl.trim();
    const url = linkUrl.trim();
    if (!label || !url) return;
    setLinks([...links, { label, url }]);
    setLinkLabel("");
    setLinkUrl("");
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await client.upload<{
        url: string;
        id?: string;
        name?: string;
        mimeType?: string;
        size?: number;
      }>("upload/file", formData);
      setFiles([
        ...files,
        {
          _id: result.id ?? result.url,
          name: result.name ?? file.name,
          url: result.url,
          mimeType: result.mimeType,
          size: result.size,
        },
      ]);
      toast.success("File uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      // Grade fields only mean anything in the assessment lane. Sending them
      // for a deadline would put a score on a row that carries no mark.
      const grade = assessed
        ? {
            score: parseNumberInput(score),
            maxScore: parseNumberInput(maxScore),
            letter: letter.trim() || undefined,
            weight: parseNumberInput(weight),
            notes: gradeNotes.trim() || undefined,
            gradedAt:
              score.trim() || letter.trim()
                ? (assignment?.grade?.gradedAt ?? new Date().toISOString())
                : undefined,
          }
        : undefined;
      const hasGrade =
        grade && Object.values(grade).some((value) => value !== undefined);

      const nextStatus = hasGrade && status === "planned" ? "graded" : status;
      const transition = statusTransition(
        assignment ?? { status: "planned", submittedAt: undefined },
        nextStatus,
      );

      const payload: AssignmentPayload = {
        title: title.trim(),
        type,
        assessed,
        ...transition,
        dueAt: fromDateTimeInput(dueAt) ?? null,
        notes: notes.trim() || undefined,
        links,
        files,
        // Clearing the lane clears the grade with it.
        grade: hasGrade ? grade : null,
      };

      if (assignment) {
        await client.patch<{ assignment: ICourseAssignment }>(
          `courses/${courseId}/assignments/${assignment._id}`,
          payload,
        );
      } else {
        await client.post<{ assignment: ICourseAssignment }>(
          `courses/${courseId}/assignments`,
          payload,
        );
      }
      router.push(backTo);
    } catch {
      toast.error(assignment ? "Failed to save" : "Failed to add");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!assignment) return;
    setDeleting(true);
    try {
      await client.del<{ success: true }>(
        `courses/${courseId}/assignments/${assignment._id}`,
      );
      router.push(backTo);
    } catch {
      toast.error("Failed to delete");
      setDeleting(false);
    }
  };

  const shell = { icon: ICON, backTo, backLabel: "Course" } as const;

  if (loading) return <DetailPageSkeleton {...shell} title="Work" rows={2} />;

  if (notFound) {
    return (
      <DetailNotFound {...shell} title="Work not found" message="Not found" />
    );
  }

  return (
    <DetailPageShell
      {...shell}
      title={mode === "edit" ? (assignment?.title ?? "Work") : "New work"}
      actions={
        <>
          {assignment && (
            <ConfirmButton
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={deleting || saving}
                >
                  <Trash2 />
                </Button>
              }
              title={`Delete "${assignment.title}"?`}
              actionLabel="Delete"
              destructive
              pending={deleting}
              onConfirm={remove}
            />
          )}
          <Button
            size="sm"
            type="submit"
            form={FORM_ID}
            disabled={!title.trim() || saving || deleting}
          >
            {saving && <Spinner className="size-3.5" />}
            Save
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="grid gap-x-10 gap-y-8 lg:grid-cols-[1.3fr_1fr]"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <FormField label="Title" htmlFor="work-title">
            <Input
              id="work-title"
              value={title}
              autoFocus={mode === "create"}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>

          <FormGrid>
            <FormField label="Lane">
              <FilterTabs
                value={assessed ? "assessed" : "deadline"}
                onChange={(value) => setAssessed(value === "assessed")}
                options={[
                  { value: "assessed", label: "Assessed" },
                  { value: "deadline", label: "Deadline" },
                ]}
              />
            </FormField>
            <FormField label="Type" htmlFor="work-type">
              <Select
                value={type}
                onValueChange={(value) => {
                  if (isAssignmentType(value)) setType(value);
                }}
              >
                <SelectTrigger id="work-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </FormGrid>

          <FormField label="Status">
            <FilterTabs
              value={status}
              onChange={setStatus}
              options={ASSIGNMENT_STATUSES.map((option) => ({
                value: option.value,
                label: (
                  <span
                    className={cn(
                      status === option.value && STATUS_TONE[option.value],
                    )}
                  >
                    {option.label}
                  </span>
                ),
              }))}
              className="flex-wrap"
            />
          </FormField>

          <FormGrid>
            <FormField label="Due">
              <DateTimePicker
                value={dueAt || undefined}
                onValueChange={(next) => setDueAt(next ?? "")}
                clearable
                aria-label="Due"
              />
            </FormField>
            <FormField label="Submitted">
              <p className="flex h-8 items-center text-sm tabular-nums text-muted-foreground">
                {assignment?.submittedAt
                  ? new Date(assignment.submittedAt).toLocaleString()
                  : "—"}
              </p>
            </FormField>
          </FormGrid>

          <FormField label="Notes" htmlFor="work-notes">
            <Textarea
              id="work-notes"
              value={notes}
              rows={6}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          {assessed && (
            <Section title="Grade">
              <FormGrid>
                <FormField label="Score" htmlFor="work-score">
                  <Input
                    id="work-score"
                    type="number"
                    min="0"
                    step="0.01"
                    value={score}
                    onChange={(event) => setScore(event.target.value)}
                  />
                </FormField>
                <FormField label="Max" htmlFor="work-max">
                  <Input
                    id="work-max"
                    type="number"
                    min="0"
                    step="0.01"
                    value={maxScore}
                    onChange={(event) => setMaxScore(event.target.value)}
                  />
                </FormField>
                <FormField label="Letter" htmlFor="work-letter">
                  <Input
                    id="work-letter"
                    value={letter}
                    onChange={(event) => setLetter(event.target.value)}
                  />
                </FormField>
                <FormField label="Weight %" htmlFor="work-weight">
                  <Input
                    id="work-weight"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                  />
                </FormField>
                <FormField
                  label="Grade notes"
                  htmlFor="work-grade-notes"
                  className="sm:col-span-2"
                >
                  <Input
                    id="work-grade-notes"
                    value={gradeNotes}
                    onChange={(event) => setGradeNotes(event.target.value)}
                  />
                </FormField>
              </FormGrid>
            </Section>
          )}

          <Section title="Links" count={links.length}>
            {links.length > 0 && (
              <List>
                {links.map((link, index) => (
                  <ListRow
                    key={link._id ?? `${link.url}-${index}`}
                    leading={<ExternalLink />}
                    title={link.label}
                    description={link.url}
                    onClick={() => platform.openExternal(link.url)}
                    trailing={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() =>
                          setLinks(links.filter((_, at) => at !== index))
                        }
                        aria-label={`Remove ${link.label}`}
                      >
                        <X />
                      </Button>
                    }
                  />
                ))}
              </List>
            )}
            <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
              <Input
                value={linkLabel}
                placeholder="Label"
                aria-label="Link label"
                onChange={(event) => setLinkLabel(event.target.value)}
              />
              <Input
                value={linkUrl}
                placeholder="https://"
                aria-label="Link URL"
                onChange={(event) => setLinkUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLink();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addLink}
                disabled={!linkUrl.trim()}
                aria-label="Add link"
              >
                <Plus />
              </Button>
            </div>
          </Section>

          <Section
            title="Files"
            count={files.length}
            actions={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Spinner className="size-3" /> : <Upload />}
                Upload
              </Button>
            }
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleUpload}
            />
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <List>
                {files.map((file, index) => (
                  <ListRow
                    key={file._id ?? `${file.url}-${index}`}
                    leading={<Paperclip />}
                    title={file.name}
                    onClick={() => platform.openExternal(file.url)}
                    trailing={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() =>
                          setFiles(files.filter((_, at) => at !== index))
                        }
                        aria-label={`Remove ${file.name}`}
                      >
                        <X />
                      </Button>
                    }
                  />
                ))}
              </List>
            )}
          </Section>
        </div>
      </form>
    </DetailPageShell>
  );
}
