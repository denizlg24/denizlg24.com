"use client";

import {
  ArrowLeft,
  Calendar as CalendarIcon,
  ExternalLink,
  FileText,
  FolderTree,
  Image as ImageIcon,
  Link as LinkIcon,
  Shapes,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TagAutocomplete } from "@/app/dashboard/notes/_components/tag-autocomplete";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
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
import type { denizApi } from "@/lib/api-wrapper";
import type { INote, INoteEdge, INoteGroup } from "@/lib/data-types";
import { buildPathLabelMap } from "@/lib/note-group-tree";
import { GroupTreeCombobox } from "./group-tree-combobox";
import { NoteEditor } from "./note-editor";

function formatDate(value: string | Date | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTime(value: string | Date | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface Props {
  note: INote;
  allNotes: INote[];
  groups: INoteGroup[];
  edges: INoteEdge[];
  suggestions: string[];
  onPatch: (body: Record<string, unknown>) => Promise<INote | null>;
  onDelete: () => Promise<void>;
  onBack: () => void;
  onSelectNote: (note: INote) => void;
  onSuggestionsChange: (next: string[]) => void;
  onUpdated: (note: INote) => void;
  api: denizApi | null;
  mode?: "existing" | "draft";
  onSaveDraft?: (content: string) => Promise<void>;
  savingDraft?: boolean;
  onCategorize?: () => Promise<void>;
}

export function NoteDetail({
  note,
  allNotes,
  groups,
  edges,
  suggestions,
  onPatch,
  onDelete,
  onBack,
  onSelectNote,
  onSuggestionsChange,
  onUpdated,
  api,
  mode = "existing",
  onSaveDraft,
  savingDraft = false,
  onCategorize,
}: Props) {
  const isDraft = mode === "draft";
  const [title, setTitle] = useState(note.title);
  const [initialTitle, setInitialTitle] = useState(note.title);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(note.title);
    setInitialTitle(note.title);
  }, [note.title]);

  const saveTitle = useCallback(
    async (nextTitle: string) => {
      if (isDraft) return;
      const trimmed = nextTitle.trim();
      if (!trimmed || trimmed === initialTitle) return;
      const updated = await onPatch({ title: trimmed });
      if (updated) {
        setInitialTitle(updated.title);
        setTitle(updated.title);
      }
    },
    [initialTitle, isDraft, onPatch],
  );

  const scheduleTitleSave = (nextTitle: string) => {
    setTitle(nextTitle);
    if (isDraft) {
      void onPatch({ title: nextTitle });
      return;
    }
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(() => {
      void saveTitle(nextTitle);
    }, 700);
  };

  const relatedNotes = useMemo(() => {
    const relatedIds = new Set<string>();
    for (const edge of edges) {
      if (edge.from === note._id) relatedIds.add(edge.to);
      else if (edge.to === note._id) relatedIds.add(edge.from);
    }
    return allNotes.filter((candidate) => relatedIds.has(candidate._id));
  }, [allNotes, edges, note._id]);

  const noteGroups = useMemo(
    () =>
      (note.groupIds ?? [])
        .map((groupId) => groups.find((group) => group._id === groupId))
        .filter((group): group is INoteGroup => Boolean(group)),
    [groups, note.groupIds],
  );
  const pathLabelById = useMemo(() => buildPathLabelMap(groups), [groups]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back">
            <ArrowLeft className="size-4" />
          </Button>
          {note.favicon ? (
            <Image
              src={note.favicon}
              alt=""
              width={16}
              height={16}
              className="size-4 rounded-sm"
              unoptimized
            />
          ) : (
            <FileText className="size-4" />
          )}
          <span className="truncate text-xs text-muted-foreground">
            {isDraft
              ? "Paste a link to import it, or write a note and create it"
              : note.url
                ? note.siteName || safeHostname(note.url)
                : "Markdown note"}
          </span>
        </div>
        {!isDraft && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the note and its related edges.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full px-6 py-6">
          <Input
            autoFocus={isDraft}
            value={title}
            onChange={(event) => scheduleTitleSave(event.target.value)}
            onBlur={() => {
              if (!isDraft) void saveTitle(title);
            }}
            className="h-auto! border-none bg-transparent px-0 py-1 text-2xl font-semibold shadow-none focus-visible:ring-0"
            placeholder="Untitled note"
          />

          <div className="mt-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Properties
            </h2>
            <div className="divide-y border-y text-xs">
              {!isDraft && (
                <PropertyRow
                  icon={<CalendarIcon className="size-3" />}
                  label="created_on"
                >
                  <span className="text-muted-foreground">
                    {formatDate(note.createdAt)}
                  </span>
                </PropertyRow>
              )}

              <PropertyRow
                icon={<CalendarIcon className="size-3" />}
                label="published"
              >
                <DateProperty
                  value={note.publishedDate}
                  onChange={(next) =>
                    void onPatch({
                      publishedDate: next ? next.toISOString() : null,
                    })
                  }
                />
              </PropertyRow>

              {note.url && (
                <PropertyRow
                  icon={<LinkIcon className="size-3" />}
                  label="source"
                >
                  <a
                    href={note.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                  >
                    <span className="truncate">{note.url}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </PropertyRow>
              )}

              {note.image && (
                <PropertyRow
                  icon={<ImageIcon className="size-3" />}
                  label="image"
                >
                  <a
                    href={note.image}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                  >
                    <span className="truncate">{note.image}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </PropertyRow>
              )}

              <PropertyRow icon={<Shapes className="size-3" />} label="class">
                <ClassProperty
                  value={note.class || ""}
                  onCommit={(next) => void onPatch({ class: next })}
                />
              </PropertyRow>

              <PropertyRow icon={<TagIcon className="size-3" />} label="tags">
                <TagAutocomplete
                  value={note.tags ?? []}
                  suggestions={suggestions}
                  onChange={(next) => {
                    void onPatch({ tags: next }).then(() => {
                      const existing = new Set(suggestions);
                      const added = next.filter((tag) => !existing.has(tag));
                      if (added.length > 0) {
                        onSuggestionsChange(
                          [...suggestions, ...added].sort((left, right) =>
                            left.localeCompare(right),
                          ),
                        );
                      }
                    });
                  }}
                />
              </PropertyRow>

              <PropertyRow
                icon={<FolderTree className="size-3" />}
                label="groups"
              >
                <GroupTreeCombobox
                  groups={groups}
                  value={note.groupIds ?? []}
                  onChange={(next) => void onPatch({ groupIds: next })}
                  placeholder="Add group…"
                  searchPlaceholder="Search group hierarchy…"
                  emptyMessage="No groups yet"
                />
              </PropertyRow>

              {!isDraft && (
                <PropertyRow
                  icon={<LinkIcon className="size-3" />}
                  label="related"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    {relatedNotes.length === 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        None
                      </span>
                    )}
                    {relatedNotes.map((related) => (
                      <button
                        key={related._id}
                        type="button"
                        onClick={() => onSelectNote(related)}
                        className="inline-flex items-center gap-1 rounded-md border bg-muted/20 px-1.5 py-0.5 text-[10px] hover:bg-muted"
                      >
                        {related.favicon ? (
                          <Image
                            src={related.favicon}
                            alt=""
                            width={10}
                            height={10}
                            className="size-2.5 rounded-sm"
                            unoptimized
                          />
                        ) : (
                          <FileText className="size-2.5" />
                        )}
                        <span className="max-w-[16rem] truncate">
                          {related.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </PropertyRow>
              )}

              {!isDraft && (
                <PropertyRow
                  icon={<CalendarIcon className="size-3" />}
                  label="updated"
                >
                  <span className="text-muted-foreground">
                    {formatDateTime(note.updatedAt)}
                  </span>
                </PropertyRow>
              )}

              <PropertyRow
                icon={<FileText className="size-3" />}
                label="status"
              >
                <Select
                  value={note.status}
                  onValueChange={(value) =>
                    void onPatch({ status: value as INote["status"] })
                  }
                >
                  <SelectTrigger className="h-6 w-32 border-none bg-transparent px-1 text-xs shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">open</SelectItem>
                    <SelectItem value="archived">archived</SelectItem>
                  </SelectContent>
                </Select>
              </PropertyRow>

              {noteGroups.length > 0 && (
                <PropertyRow
                  icon={<FileText className="size-3" />}
                  label="summary"
                >
                  <div className="flex flex-wrap gap-1">
                    {noteGroups.map((group) => (
                      <Badge
                        key={group._id}
                        variant="secondary"
                        className="h-4 px-1.5 text-[10px]"
                        title={pathLabelById.get(group._id) ?? group.name}
                      >
                        {pathLabelById.get(group._id) ?? group.name}
                      </Badge>
                    ))}
                  </div>
                </PropertyRow>
              )}
            </div>
          </div>

          <div className="mt-8 flex min-h-[60vh] flex-col">
            <NoteEditor
              note={note}
              API={isDraft ? null : api}
              onUpdated={onUpdated}
              onContentChange={(next) => {
                if (isDraft) {
                  void onPatch({ content: next });
                }
              }}
              onSaveContent={isDraft ? onSaveDraft : undefined}
              saveLabel={isDraft ? "Create note" : "Save"}
              saveDisabled={
                isDraft ? savingDraft || title.trim().length === 0 : undefined
              }
              disableAiEnhance={isDraft}
              onCategorize={isDraft ? undefined : onCategorize}
              startInEditMode={isDraft}
              autoFocusEditor={isDraft}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-3 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="font-mono text-[11px]">{label}</span>
      </div>
      <div className="min-w-0 text-xs">{children}</div>
    </div>
  );
}

function ClassProperty({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Input
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          (event.target as HTMLInputElement).blur();
        }
      }}
      placeholder="video, article, paper…"
      className="h-6 border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
    />
  );
}

function DateProperty({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (next: Date | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <CalendarIcon className="size-3" />
            {date ? formatDate(date) : "Empty"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(nextDate) => {
              onChange(nextDate ?? null);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {date && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Clear date"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
