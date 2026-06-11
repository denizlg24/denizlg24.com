"use client";

import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  ExternalLink,
  FileText,
  Pencil,
  Save,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  IKanbanCard,
  IKanbanColumn,
  KanbanPriority,
} from "@/lib/data-types";

type ColumnMeta = Pick<IKanbanColumn, "_id" | "title">;

interface CardDialogProps {
  card: IKanbanCard;
  columns: ColumnMeta[];
  onClose: () => void;
  onUpdate: (cardId: string, updates: Partial<IKanbanCard>) => Promise<void>;
  onDelete: (cardId: string) => Promise<void>;
}

const NOTE_LINK_RE = /^\[note\]\(([^,]+),(.+)\)$/;

const PRIORITIES: { value: KanbanPriority; label: string }[] = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const PRIORITY_BADGE: Record<
  KanbanPriority,
  { label: string; className: string } | null
> = {
  none: null,
  low: {
    label: "Low",
    className:
      "bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-900",
  },
  medium: {
    label: "Medium",
    className:
      "bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-900",
  },
  high: {
    label: "High",
    className:
      "bg-orange-50 text-orange-600 border border-orange-100 dark:bg-orange-950/60 dark:text-orange-400 dark:border-orange-900",
  },
  urgent: {
    label: "Urgent",
    className:
      "bg-red-50 text-red-600 border border-red-100 dark:bg-red-950/60 dark:text-red-400 dark:border-red-900",
  },
};

export function CardDialog({
  card,
  columns,
  onClose,
  onUpdate,
  onDelete,
}: CardDialogProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [priority, setPriority] = useState<KanbanPriority>(card.priority);
  const [columnId, setColumnId] = useState(card.columnId);
  const [dueDate, setDueDate] = useState(
    card.dueDate ? format(new Date(card.dueDate), "yyyy-MM-dd") : "",
  );
  const [labelInput, setLabelInput] = useState((card.labels ?? []).join(", "));
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const router = useRouter();
  const noteMatch = NOTE_LINK_RE.exec(card.description ?? "");
  const linkedNote = noteMatch
    ? { id: noteMatch[1], name: noteMatch[2] }
    : null;

  const handleSave = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    await onUpdate(card._id, {
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      columnId,
      dueDate: dueDate ? (new Date(dueDate) as unknown as Date) : undefined,
      labels: labelInput
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
    });
    setIsSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    await onDelete(card._id);
    onClose();
  };

  const columnName = columns.find((c) => c._id === card.columnId)?.title;
  const priorityBadge = PRIORITY_BADGE[card.priority];
  const isPastDue = card.dueDate && new Date(card.dueDate) < new Date();

  if (editing) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Card</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="card-title">Title</Label>
              <Input
                id="card-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="font-medium"
              />
            </div>

            {linkedNote && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-muted/50 border">
                <FileText className="size-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Linked note</p>
                  <p className="text-sm font-medium truncate">
                    {linkedNote.name}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    onClose();
                    router.push(`/dashboard/notes?note=${linkedNote.id}`);
                  }}
                >
                  <ExternalLink className="size-3.5" />
                  Open
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="card-desc">Description</Label>
              <Textarea
                id="card-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description… (supports Markdown)"
                rows={6}
                className="resize-none font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as KanbanPriority)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Column</Label>
                <Select value={columnId} onValueChange={setColumnId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((col) => (
                      <SelectItem key={col._id} value={col._id}>
                        {col.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Due Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="justify-start font-normal w-full"
                  >
                    <CalendarDays className="size-4 shrink-0" />
                    {dueDate ? format(new Date(dueDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate ? new Date(dueDate) : undefined}
                    onSelect={(day) => {
                      if (!day) {
                        setDueDate("");
                        return;
                      }
                      setDueDate(format(day, "yyyy-MM-dd"));
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="card-labels">
                Labels{" "}
                <span className="text-muted-foreground text-xs font-normal">
                  (comma-separated)
                </span>
              </Label>
              <Input
                id="card-labels"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="bug, design, backend…"
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-destructive">
                    Delete this card?
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleDelete}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  <X className="size-3.5" />
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !title.trim()}
                  size="sm"
                >
                  <Save className="size-3.5" />
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const hasDetails =
    priorityBadge || card.dueDate || (card.labels && card.labels.length > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-start gap-4 pr-1">
            <div className="flex-1 min-w-0 space-y-1">
              <DialogTitle className="text-lg leading-snug">
                {card.title}
              </DialogTitle>
              {columnName && (
                <DialogDescription className="flex items-center gap-1.5">
                  {columnName}
                </DialogDescription>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setEditing(true)}
                className="size-8"
              >
                <Pencil className="size-3.5" />
                <span className="sr-only">Edit</span>
              </Button>
              <DialogClose asChild>
                <Button size="icon" variant="ghost" className="size-8">
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        {hasDetails && (
          <>
            <Separator />
            <div className="space-y-2.5 text-sm">
              {priorityBadge && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>Priority:</span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full leading-none ${priorityBadge.className}`}
                  >
                    {priorityBadge.label}
                  </span>
                </div>
              )}
              {card.dueDate && (
                <div
                  className={`flex items-center gap-2 ${
                    isPastDue ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  <CalendarDays className="size-4 shrink-0" />
                  <span>
                    {isPastDue ? "Overdue: " : "Due "}
                    {format(new Date(card.dueDate), "PPP")}
                  </span>
                </div>
              )}
              {card.labels && card.labels.length > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Tag className="size-4 shrink-0" />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {card.labels.map((label) => (
                      <span
                        key={label}
                        className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {linkedNote && (
          <>
            <Separator />
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-muted/50 border">
              <FileText className="size-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Linked note</p>
                <p className="text-sm font-medium truncate">
                  {linkedNote.name}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  onClose();
                  router.push(`/dashboard/notes?note=${linkedNote.id}`);
                }}
              >
                <ExternalLink className="size-3.5" />
                Open
              </Button>
            </div>
          </>
        )}

        {card.description && !linkedNote ? (
          <>
            <Separator />
            <div className="overflow-auto">
              <MarkdownRenderer
                content={card.description}
                className="text-sm *:text-sm! [&_p]:text-sm! [&_p]:leading-relaxed! [&_p]:mb-3! [&_h1]:text-lg! [&_h2]:text-base! [&_h3]:text-sm! [&_pre]:text-xs! [&_pre]:my-3! [&>*:last-child]:mb-0!"
              />
            </div>
          </>
        ) : (
          !linkedNote && (
            <>
              <Separator />
              <p className="text-sm text-muted-foreground italic">
                No description
              </p>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
