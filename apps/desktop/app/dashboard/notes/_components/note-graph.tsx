"use client";

import { EntityGraph } from "@/components/graph/entity-graph";
import { classColor } from "@/lib/bookmark-color";
import type { INote, INoteEdge, INoteGroup } from "@/lib/data-types";

interface Props {
  notes: INote[];
  groups: INoteGroup[];
  edges: INoteEdge[];
  onSelectNote: (note: INote) => void;
  onSelectGroup: (group: INoteGroup) => void;
}

// Module-level so their identity is stable: EntityGraph keys its node/link
// memo on these, and a fresh lambda per render replays the force layout.
const getNoteLabel = (note: INote) => note.title;
export const getNoteGroupIds = (note: INote) => note.groupIds ?? [];
const getNoteColor = (note: INote, scheme: "dark" | "light") =>
  note.class
    ? classColor(note.class, scheme)
    : classColor(note.siteName ?? note.title, scheme);

export function NoteGraph({
  notes,
  groups,
  edges,
  onSelectNote,
  onSelectGroup,
}: Props) {
  return (
    <EntityGraph
      items={notes}
      groups={groups}
      edges={edges}
      getItemLabel={getNoteLabel}
      getItemGroupIds={getNoteGroupIds}
      getItemColor={getNoteColor}
      onSelectItem={onSelectNote}
      onSelectGroup={onSelectGroup}
    />
  );
}
