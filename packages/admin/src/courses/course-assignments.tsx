"use client";

import type {
  CourseAssignmentStatus,
  CourseAssignmentType,
  ICourseAssignment,
  ICourseAssignmentFile,
  ICourseAssignmentLink,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
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
  Loader2,
  Paperclip,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

const ASSIGNMENT_TYPES: { value: CourseAssignmentType; label: string }[] = [
  { value: "assignment", label: "Assignment" },
  { value: "exam", label: "Exam" },
  { value: "quiz", label: "Quiz" },
  { value: "project", label: "Project" },
  { value: "lab", label: "Lab" },
  { value: "reading", label: "Reading" },
  { value: "other", label: "Other" },
];

const ASSIGNMENT_STATUSES: { value: CourseAssignmentStatus; label: string }[] =
  [
    { value: "planned", label: "Planned" },
    { value: "in-progress", label: "In progress" },
    { value: "submitted", label: "Submitted" },
    { value: "graded", label: "Graded" },
    { value: "archived", label: "Archived" },
  ];

type LinkDraft = Omit<ICourseAssignmentLink, "_id"> & { _id?: string };
type FileDraft = Omit<ICourseAssignmentFile, "_id"> & { _id?: string };

interface AssignmentPayload {
  title?: string;
  type?: CourseAssignmentType;
  status?: CourseAssignmentStatus;
  dueAt?: string;
  submittedAt?: string;
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
  };
}

