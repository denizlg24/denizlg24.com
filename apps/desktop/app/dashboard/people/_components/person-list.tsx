"use client";

import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { UsersRound } from "lucide-react";
import { useMemo } from "react";
import type { BirthdayParts, IPerson, IPersonGroup } from "@/lib/data-types";
import { PersonAvatar } from "./person-avatar";

export function formatBirthdayShort(birthday?: BirthdayParts | null) {
  if (!birthday) return null;
  return new Date(2000, birthday.month - 1, birthday.day).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" },
  );
}

interface Props {
  people: IPerson[];
  groups: IPersonGroup[];
  relationCounts: Map<string, number>;
  selectedId: string | null;
  onSelect: (person: IPerson) => void;
}

export function PersonList({
  people,
  groups,
  relationCounts,
  selectedId,
  onSelect,
}: Props) {
  const groupNames = useMemo(
    () => new Map(groups.map((group) => [group._id, group.name])),
    [groups],
  );

  if (people.length === 0) {
    return <EmptyState compact icon={<UsersRound />} label="No people" />;
  }

  return (
    <List>
      {people.map((person) => {
        const names = person.groupIds
          .map((groupId) => groupNames.get(groupId))
          .filter((name): name is string => Boolean(name));
        const relations = relationCounts.get(person._id) ?? 0;
        const description = [
          names.join(", "),
          person.placeMet,
          relations > 0
            ? `${relations} relation${relations === 1 ? "" : "s"}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <ListRow
            key={person._id}
            selected={person._id === selectedId}
            onClick={() => onSelect(person)}
            leading={
              <PersonAvatar
                size="xs"
                photo={person.photos[0]}
                name={person.name}
              />
            }
            title={person.name}
            description={description || undefined}
            meta={formatBirthdayShort(person.birthday)}
          />
        );
      })}
    </List>
  );
}
