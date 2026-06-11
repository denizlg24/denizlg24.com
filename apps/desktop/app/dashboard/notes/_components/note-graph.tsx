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
      getItemLabel={(note) => note.title}
      getItemGroupIds={(note) => note.groupIds ?? []}
      getItemColor={(note, scheme) =>
        note.class
          ? classColor(note.class, scheme)
          : classColor(note.siteName ?? note.title, scheme)
      }
      onSelectItem={onSelectNote}
      onSelectGroup={onSelectGroup}
    />
  );
}
