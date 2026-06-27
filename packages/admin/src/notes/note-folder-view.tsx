"use client";

import type { INote, INoteGroup } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { ScrollArea } from "@repo/ui/scroll-area";
import { cn } from "@repo/ui/utils";
import {
  ChevronRight,
  CornerLeftUp,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Home,
  MoreHorizontal,
  Settings2,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { buildDescendantIdMap } from "./group-tree";

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface NoteFolderViewProps {
  notes: INote[];
  groups: INoteGroup[];
  currentId: string | null;
  onCurrentIdChange: (id: string | null) => void;
  onSelect: (note: INote) => void;
  onSelectGroup: (group: INoteGroup) => void;
  onCreateNoteHere: (groupId: string | null) => void;
  onCreateFolderHere: (parentId: string | null) => void;
  onDeleteNote: (note: INote) => void;
  onDeleteGroup: (group: INoteGroup) => void;
}

export function NoteFolderView({
  notes,
  groups,
  currentId,
  onCurrentIdChange,
  onSelect,
  onSelectGroup,
  onCreateNoteHere,
  onCreateFolderHere,
  onDeleteNote,
  onDeleteGroup,
}: NoteFolderViewProps) {
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group._id, group])),
    [groups],
  );
  const descendantIdsByGroup = useMemo(
    () => buildDescendantIdMap(groups),
    [groups],
  );

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
  }, [descendantIdsByGroup, groups, notes]);

  const folderNotes = useMemo(() => {
    if (activeId === null) {
      return notes.filter((note) => (note.groupIds ?? []).length === 0);
    }

    return notes.filter((note) => (note.groupIds ?? []).includes(activeId));
  }, [activeId, notes]);

  const isEmpty = childFolders.length === 0 && folderNotes.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 text-xs sm:px-3">
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
            "inline-flex h-7 shrink-0 items-center gap-1 rounded px-1.5 hover:bg-muted",
            activeId === null
              ? "font-medium text-foreground"
              : "text-muted-foreground",
          )}
        >
          <Home className="size-3.5" />
          Notes
        </button>
        {breadcrumb.map((group, index) => (
          <span key={group._id} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="size-3 text-muted-foreground" />
            <button
              type="button"
              onClick={() => onCurrentIdChange(group._id)}
              className={cn(
                "max-w-40 truncate rounded px-1.5 py-1 hover:bg-muted",
                index === breadcrumb.length - 1
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {group.name}
            </button>
          </span>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {current && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onSelectGroup(current)}
              title="Folder details"
            >
              <Settings2 />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onCreateFolderHere(activeId)}
            title="New folder here"
          >
            <FolderPlus />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onCreateNoteHere(activeId)}
            title="New note here"
          >
            <FilePlus2 />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {isEmpty ? (
          <div className="flex h-48 items-center justify-center px-6 text-center text-xs text-muted-foreground">
            This folder is empty.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 p-3 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] sm:p-4">
            {childFolders.map((group) => (
              <FolderTile
                key={group._id}
                group={group}
                count={folderNoteCount.get(group._id) ?? 0}
                onOpen={() => onCurrentIdChange(group._id)}
                onDetails={() => onSelectGroup(group)}
                onCreateNote={() => onCreateNoteHere(group._id)}
                onCreateFolder={() => onCreateFolderHere(group._id)}
                onDelete={() => onDeleteGroup(group)}
              />
            ))}
            {folderNotes.map((note) => (
              <NoteTile
                key={note._id}
                note={note}
                onOpen={() => onSelect(note)}
                onDelete={() => onDeleteNote(note)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function FolderTile({
  group,
  count,
  onOpen,
  onDetails,
  onCreateNote,
  onCreateFolder,
  onDelete,
}: {
  group: INoteGroup;
  count: number;
  onOpen: () => void;
  onDetails: () => void;
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative min-h-[8.5rem] rounded-md border border-transparent transition-colors hover:border-border hover:bg-muted/50">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[8.5rem] w-full flex-col items-center justify-center gap-2 px-3 py-4 text-center"
        title={group.name}
      >
        <Folder
          className="size-9"
          style={{ color: group.color ?? undefined }}
          fill={group.color ?? "currentColor"}
          fillOpacity={0.15}
        />
        <span className="line-clamp-2 w-full break-words text-xs font-medium leading-tight">
          {group.name}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {count} {count === 1 ? "note" : "notes"}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1 bg-background/80"
            title="Folder actions"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onOpen}>
            <FolderOpen className="size-3.5" />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCreateNote}>
            <FilePlus2 className="size-3.5" />
            New note here
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCreateFolder}>
            <FolderPlus className="size-3.5" />
            New subfolder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDetails}>
            <Settings2 className="size-3.5" />
            Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NoteTile({
  note,
  onOpen,
  onDelete,
}: {
  note: INote;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative min-h-[8.5rem] rounded-md border border-transparent transition-colors hover:border-border hover:bg-muted/50">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[8.5rem] w-full flex-col items-center justify-center gap-2 px-3 py-4 text-center"
        title={note.title}
      >
        <span className="flex size-9 items-center justify-center">
          {note.favicon ? (
            <img
              src={note.favicon}
              alt=""
              className="size-6 rounded-sm"
              loading="lazy"
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
        <span className="line-clamp-2 w-full break-words text-xs font-medium leading-tight">
          {note.title}
        </span>
        <span className="w-full truncate text-[10px] text-muted-foreground">
          {note.url ? safeHostname(note.url) : "note"}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1 bg-background/80"
            title="Note actions"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onOpen}>
            <FileText className="size-3.5" />
            Open
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
