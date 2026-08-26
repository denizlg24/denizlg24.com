"use client";

import type {
  CourseAssignmentStatus,
  CourseAssignmentType,
  ICourseAssignment,
  ICourseAssignmentFile,
  ICourseAssignmentLink,
} from "@repo/schemas";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { SheetFormFooter } from "@repo/ui/sheet-form-footer";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import {
  ExternalLink,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

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

export const ASSIGNMENT_STATUSES: {
  value: CourseAssignmentStatus;
  label: string;
}[] = [
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
  assessed?: boolean;
  status?: CourseAssignmentStatus;
  /** Null clears the stored value; undefined is dropped by JSON and no-ops. */
  dueAt?: string | null;
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
      <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * The lane choice, stated plainly because it is the one decision the triage
 * classifier can get wrong. Flipping to Assessment reveals type and grade; the
 * row starts counting toward the average from that moment.
 */
function LaneToggle({
  assessed,
  onChange,
}: {
  assessed: boolean;
  onChange: (assessed: boolean) => void;
}) {
  return (
    <div className="flex gap-1">
      {[
        { value: true, label: "Assessment" },
        { value: false, label: "Deadline" },
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

export function CourseWorkSheet({
  courseId,
  assignment,
  open,
  onOpenChange,
  onSaved,
  onOpenExternal,
}: {
  courseId: string;
  /** Null opens the sheet in create mode. */
  assignment: ICourseAssignment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  onOpenExternal: (url: string) => void;
}) {
  const { client } = useAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!open) return;
    setTitle(assignment?.title ?? "");
    setAssessed(assignment?.assessed ?? true);
    setType(assignment?.type ?? "assignment");
    setStatus(assignment?.status ?? "planned");
    setDueAt(toDateTimeInput(assignment?.dueAt));
    setNotes(assignment?.notes ?? "");
    setLinks(assignment?.links ?? []);
    setFiles(assignment?.files ?? []);
    setScore(assignment?.grade?.score?.toString() ?? "");
    setMaxScore(assignment?.grade?.maxScore?.toString() ?? "");
    setLetter(assignment?.grade?.letter ?? "");
    setWeight(assignment?.grade?.weight?.toString() ?? "");
    setGradeNotes(assignment?.grade?.notes ?? "");
    setLinkLabel("");
    setLinkUrl("");
  }, [open, assignment]);

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

      const payload: AssignmentPayload = {
        title: title.trim(),
        type,
        assessed,
        status: hasGrade && status === "planned" ? "graded" : status,
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
      await onSaved();
      onOpenChange(false);
    } catch {
      toast.error(assignment ? "Failed to save" : "Failed to add");
    } finally {
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
      await onSaved();
      onOpenChange(false);
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{assignment ? "Edit work" : "New work"}</SheetTitle>
          <SheetDescription className="sr-only">
            Course work record
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <FieldRow label="Title">
            <Input
              value={title}
              autoFocus={!assignment}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FieldRow>

          <FieldRow label="Lane">
            <LaneToggle assessed={assessed} onChange={setAssessed} />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
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
            <FieldRow label="Status">
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as CourseAssignmentStatus)
                }
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
            </FieldRow>
          </div>

          <FieldRow label="Due">
            <Input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </FieldRow>

          {assessed && (
            <>
              <Separator />
              <div className="grid grid-cols-4 gap-2">
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
            </>
          )}

          <Separator />

          <FieldRow label="Notes">
            <Textarea
              value={notes}
              rows={3}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FieldRow>

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
                    onClick={() => onOpenExternal(link.url)}
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
                    onClick={() => onOpenExternal(file.url)}
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

        <SheetFormFooter>
          {assignment && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={remove}
              disabled={deleting || saving}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving || deleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!title.trim() || saving || deleting}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
        </SheetFormFooter>
      </SheetContent>
    </Sheet>
  );
}
