"use client";

import { Button } from "@repo/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@repo/ui/context-menu";
import { ScrollArea } from "@repo/ui/scroll-area";
import {
  BrainCircuit,
  ChevronRight,
  CornerLeftUp,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  House,
  Settings2,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import type { INote, INoteGroup } from "@/lib/data-types";
import { buildDescendantIdMap } from "@/lib/note-group-tree";
import { cn } from "@/lib/utils";

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface Props {
  notes: INote[];
  groups: INoteGroup[];
  currentId: string | null;
  onCurrentIdChange: (id: string | null) => void;
  onSelect: (note: INote) => void;
  onSelectGroup: (group: INoteGroup) => void;
  onCreateNoteHere: (groupId: string | null) => void;
  onCreateFolderHere: (parentId: string | null) => void;
  onCategorizeNote: (note: INote) => void;
  onDeleteNote: (note: INote) => void;
  onDeleteGroup: (group: INoteGroup) => void;
}

type ContextTarget =
  | { kind: "note"; note: INote }
  | { kind: "group"; group: INoteGroup }
  | { kind: "background" };

export function NoteFolderView({
  notes,
  groups,
  currentId,
  onCurrentIdChange,
  onSelect,
  onSelectGroup,
  onCreateNoteHere,
  onCreateFolderHere,
  onCategorizeNote,
  onDeleteNote,
  onDeleteGroup,
}: Props) {
  const [target, setTarget] = useState<ContextTarget>({ kind: "background" });

  const groupById = useMemo(
    () => new Map(groups.map((group) => [group._id, group])),
    [groups],
  );
  const noteById = useMemo(
    () => new Map(notes.map((note) => [note._id, note])),
    [notes],
  );
  const descendantIdsByGroup = useMemo(
    () => buildDescendantIdMap(groups),
    [groups],
  );

  // Fall back to root if the open folder was deleted or reparented away.
  const current = currentId ? (groupById.get(currentId) ?? null) : null;
  const activeId = current ? current._id : null;

  const breadcrumb = useMemo(() => {
    const trail: INoteGroup[] = [];
    let cursor: string | null | undefined = activeId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const group = groupById.get(cursor);
      if (!group) break;
      trail.unshift(group);
      cursor = group.parentId ?? null;
    }
    return trail;
  }, [activeId, groupById]);

  const childFolders = useMemo(
    () =>
      groups
        .filter((group) => (group.parentId ?? null) === activeId)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [groups, activeId],
  );

  const folderNoteCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups) {
      const scope = descendantIdsByGroup.get(group._id) ?? new Set([group._id]);
      counts.set(
        group._id,
        notes.filter((note) =>
          (note.groupIds ?? []).some((groupId) => scope.has(groupId)),
        ).length,
      );
    }
    return counts;
  }, [groups, notes, descendantIdsByGroup]);

  const folderNotes = useMemo(() => {
    if (activeId === null) {
      return notes.filter((note) => (note.groupIds ?? []).length === 0);
    }
    return notes.filter((note) => (note.groupIds ?? []).includes(activeId));
  }, [notes, activeId]);

  const isEmpty = childFolders.length === 0 && folderNotes.length === 0;

  // Single context menu for the whole grid: resolve the right-clicked tile from
  // data attributes so we avoid nesting Radix ContextMenu roots (which would
  // double-open).
  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-folder-id], [data-note-id]",
    );
    const folderId = el?.dataset.folderId;
    const noteId = el?.dataset.noteId;

    if (folderId) {
      const group = groupById.get(folderId);
      setTarget(group ? { kind: "group", group } : { kind: "background" });
    } else if (noteId) {
      const note = noteById.get(noteId);
      setTarget(note ? { kind: "note", note } : { kind: "background" });
    } else {
      setTarget({ kind: "background" });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3 text-xs">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={activeId === null}
          onClick={() => onCurrentIdChange(current?.parentId ?? null)}
          title="Up one level"
        >
          <CornerLeftUp />
        </Button>
        <button
          type="button"
          onClick={() => onCurrentIdChange(null)}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted",
            activeId === null
              ? "font-medium text-foreground"
              : "text-muted-foreground",
          )}
        >
          <House className="size-3.5" />
          Notes
        </button>
        {breadcrumb.map((group, index) => (
          <span key={group._id} className="flex items-center gap-1">
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            <button
              type="button"
              onClick={() => onCurrentIdChange(group._id)}
              className={cn(
                "max-w-40 truncate rounded px-1.5 py-0.5 hover:bg-muted",
                index === breadcrumb.length - 1
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {group.name}
            </button>
          </span>
        ))}
        {current && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            onClick={() => onSelectGroup(current)}
            title="Folder details"
          >
            <Settings2 />
          </Button>
        )}
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ScrollArea
            className="min-h-0 flex-1"
            onContextMenu={handleContextMenu}
          >
            {isEmpty ? (
              <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                This folder is empty.
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 p-4">
                {childFolders.map((group) => (
                  <FolderTile
                    key={group._id}
                    group={group}
                    count={folderNoteCount.get(group._id) ?? 0}
                    onOpen={() => onCurrentIdChange(group._id)}
                    onDetails={() => onSelectGroup(group)}
                  />
                ))}
                {folderNotes.map((note) => (
                  <NoteTile
                    key={note._id}
                    note={note}
                    onOpen={() => onSelect(note)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {target.kind === "note" && (
            <>
              <ContextMenuItem onSelect={() => onSelect(target.note)}>
                <SquareArrowOutUpRight className="size-3.5" />
                Open
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onCategorizeNote(target.note)}>
                <BrainCircuit className="size-3.5" />
                Categorize
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onDeleteNote(target.note)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </ContextMenuItem>
            </>
          )}

          {target.kind === "group" && (
            <>
              <ContextMenuItem
                onSelect={() => onCurrentIdChange(target.group._id)}
              >
                <FolderOpen className="size-3.5" />
                Open
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => onCreateNoteHere(target.group._id)}
              >
                <FilePlus2 className="size-3.5" />
                New note here
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => onCreateFolderHere(target.group._id)}
              >
                <FolderPlus className="size-3.5" />
                New subfolder
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onSelectGroup(target.group)}>
                <Settings2 className="size-3.5" />
                Details
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onDeleteGroup(target.group)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </ContextMenuItem>
            </>
          )}

          {target.kind === "background" && (
            <>
              <ContextMenuItem onSelect={() => onCreateNoteHere(activeId)}>
                <FilePlus2 className="size-3.5" />
                New note here
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onCreateFolderHere(activeId)}>
                <FolderPlus className="size-3.5" />
                New folder here
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function FolderTile({
  group,
  count,
  onOpen,
  onDetails,
}: {
  group: INoteGroup;
  count: number;
  onOpen: () => void;
  onDetails: () => void;
}) {
  return (
    <div className="group relative" data-folder-id={group._id}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-center gap-2 rounded-lg border border-transparent px-3 py-4 text-center transition-colors hover:border-border hover:bg-muted/50"
        title={group.name}
      >
        <Folder
          className="size-9"
          style={{ color: group.color ?? undefined }}
          fill={group.color ?? "currentColor"}
          fillOpacity={0.15}
        />
        <span className="line-clamp-2 w-full wrap-break-word text-xs font-medium leading-tight">
          {group.name}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {count} {count === 1 ? "note" : "notes"}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 top-1 "
        onClick={onDetails}
        title="Folder details"
      >
        <Settings2 />
      </Button>
    </div>
  );
}

function NoteTile({ note, onOpen }: { note: INote; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-note-id={note._id}
      className="flex flex-col items-center gap-2 rounded-lg border border-transparent px-3 py-4 text-center transition-colors hover:border-border hover:bg-muted/50"
      title={note.title}
    >
      <span className="flex size-9 items-center justify-center">
        {note.favicon ? (
          <Image
            src={note.favicon}
            alt=""
            width={24}
            height={24}
            className="size-6 rounded-sm"
            unoptimized
          />
        ) : note.url ? (
          <Globe className="size-8 text-muted-foreground" />
        ) : (
          <FileText
            className="size-8 text-muted-foreground"
            strokeWidth={1.25}
          />
        )}
      </span>
      <span className="line-clamp-2 w-full wrap-break-word text-xs font-medium leading-tight">
        {note.title}
      </span>
      <span className="w-full truncate text-[10px] text-muted-foreground">
        {note.url ? safeHostname(note.url) : "note"}
      </span>
    </button>
  );
}