function fromDateTimeInput(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseNumberInput(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildGradePayload({
  score,
  maxScore,
  letter,
  weight,
  notes,
}: {
  score: string;
  maxScore: string;
  letter: string;
  weight: string;
  notes?: string;
}) {
  const payload = {
    score: parseNumberInput(score),
    maxScore: parseNumberInput(maxScore),
    letter: letter.trim() || undefined,
    weight: parseNumberInput(weight),
    notes: notes?.trim() || undefined,
    gradedAt:
      score.trim() || letter.trim() ? new Date().toISOString() : undefined,
  };
  return Object.values(payload).some((value) => value !== undefined)
    ? payload
    : undefined;
}

function gradePercent(assignment: ICourseAssignment) {
  const score = assignment.grade?.score;
  const maxScore = assignment.grade?.maxScore;
  if (score === undefined || maxScore === undefined || maxScore <= 0) {
    return null;
  }
  return (score / maxScore) * 100;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(1)}%`;
}

function formatGrade(assignment: ICourseAssignment) {
  const grade = assignment.grade;
  if (!grade) return "Ungraded";
  const parts = [];
  if (grade.score !== undefined && grade.maxScore !== undefined) {
    parts.push(`${grade.score}/${grade.maxScore}`);
  }
  if (grade.letter) parts.push(grade.letter);
  const percent = gradePercent(assignment);
  if (percent !== null) parts.push(formatPercent(percent));
  return parts.join(" · ") || "Ungraded";
}

function statusTone(
  status: CourseAssignmentStatus,
): "default" | "secondary" | "outline" {
  if (status === "graded") return "default";
  if (status === "submitted") return "secondary";
  if (status === "archived") return "outline";
  return "outline";
}

function InlineEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function AssignmentComposer({
  courseId,
  onCancel,
  onSaved,
}: {
  courseId: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
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
  const [uploading, setUploading] = useState(false);

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
      const grade = buildGradePayload({
        score,
        maxScore,
        letter,
        weight,
        notes: gradeNotes,
      });
      const payload: AssignmentPayload = {
        title: title.trim(),
        type,
        status: grade && status === "planned" ? "graded" : status,
        dueAt: fromDateTimeInput(dueAt),
        notes: notes.trim() || undefined,
        links,
        files,
        ...(grade ? { grade } : {}),
      };
      await client.post<{ assignment: ICourseAssignment }>(
        `courses/${courseId}/assignments`,
        payload,
      );
      toast.success("Assignment added");
      await onSaved();
      onCancel();
    } catch {
      toast.error("Failed to add assignment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_9rem_10rem]">
        <Input
          value={title}
          placeholder="Assignment, exam, or quiz"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Select
          value={type}
          onValueChange={(value) => setType(value as CourseAssignmentType)}
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
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as CourseAssignmentStatus)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNMENT_STATUSES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[13rem_1fr]">
        <Input
          type="datetime-local"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />
        <Textarea
          className="min-h-10"
          value={notes}
          placeholder="Notes"
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <Separator className="my-3" />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs">URLs</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[0.7fr_1fr_auto]">
            <Input
              value={linkLabel}
              placeholder="Label"
              onChange={(event) => setLinkLabel(event.target.value)}
            />
            <Input
              value={linkUrl}
              placeholder="https://..."
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
            >
              <Plus className="size-4" />
            </Button>
          </div>
          {links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {links.map((link, index) => (
                <Badge key={`${link.url}-${index}`} variant="secondary">
                  <span className="max-w-40 truncate">{link.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setLinks(links.filter((_, current) => current !== index))
                    }
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Files</Label>
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
            className="h-9"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {uploading ? "Uploading" : "Upload file"}
          </Button>
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((file, index) => (
                <div
                  key={`${file.url}-${index}`}
                  className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                >
                  <Paperclip className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setFiles(files.filter((_, current) => current !== index))
                    }
                  >
                    <X className="size-3 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator className="my-3" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-[6rem_6rem_5rem_5rem_1fr]">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={score}
          placeholder="Score"
          onChange={(event) => setScore(event.target.value)}
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          value={maxScore}
          placeholder="Max"
          onChange={(event) => setMaxScore(event.target.value)}
        />
        <Input
          value={letter}
          placeholder="Letter"
          onChange={(event) => setLetter(event.target.value)}
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          value={weight}
          placeholder="Weight"
          onChange={(event) => setWeight(event.target.value)}
        />
        <Input
          value={gradeNotes}
          placeholder="Grade notes"
          onChange={(event) => setGradeNotes(event.target.value)}
        />
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={!title.trim() || saving}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function AssignmentRow({
  courseId,
  assignment,
  onOpenExternal,
  onSaved,
}: {
  courseId: string;
  assignment: ICourseAssignment;
  onOpenExternal: (url: string) => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [status, setStatus] = useState<CourseAssignmentStatus>(
    assignment.status,
  );
  const [score, setScore] = useState(assignment.grade?.score?.toString() ?? "");
  const [maxScore, setMaxScore] = useState(
    assignment.grade?.maxScore?.toString() ?? "",
  );
  const [letter, setLetter] = useState(assignment.grade?.letter ?? "");
  const [weight, setWeight] = useState(
    assignment.grade?.weight?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const grade = buildGradePayload({ score, maxScore, letter, weight });
      const payload: AssignmentPayload = {
        status: grade && status === "planned" ? "graded" : status,
        ...(grade ? { grade } : {}),
      };
      await client.patch<{ assignment: ICourseAssignment }>(
        `courses/${courseId}/assignments/${assignment._id}`,
        payload,
      );
      toast.success("Assignment updated");
      await onSaved();
    } catch {
      toast.error("Failed to update assignment");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await client.del<{ success: true }>(
        `courses/${courseId}/assignments/${assignment._id}`,
      );
      toast.success("Assignment deleted");
      await onSaved();
    } catch {
      toast.error("Failed to delete assignment");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-md border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-medium">
              {assignment.title}
            </h3>
            <Badge variant="outline">{assignment.type}</Badge>
            <Badge variant={statusTone(assignment.status)}>
              {assignment.status}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {assignment.dueAt && (
              <span>Due {formatDateTime(assignment.dueAt)}</span>
            )}
            {assignment.submittedAt && (
              <span>Submitted {formatDateTime(assignment.submittedAt)}</span>
            )}
            <span>{formatGrade(assignment)}</span>
          </div>
          {assignment.notes && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {assignment.notes}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          onClick={remove}
          disabled={deleting}
        >
          {deleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      </div>

      {(assignment.links.length > 0 || assignment.files.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {assignment.links.map((link) => (
            <Button
              key={link._id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenExternal(link.url)}
            >
              <ExternalLink className="size-3.5" />
              {link.label}
            </Button>
          ))}
          {assignment.files.map((file) => (
            <Button
              key={file._id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenExternal(file.url)}
            >
              <Paperclip className="size-3.5" />
              {file.name}
            </Button>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-[9rem_5rem_5rem_5rem_5rem_auto]">
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as CourseAssignmentStatus)}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNMENT_STATUSES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-8"
          type="number"
          min="0"
          step="0.01"
          value={score}
          placeholder="Score"
          onChange={(event) => setScore(event.target.value)}
        />
        <Input
          className="h-8"
          type="number"
          min="0"
          step="0.01"
          value={maxScore}
          placeholder="Max"
          onChange={(event) => setMaxScore(event.target.value)}
        />
        <Input
          className="h-8"
          value={letter}
          placeholder="Letter"
          onChange={(event) => setLetter(event.target.value)}
        />
        <Input
          className="h-8"
          type="number"
          min="0"
          step="0.01"
          value={weight}
          placeholder="Weight"
          onChange={(event) => setWeight(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          onClick={save}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function CourseAssignmentsPanel({
  courseId,
  assignments,
  onOpenExternal,
  onRefresh,
}: {
  courseId: string;
  assignments: ICourseAssignment[];
  onOpenExternal: (url: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const visibleAssignments = assignments.filter(
    (assignment) => assignment.status !== "archived",
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {visibleAssignments.length} active record
          {visibleAssignments.length === 1 ? "" : "s"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>

      {adding && (
        <AssignmentComposer
          courseId={courseId}
          onCancel={() => setAdding(false)}
          onSaved={onRefresh}
        />
      )}

      {visibleAssignments.length === 0 && !adding ? (
        <InlineEmpty label="No assignments or exams yet" />
      ) : (
        visibleAssignments.map((assignment) => (
          <AssignmentRow
            key={assignment._id}
            courseId={courseId}
            assignment={assignment}
            onOpenExternal={onOpenExternal}
            onSaved={onRefresh}
          />
        ))
      )}
    </div>
  );
}

export function CourseGradebookPanel({
  assignments,
  gradeAverage,
}: {
  assignments: ICourseAssignment[];
  gradeAverage: number | null;
}) {
  const graded = assignments.filter(
    (assignment) => assignment.grade && assignment.status !== "archived",
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md border px-3 py-3">
        <div className="font-mono text-2xl leading-none">
          {formatPercent(gradeAverage)}
        </div>
        <div className="mt-1 text-[10px] uppercase text-muted-foreground">
          Weighted average
        </div>
      </div>

      {graded.length === 0 ? (
        <InlineEmpty label="No grades recorded" />
      ) : (
        <div className="space-y-2">
          {graded.map((assignment) => {
            const percent = gradePercent(assignment);
            return (
              <div key={assignment._id} className="rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {assignment.title}
                  </span>
                  <Badge variant="outline">{assignment.type}</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">
                    {formatGrade(assignment)}
                  </span>
                  {assignment.grade?.weight !== undefined && (
                    <span
                      className={cn(
                        "ml-auto rounded-sm bg-muted px-1.5 py-0.5",
                        percent !== null && percent < 60 && "text-destructive",
                      )}
                    >
                      {assignment.grade.weight}% weight
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
