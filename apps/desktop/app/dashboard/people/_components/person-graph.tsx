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

// Module-level so their identity is stable: EntityGraph keys its node/link
// memo on these, and a fresh lambda per render replays the force layout.
const getPersonLabel = (person: IPerson) => person.name;
export const getPersonGroupIds = (person: IPerson) => person.groupIds;
const getPersonColor = (person: IPerson, scheme: "dark" | "light") =>
  classColor(person.placeMet ?? person.name, scheme);
const getPersonImage = (person: IPerson) => person.photos[0];

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
      getItemLabel={getPersonLabel}
      getItemGroupIds={getPersonGroupIds}
      getItemColor={getPersonColor}
      getItemImage={getPersonImage}
      onSelectItem={onSelectPerson}
      onSelectGroup={onSelectGroup}
    />
  );
}
