"use client";

import type {
  CourseAssignmentStatus,
  CourseAssignmentType,
  ICourseAssignment,
  ICourseAssignmentFile,
  ICourseAssignmentLink,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Separator } from "@repo/ui/separator";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import {
  ExternalLink,
  GraduationCap,
  Loader2,
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

const ICON = <GraduationCap className="size-4 text-muted-foreground" />;

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

function FieldRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function LaneToggle({
  assessed,
  onChange,
}: {
  assessed: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex gap-4">
      {[
        { label: "Assessed", value: true },
        { label: "Deadline", value: false },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "flex-1 border-b-2 py-1.5 text-xs transition-colors",
            assessed === option.value
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Status as a visible row of transitions rather than a select.
 *
 * On the sheet this was one option in a dropdown among five, which is most of
 * why the field read as decorative. Here the current state and every state it
 * can move to are on screen at once.
 */
function StatusPicker({
  status,
  onChange,
}: {
  status: CourseAssignmentStatus;
  onChange: (value: CourseAssignmentStatus) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ASSIGNMENT_STATUSES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            status === option.value
              ? "border-foreground bg-foreground/5 font-medium"
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            status === option.value && STATUS_TONE[option.value],
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
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
      <DetailNotFound
        {...shell}
        title="Work not found"
        message="This coursework row could not be loaded."
      />
    );
  }

  return (
    <DetailPageShell
      {...shell}
      title={mode === "edit" ? (assignment?.title ?? "Work") : "New work"}
      actions={
        <>
          {assignment && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-destructive hover:text-destructive"
              onClick={remove}
              disabled={deleting || saving}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={submit}
            disabled={!title.trim() || saving || deleting}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <FieldRow label="Title">
            <Input
              value={title}
              autoFocus={mode === "create"}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Lane">
              <LaneToggle assessed={assessed} onChange={setAssessed} />
            </FieldRow>
            <FieldRow label="Type">
              <Select
                value={type}
                onValueChange={(value) =>
                  setType(value as CourseAssignmentType)
                }
              >
                <SelectTrigger>
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
            </FieldRow>
          </div>

          <FieldRow label="Status">
            <StatusPicker status={status} onChange={setStatus} />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Due">
              <DateTimePicker
                value={dueAt || undefined}
                onValueChange={(next) => setDueAt(next ?? "")}
                clearable
                aria-label="Due"
              />
            </FieldRow>
            <FieldRow label="Submitted">
              <p className="py-2 font-mono text-xs tabular-nums text-muted-foreground">
                {assignment?.submittedAt
                  ? new Date(assignment.submittedAt).toLocaleString()
                  : "—"}
              </p>
            </FieldRow>
          </div>

          <FieldRow label="Notes">
            <Textarea
              value={notes}
              rows={5}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FieldRow>
        </div>

        <div className="space-y-5">
          {assessed && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Score">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={score}
                    onChange={(event) => setScore(event.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Max">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={maxScore}
                    onChange={(event) => setMaxScore(event.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Letter">
                  <Input
                    value={letter}
                    onChange={(event) => setLetter(event.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Weight">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                  />
                </FieldRow>
              </div>
              <FieldRow label="Grade notes">
                <Input
                  value={gradeNotes}
                  onChange={(event) => setGradeNotes(event.target.value)}
                />
              </FieldRow>
              <Separator />
            </>
          )}

          <FieldRow label="Links">
            <div className="space-y-2">
              {links.map((link, index) => (
                <div
                  key={link._id ?? `${link.url}-${index}`}
                  className="flex items-center gap-2 border-b border-border/60 pb-1.5"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs hover:underline"
                    onClick={() => platform.openExternal(link.url)}
                  >
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{link.label}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0"
                    onClick={() =>
                      setLinks(links.filter((_, at) => at !== index))
                    }
                    aria-label={`Remove ${link.label}`}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                <Input
                  className="h-8 text-xs"
                  value={linkLabel}
                  placeholder="Label"
                  onChange={(event) => setLinkLabel(event.target.value)}
                />
                <Input
                  className="h-8 text-xs"
                  value={linkUrl}
                  placeholder="https://"
                  onChange={(event) => setLinkUrl(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={addLink}
                  disabled={!linkUrl.trim()}
                  aria-label="Add link"
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Files">
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={file._id ?? `${file.url}-${index}`}
                  className="flex items-center gap-2 border-b border-border/60 pb-1.5"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs hover:underline"
                    onClick={() => platform.openExternal(file.url)}
                  >
                    <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{file.name}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0"
                    onClick={() =>
                      setFiles(files.filter((_, at) => at !== index))
                    }
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                Upload
              </Button>
            </div>
          </FieldRow>
        </div>
      </div>
    </DetailPageShell>
  );
}
