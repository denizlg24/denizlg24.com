"use client";

import { CalendarDays, MapPin, UserRound } from "lucide-react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BirthdayParts, IPerson, IPersonGroup } from "@/lib/data-types";

function formatBirthday(birthday?: BirthdayParts | null) {
  if (!birthday) return "No birthday";
  const date = new Date(2000, birthday.month - 1, birthday.day);
  const label = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return birthday.year ? `${label}, ${birthday.year}` : label;
}

interface Props {
  people: IPerson[];
  groups: IPersonGroup[];
  onSelect: (person: IPerson) => void;
  onSelectGroup: (group: IPersonGroup) => void;
}

export function PersonList({ people, groups, onSelect, onSelectGroup }: Props) {
  const groupMap = new Map(groups.map((group) => [group._id, group]));

  if (people.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No people match the current filters.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="min-w-165">
        <div className="grid grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] gap-3 border-b px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span />
          <span>Name</span>
          <span>Birthday</span>
          <span>Place met</span>
          <span>Groups</span>
        </div>

        <div className="divide-y">
          {people.map((person) => {
            const personGroups = person.groupIds
              .map((groupId) => groupMap.get(groupId))
              .filter((group): group is IPersonGroup => Boolean(group));

            return (
              <button
                type="button"
                key={person._id}
                onClick={() => onSelect(person)}
                className="grid w-full grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] gap-3 px-4 py-3 text-left hover:bg-muted/40"
              >
                <div className="pt-0.5">
                  {person.photos[0] ? (
                    <Image
                      src={person.photos[0]}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6 rounded-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserRound className="size-3.5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {person.name}
                  </div>
                  <div className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">
                    {person.notes || "No notes"}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {formatBirthday(person.birthday)}
                </div>
                <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {person.placeMet || "Unknown"}
                  </span>
                </div>
                <div className="flex flex-wrap content-start gap-1">
                  {personGroups.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">
                      None
                    </span>
                  ) : (
                    personGroups.map((group) => (
                      <button
                        type="button"
                        key={group._id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectGroup(group);
                        }}
                      >
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px] hover:bg-accent"
                        >
                          {group.name}
                        </Badge>
                      </button>
                    ))
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
