"use client";

import type { INote, INoteEdge, INoteGroup } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Properties, Property } from "@repo/ui/properties";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { FilterTabs, RowActions, ToolbarSpacer } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  Calendar as CalendarIcon,
  Download,
  ExternalLink,
  FileText,
  FolderTree,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Network,
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
import {
  formatDate,
  formatDateTime,
  relativeDate,
  safeHostname,
} from "./format";
import { buildPathLabelMap } from "./group-tree";
import { GroupTreeCombobox } from "./group-tree-combobox";
import { TagAutocomplete } from "./tag-autocomplete";

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
  const { platform } = useAdmin();

  const [title, setTitle] = useState(note.title);
  const [initialTitle, setInitialTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || "");
  const [initialContent, setInitialContent] = useState(note.content || "");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [savingContent, setSavingContent] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
    if (!trimmed) {
      setTitle(initialTitle);
      return;
    }
    if (trimmed === initialTitle) return;
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
  const source = note.url ? note.siteName || safeHostname(note.url) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft />
        </Button>
        <NoteGlyph note={note} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {noteGroups.length > 0
            ? (pathLabelById.get(noteGroups[0]._id) ?? noteGroups[0].name)
            : (source ?? "Notes")}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {relativeDate(note.updatedAt)}
        </span>
        <RowActions label="Note actions">
          {note.url && (
            <DropdownMenuItem
              onSelect={() => void platform.openExternal(note.url ?? "")}
            >
              <ExternalLink />
              Open source
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={contentDirty}
            onSelect={() => void downloadMarkdown()}
          >
            <Download />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void onPatch({
                status: note.status === "archived" ? "open" : "archived",
              })
            }
          >
            <Archive />
            {note.status === "archived" ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </RowActions>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pt-8 pb-16 sm:px-10">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Title"
            placeholder="Untitled"
            className="w-full bg-transparent text-2xl font-semibold leading-tight tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/50 sm:text-3xl"
          />

          <Properties>
            <Property icon={<FolderTree />} label="Groups">
              <ChipList>
                {noteGroups.map((group) => (
                  <Badge
                    key={group._id}
                    variant="secondary"
                    className="max-w-64"
                    title={pathLabelById.get(group._id) ?? group.name}
                  >
                    <span className="truncate">
                      {pathLabelById.get(group._id) ?? group.name}
                    </span>
                  </Badge>
                ))}
                <GroupTreeCombobox
                  groups={groups}
                  value={note.groupIds ?? []}
                  onChange={(next) => void onPatch({ groupIds: next })}
                  placeholder="Add"
                  searchPlaceholder="Search groups..."
                  emptyMessage="No groups"
                />
              </ChipList>
            </Property>

            <Property icon={<TagIcon />} label="Tags">
              <ChipList>
                {(note.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
                <TagAutocomplete
                  value={note.tags ?? []}
                  suggestions={suggestions}
                  placeholder="Add"
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
              </ChipList>
            </Property>

            {note.url && (
              <Property icon={<LinkIcon />} label="URL">
                <ExternalValue
                  href={note.url}
                  onOpen={() => void platform.openExternal(note.url ?? "")}
                />
              </Property>
            )}

            <Property icon={<Shapes />} label="Class">
              <ClassProperty
                value={note.class || ""}
                onCommit={(next) => void onPatch({ class: next })}
              />
            </Property>

            <Property icon={<FileText />} label="Status">
              <Select
                value={note.status}
                onValueChange={(value) =>
                  void onPatch({ status: value as INote["status"] })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 w-28 border-none px-1.5 text-xs shadow-none"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </Property>

            <Property icon={<CalendarIcon />} label="Published">
              <DateProperty
                value={note.publishedDate}
                onChange={(next) =>
                  void onPatch({
                    publishedDate: next ? next.toISOString() : null,
                  })
                }
              />
            </Property>

            {note.image && (
              <Property icon={<ImageIcon />} label="Image">
                <ExternalValue
                  href={note.image}
                  onOpen={() => void platform.openExternal(note.image ?? "")}
                />
              </Property>
            )}

            {relatedNotes.length > 0 && (
              <Property icon={<Network />} label="Related">
                <ChipList>
                  {relatedNotes.map((related) => (
                    <button
                      key={related._id}
                      type="button"
                      onClick={() => onSelectNote(related)}
                      className="inline-flex h-6 max-w-64 items-center gap-1 rounded-md bg-surface px-1.5 text-xs text-accent-strong transition-colors hover:bg-muted"
                    >
                      <NoteGlyph note={related} small />
                      <span className="truncate">{related.title}</span>
                    </button>
                  ))}
                </ChipList>
              </Property>
            )}

            <Property icon={<CalendarClock />} label="Created">
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatDate(note.createdAt)}
                <span className="mx-1.5">·</span>
                updated {formatDateTime(note.updatedAt)}
              </span>
            </Property>
          </Properties>

          <div className="flex flex-col">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-background py-1.5">
              <FilterTabs
                value={mode}
                onChange={setMode}
                options={[
                  { value: "preview", label: "Preview" },
                  { value: "edit", label: "Edit" },
                ]}
              />
              <ToolbarSpacer />
              <Button
                variant="ghost"
                size="sm"
                disabled={!contentDirty || savingContent}
                onClick={() => setContent(initialContent)}
              >
                <Undo2 />
                Discard
              </Button>
              <Button
                size="sm"
                disabled={!contentDirty || savingContent}
                onClick={() => void saveContent()}
              >
                {savingContent ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Save />
                )}
                Save
              </Button>
            </div>

            {mode === "edit" ? (
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "s" &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    void saveContent();
                  }
                }}
                aria-label="Content"
                placeholder="Markdown"
                className="field-sizing-content min-h-[55vh] w-full resize-none bg-transparent pt-3 font-mono text-sm text-accent-strong outline-none placeholder:text-muted-foreground/50"
              />
            ) : (
              <div className="min-h-[55vh] py-4">
                {content.trim() ? (
                  <MarkdownRenderer content={content} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setMode("edit")}
                    className="text-sm text-muted-foreground hover:text-accent-strong"
                  >
                    Empty
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete note?"
        description={note.title || "Untitled"}
        actionLabel="Delete"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}

function ChipList({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 py-1">
      {children}
    </div>
  );
}

function NoteGlyph({ note, small = false }: { note: INote; small?: boolean }) {
  const className = small ? "size-3 rounded-sm" : "size-4 shrink-0 rounded-sm";
  if (note.favicon) {
    return (
      <img src={note.favicon} alt="" className={className} loading="lazy" />
    );
  }
  return (
    <FileText
      className={cn(
        small ? "size-3" : "size-4 shrink-0",
        "text-muted-foreground",
      )}
    />
  );
}

function ExternalValue({ href, onOpen }: { href: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-full items-center gap-1 text-left text-xs text-accent-strong underline-offset-2 hover:underline"
    >
      <span className="truncate">{href}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </button>
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
    <input
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() => {
        if (local.trim() !== value) onCommit(local.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      aria-label="Class"
      placeholder="Empty"
      className="h-6 w-full rounded-md bg-transparent px-1.5 text-xs text-accent-strong outline-none transition-colors placeholder:text-muted-foreground hover:bg-surface focus:bg-surface"
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
              "inline-flex h-6 items-center rounded-md px-1.5 text-xs tabular-nums transition-colors hover:bg-surface",
              date ? "text-accent-strong" : "text-muted-foreground",
            )}
          >
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
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange(null)}
          aria-label="Clear date"
          className="text-muted-foreground"
        >
          <X />
        </Button>
      )}
    </div>
  );
}
