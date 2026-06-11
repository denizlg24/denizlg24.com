"use client";

import { EntityGraph } from "@/components/graph/entity-graph";
import { classColor } from "@/lib/bookmark-color";
import type { IPerson, IPersonEdge, IPersonGroup } from "@/lib/data-types";

interface Props {
  people: IPerson[];
  groups: IPersonGroup[];
  edges: IPersonEdge[];
  onSelectPerson: (person: IPerson) => void;
  onSelectGroup: (group: IPersonGroup) => void;
}

export function PersonGraph({
  people,
  groups,
  edges,
  onSelectPerson,
  onSelectGroup,
}: Props) {
  return (
    <EntityGraph
      items={people}
      groups={groups}
      edges={edges}
      getItemLabel={(person) => person.name}
      getItemGroupIds={(person) => person.groupIds}
      getItemColor={(person, scheme) =>
        classColor(person.placeMet ?? person.name, scheme)
      }
      onSelectItem={onSelectPerson}
      onSelectGroup={onSelectGroup}
    />
  );
}
