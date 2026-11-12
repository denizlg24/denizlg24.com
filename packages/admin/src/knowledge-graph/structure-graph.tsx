"use client";

import type { INote, INoteEdge, INoteGroup } from "@repo/schemas";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@repo/ui/context-menu";
import {
  BrainCircuit,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Settings2,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EntityGraph, useEntityGraphData } from "./entity-graph";
import { classColor } from "./theme";

export interface NoteStructureGraphProps {
  notes: INote[];
  groups: INoteGroup[];
  edges: INoteEdge[];
  onSelectNote: (note: INote) => void;
  onSelectGroup: (group: INoteGroup) => void;
  onCreateNoteHere: (groupId: string | null) => void;
  onCreateFolderHere: (parentId: string | null) => void;
  onCategorizeNote?: (note: INote) => void;
  onDeleteNote: (note: INote) => void;
  onDeleteGroup: (group: INoteGroup) => void;
}

type ContextTarget =
  | { kind: "note"; note: INote }
  | { kind: "group"; group: INoteGroup }
  | { kind: "background" }
  | null;

// Module-level so their identity is stable: EntityGraph keys its node/link
// memo on these, and a fresh lambda per render replays the force layout.
const getNoteLabel = (note: INote) => note.title;
const getNoteGroupIds = (note: INote) => note.groupIds ?? [];
const getNoteColor = (note: INote, scheme: "dark" | "light") =>
  note.class
    ? classColor(note.class, scheme)
    : classColor(note.siteName ?? note.title, scheme);

export function NoteStructureGraph({
  notes,
  groups,
  edges,
  onSelectNote,
  onSelectGroup,
  onCreateNoteHere,
  onCreateFolderHere,
  onCategorizeNote,
  onDeleteNote,
  onDeleteGroup,
}: NoteStructureGraphProps) {
  const [target, setTarget] = useState<ContextTarget>(null);
  const { visibleGroups, visibleEdges } = useEntityGraphData({
    items: notes,
    groups,
    edges,
    getItemGroupIds: getNoteGroupIds,
  });
  const triggerRef = useRef<HTMLDivElement>(null);

  const openContextMenu = (nextTarget: ContextTarget, event: MouseEvent) => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    event.preventDefault();
    flushSync(() => setTarget(nextTarget));
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        buttons: 0,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        screenX: event.screenX,
        screenY: event.screenY,
        shiftKey: event.shiftKey,
      }),
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={triggerRef} className="h-full w-full">
          <EntityGraph
            items={notes}
            groups={visibleGroups}
            edges={visibleEdges}
            getItemLabel={getNoteLabel}
            getItemGroupIds={getNoteGroupIds}
            getItemColor={getNoteColor}
            onSelectItem={onSelectNote}
            onSelectGroup={onSelectGroup}
            onItemContextMenu={(note, event) =>
              openContextMenu({ kind: "note", note }, event)
            }
            onGroupContextMenu={(group, event) =>
              openContextMenu({ kind: "group", group }, event)
            }
            onBackgroundContextMenu={(event) =>
              openContextMenu({ kind: "background" }, event)
            }
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {target?.kind === "note" && (
          <>
            <ContextMenuItem onSelect={() => onSelectNote(target.note)}>
              <SquareArrowOutUpRight className="size-3.5" />
              Open
            </ContextMenuItem>
            {onCategorizeNote && (
              <ContextMenuItem onSelect={() => onCategorizeNote(target.note)}>
                <BrainCircuit className="size-3.5" />
                Categorize
              </ContextMenuItem>
            )}
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

        {target?.kind === "group" && (
          <>
            <ContextMenuItem onSelect={() => onSelectGroup(target.group)}>
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

        {(target === null || target.kind === "background") && (
          <>
            <ContextMenuItem onSelect={() => onCreateNoteHere(null)}>
              <FilePlus2 className="size-3.5" />
              New note
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onCreateFolderHere(null)}>
              <FolderPlus className="size-3.5" />
              New folder
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
