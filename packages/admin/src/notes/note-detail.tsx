"use client";

import type { INote, INoteEdge, INoteGroup } from "@repo/schemas";
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
} from "@repo/ui/alert-dialog";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import { Input } from "@repo/ui/input";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Download,
  ExternalLink,
  FileText,
  FolderTree,
  Globe,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Save,
  Shapes,
  Tag as TagIcon,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { buildPathLabelMap } from "./group-tree";
import { GroupTreeCombobox } from "./group-tree-combobox";
import { TagAutocomplete } from "./tag-autocomplete";

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

function safeFilename(raw: string) {
  const withoutReserved = raw.trim().replace(/[<>:"/\\|?*]/g, "-");
  const withoutControl = [...withoutReserved]
    .map((char) => (char.charCodeAt(0) < 32 ? "-" : char))
    .join("");
  const cleaned = withoutControl.replace(/\s+/g, " ").slice(0, 96);
  return cleaned || "note";
}

interface NoteDetailProps {
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
}: NoteDetailProps) {
  const { platform, slots } = useAdmin();

  const [title, setTitle] = useState(note.title);
  const [initialTitle, setInitialTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || "");
  const [initialContent, setInitialContent] = useState(note.content || "");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [savingContent, setSavingContent] = useState(false);

  useEffect(() => {
    setTitle(note.title);
    setInitialTitle(note.title);
  }, [note.title]);

  useEffect(() => {
    setContent(note.content || "");
    setInitialContent(note.content || "");
    setMode("preview");
  }, [note._id, note.content]);

  const saveTitle = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === initialTitle) return;
    const updated = await onPatch({ title: trimmed });
    if (updated) {
      setInitialTitle(updated.title);
      setTitle(updated.title);
    }
  }, [initialTitle, onPatch, title]);

  const saveContent = useCallback(async () => {
    if (content === initialContent) return;

    try {
      setSavingContent(true);
      const updated = await onPatch({ content });
      if (updated) {
        setInitialContent(updated.content || "");
        setContent(updated.content || "");
        onUpdated(updated);
        setMode("preview");
      }
    } finally {
      setSavingContent(false);
    }
  }, [content, initialContent, onPatch, onUpdated]);

  const downloadMarkdown = useCallback(async () => {
    try {
      await platform.downloadFile(
        `${safeFilename(note.title)}.md`,
        content,
        "text/markdown",
      );
    } catch {
      toast.error("Failed to download note");
    }
  }, [content, note.title, platform]);

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
  const contentDirty = content !== initialContent;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:flex-nowrap sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {slots?.sidebarTrigger}
          <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back">
            <ArrowLeft className="size-4" />
          </Button>
          {note.favicon ? (
            <img
              src={note.favicon}
              alt=""
              className="size-4 shrink-0 rounded-sm"
              loading="lazy"
            />
          ) : (
            <FileText className="size-4 shrink-0" />
          )}
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {note.url
              ? note.siteName || safeHostname(note.url)
              : note.title || "Untitled note"}
          </span>
        </div>

        <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={downloadMarkdown}
            disabled={contentDirty}
            title={contentDirty ? "Save before downloading" : "Download"}
          >
            <Download className="size-3.5" />
            <span className="hidden sm:inline">Download</span>
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete note?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the note and its related edges.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                (event.target as HTMLInputElement).blur();
              }
            }}
            className="h-auto border-none bg-transparent px-0 py-1 text-xl font-semibold shadow-none focus-visible:ring-0 sm:text-2xl"
            placeholder="Untitled note"
          />

          <section>
            <h2 className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">
              Properties
            </h2>
            <div className="divide-y border-y text-xs">
              <PropertyRow
                icon={<CalendarIcon className="size-3" />}
                label="created_on"
              >
                <span className="text-muted-foreground">
                  {formatDate(note.createdAt)}
                </span>
              </PropertyRow>

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
                  <button
                    type="button"
                    onClick={() => void platform.openExternal(note.url ?? "")}
                    className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline"
                  >
                    <span className="truncate">{note.url}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </button>
                </PropertyRow>
              )}

              {note.image && (
                <PropertyRow
                  icon={<ImageIcon className="size-3" />}
                  label="image"
                >
                  <button
                    type="button"
                    onClick={() => void platform.openExternal(note.image ?? "")}
                    className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline"
                  >
                    <span className="truncate">{note.image}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </button>
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
                  placeholder="Add group..."
                  searchPlaceholder="Search group hierarchy..."
                  emptyMessage="No groups yet"
                />
              </PropertyRow>

              {relatedNotes.length > 0 && (
                <PropertyRow
                  icon={<LinkIcon className="size-3" />}
                  label="related"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    {relatedNotes.map((related) => (
                      <button
                        key={related._id}
                        type="button"
                        onClick={() => onSelectNote(related)}
                        className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/20 px-1.5 py-0.5 text-[10px] hover:bg-muted"
                      >
                        {related.favicon ? (
                          <img
                            src={related.favicon}
                            alt=""
                            className="size-2.5 rounded-sm"
                            loading="lazy"
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

              <PropertyRow
                icon={<CalendarIcon className="size-3" />}
                label="updated"
              >
                <span className="text-muted-foreground">
                  {formatDateTime(note.updatedAt)}
                </span>
              </PropertyRow>

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
                  <SelectTrigger className="h-7 w-32 border-none bg-transparent px-1 text-xs shadow-none focus:ring-0">
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
                  icon={<FolderTree className="size-3" />}
                  label="summary"
                >
                  <div className="flex flex-wrap gap-1">
                    {noteGroups.map((group) => (
                      <Badge
                        key={group._id}
                        variant="secondary"
                        className="h-5 max-w-full px-1.5 text-[10px]"
                        title={pathLabelById.get(group._id) ?? group.name}
                      >
                        <span className="truncate">
                          {pathLabelById.get(group._id) ?? group.name}
                        </span>
                      </Badge>
                    ))}
                  </div>
                </PropertyRow>
              )}
            </div>
          </section>

          <section className="flex min-h-[55vh] flex-col">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b py-2">
              <Tabs
                value={mode}
                onValueChange={(value) => setMode(value as "preview" | "edit")}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="preview" className="h-6 text-xs">
                    <Globe className="size-3.5" />
                    Preview
                  </TabsTrigger>
                  <TabsTrigger value="edit" className="h-6 text-xs">
                    <FileText className="size-3.5" />
                    Edit
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!contentDirty || savingContent}
                  onClick={() => setContent(initialContent)}
                >
                  <Undo2 className="size-3.5" />
                  <span className="hidden sm:inline">Discard</span>
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!contentDirty || savingContent}
                  onClick={() => void saveContent()}
                >
                  {savingContent ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {mode === "edit" ? (
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="min-h-[55vh] resize-none rounded-none border-none bg-transparent font-mono text-sm shadow-none outline-none ring-0 focus-visible:ring-0"
                  placeholder="Write markdown..."
                />
              ) : (
                <div className="min-h-[55vh] overflow-y-auto py-3">
                  {content.trim() ? (
                    <MarkdownRenderer content={content} />
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      No content yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
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
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 px-2 py-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-3 sm:py-1.5">
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
      placeholder="video, article, paper..."
      className="h-7 border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
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
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
              date && "text-foreground",
            )}
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
