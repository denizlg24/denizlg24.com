"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Properties, Property } from "@repo/ui/properties";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { RowActions } from "@repo/ui/toolbar";
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  Calendar as CalendarIcon,
  ExternalLink,
  FileText,
  FolderTree,
  Image as ImageIcon,
  Link as LinkIcon,
  Mic,
  Network,
  Plus,
  Shapes,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TagAutocomplete } from "@/app/dashboard/notes/_components/tag-autocomplete";
import { VoiceNoteAttachments } from "@/components/voice-notes/voice-note-attachments";
import type { denizApi } from "@/lib/api-wrapper";
import type { INote, INoteEdge, INoteGroup } from "@/lib/data-types";
import { buildPathLabelMap } from "@/lib/note-group-tree";
import { GroupTreeCombobox } from "./group-tree-combobox";
import { NoteEditor } from "./note-editor";
import {
  formatDate,
  formatDateTime,
  relativeDate,
  safeHostname,
} from "./note-format";

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
  onAddEdge?: (from: string, to: string) => Promise<void>;
  onRemoveEdge?: (edgeId: string) => Promise<void>;
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
  onAddEdge,
  onRemoveEdge,
  api,
  mode = "existing",
  onSaveDraft,
  savingDraft = false,
  onCategorize,
}: Props) {
  const isDraft = mode === "draft";
  const [title, setTitle] = useState(note.title);
  const [initialTitle, setInitialTitle] = useState(note.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(note.title);
    setInitialTitle(note.title);
  }, [note.title]);

  useEffect(
    () => () => {
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    },
    [],
  );

  const saveTitle = useCallback(
    async (nextTitle: string) => {
      if (isDraft) return;
      if (titleSaveTimer.current) {
        clearTimeout(titleSaveTimer.current);
        titleSaveTimer.current = null;
      }
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
    const edgeIdByNote = new Map<string, string>();
    for (const edge of edges) {
      if (edge.from === note._id) edgeIdByNote.set(edge.to, edge._id);
      else if (edge.to === note._id) edgeIdByNote.set(edge.from, edge._id);
    }
    return allNotes.flatMap((candidate) => {
      const edgeId = edgeIdByNote.get(candidate._id);
      return edgeId ? [{ note: candidate, edgeId }] : [];
    });
  }, [allNotes, edges, note._id]);

  const relatableNotes = useMemo(() => {
    const relatedIds = new Set(relatedNotes.map((entry) => entry.note._id));
    return allNotes.filter(
      (candidate) =>
        candidate._id !== note._id && !relatedIds.has(candidate._id),
    );
  }, [allNotes, note._id, relatedNotes]);

  const pathLabelById = useMemo(() => buildPathLabelMap(groups), [groups]);
  const noteGroups = useMemo(
    () =>
      (note.groupIds ?? [])
        .map((groupId) => groups.find((group) => group._id === groupId))
        .filter((group): group is INoteGroup => Boolean(group)),
    [groups, note.groupIds],
  );

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
        {!isDraft && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {relativeDate(note.updatedAt)}
          </span>
        )}
        {!isDraft && (
          <RowActions label="Note actions">
            {note.url && (
              <DropdownMenuItem asChild>
                <a href={note.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Open source
                </a>
              </DropdownMenuItem>
            )}
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
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pt-8 pb-16 sm:px-10">
          <input
            // biome-ignore lint/a11y/noAutofocus: a new note starts at its title
            autoFocus={isDraft}
            value={title}
            onChange={(event) => scheduleTitleSave(event.target.value)}
            onBlur={() => void saveTitle(title)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Title"
            placeholder="Untitled"
            className="w-full bg-transparent text-3xl font-semibold leading-tight tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/50"
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
                  searchPlaceholder="Search groups…"
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
                <ExternalValue href={note.url} />
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
                <ExternalValue href={note.image} />
              </Property>
            )}

            {!isDraft && (
              <Property icon={<Network />} label="Related">
                <ChipList>
                  {relatedNotes.map(({ note: related, edgeId }) => (
                    <span
                      key={related._id}
                      className="inline-flex h-6 max-w-64 items-center gap-1 rounded-md bg-surface pr-1 pl-1.5 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectNote(related)}
                        className="inline-flex min-w-0 items-center gap-1 hover:underline"
                      >
                        <NoteGlyph note={related} small />
                        <span className="truncate">{related.title}</span>
                      </button>
                      {onRemoveEdge && (
                        <button
                          type="button"
                          onClick={() => void onRemoveEdge(edgeId)}
                          className="rounded p-0.5 text-muted-foreground hover:text-accent-strong"
                          aria-label={`Unlink ${related.title}`}
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {onAddEdge && (
                    <RelatedNotePicker
                      notes={relatableNotes}
                      onSelect={(toNoteId) =>
                        void onAddEdge(note._id, toNoteId)
                      }
                    />
                  )}
                  {relatedNotes.length === 0 && !onAddEdge && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </ChipList>
              </Property>
            )}

            {!isDraft && api && (
              <Property icon={<Mic />} label="Voice">
                <VoiceNoteAttachments api={api} note={note} onPatch={onPatch} />
              </Property>
            )}

            {!isDraft && (
              <Property icon={<CalendarClock />} label="Created">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatDate(note.createdAt)}
                  <span className="mx-1.5">·</span>
                  updated {formatDateTime(note.updatedAt)}
                </span>
              </Property>
            )}
          </Properties>

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
            saveLabel={isDraft ? "Create" : "Save"}
            saveDisabled={
              isDraft ? savingDraft || title.trim().length === 0 : undefined
            }
            disableAiEnhance={isDraft}
            onCategorize={isDraft ? undefined : onCategorize}
            startInEditMode={isDraft}
            autoFocusEditor={false}
          />
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
  const size = small ? 12 : 16;
  if (note.favicon) {
    return (
      <Image
        src={note.favicon}
        alt=""
        width={size}
        height={size}
        className={small ? "size-3 rounded-sm" : "size-4 shrink-0 rounded-sm"}
        unoptimized
      />
    );
  }
  return (
    <FileText
      className={
        small
          ? "size-3 text-muted-foreground"
          : "size-4 shrink-0 text-muted-foreground"
      }
    />
  );
}

function ExternalValue({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 text-xs text-accent-strong underline-offset-2 hover:underline"
    >
      <span className="truncate">{href}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </a>
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
            className={`inline-flex h-6 items-center rounded-md px-1.5 text-xs tabular-nums transition-colors hover:bg-surface ${
              date ? "text-accent-strong" : "text-muted-foreground"
            }`}
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

function RelatedNotePicker({
  notes,
  onSelect,
}: {
  notes: INote[];
  onSelect: (noteId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (notes.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface hover:text-accent-strong"
        >
          <Plus className="size-3" />
          Link
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        align="start"
        sideOffset={6}
      >
        <Command>
          <CommandInput placeholder="Find note…" />
          <CommandList>
            <CommandEmpty>
              <span className="text-xs text-muted-foreground">No notes</span>
            </CommandEmpty>
            <CommandGroup>
              {notes.map((candidate) => (
                <CommandItem
                  key={candidate._id}
                  value={`${candidate.title} ${candidate._id}`}
                  onSelect={() => {
                    onSelect(candidate._id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <NoteGlyph note={candidate} small />
                  <span className="truncate">{candidate.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
