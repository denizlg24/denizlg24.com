"use client";

import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { PageBody, PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { Textarea } from "@repo/ui/textarea";
import { RowActions } from "@repo/ui/toolbar";
import { ArrowLeft, FolderTree, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GroupTreeCombobox } from "@/app/dashboard/notes/_components/group-tree-combobox";
import type { IPerson, IPersonGroup } from "@/lib/data-types";
import { buildDescendantIdMap } from "@/lib/note-group-tree";
import { PersonAvatar } from "./person-avatar";

interface Props {
  group: IPersonGroup;
  groups: IPersonGroup[];
  people: IPerson[];
  onBack?: () => void;
  onUpdate: (id: string, patch: Partial<IPersonGroup>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSelectPerson: (person: IPerson) => void;
}

export function PersonGroupDetail({
  group,
  groups,
  people,
  onBack,
  onUpdate,
  onDelete,
  onSelectPerson,
}: Props) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(group.name);
    setDescription(group.description || "");
  }, [group]);

  const descendants = useMemo(() => buildDescendantIdMap(groups), [groups]);

  const parentOptions = useMemo(() => {
    const forbidden = new Set(descendants.get(group._id) ?? [group._id]);
    forbidden.add(group._id);
    return groups.filter((candidate) => !forbidden.has(candidate._id));
  }, [descendants, group._id, groups]);

  const childGroups = useMemo(
    () => groups.filter((candidate) => candidate.parentId === group._id),
    [group._id, groups],
  );

  const members = useMemo(
    () =>
      people
        .filter((person) => person.groupIds.includes(group._id))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [group._id, people],
  );

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(group.name);
      return;
    }
    if (trimmed !== group.name) void onUpdate(group._id, { name: trimmed });
  };

  return (
    <PageBody width="narrow">
      <PageTitle
        icon={<FolderTree />}
        title={
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setName(group.name);
                event.currentTarget.blur();
              }
            }}
            aria-label="Group name"
            className="w-full bg-transparent outline-none"
          />
        }
        meta={
          <span className="tabular-nums">
            {members.length} {members.length === 1 ? "person" : "people"}
          </span>
        }
        actions={
          <>
            {onBack ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                className="md:hidden"
                onClick={onBack}
              >
                <ArrowLeft />
              </Button>
            ) : null}
            <RowActions>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </RowActions>
          </>
        }
      />

      <Properties>
        <Property icon={<FolderTree />} label="Parent">
          <GroupTreeCombobox
            groups={parentOptions}
            value={group.parentId ? [group.parentId] : []}
            onChange={(value) =>
              void onUpdate(group._id, { parentId: value.at(-1) ?? null })
            }
            placeholder="None"
            searchPlaceholder="Search groups…"
          />
        </Property>
        {childGroups.length > 0 ? (
          <Property label="Subgroups">
            <span className="truncate">
              {childGroups.map((child) => child.name).join(", ")}
            </span>
          </Property>
        ) : null}
      </Properties>

      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => {
          if (description !== (group.description || "")) {
            void onUpdate(group._id, { description });
          }
        }}
        placeholder="Description"
        aria-label="Description"
        className="min-h-20 resize-none border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
      />

      <Section title="Members" count={members.length}>
        {members.length === 0 ? (
          <EmptyState compact label="No members" />
        ) : (
          <List>
            {members.map((person) => (
              <ListRow
                key={person._id}
                onClick={() => onSelectPerson(person)}
                leading={
                  <PersonAvatar
                    size="xs"
                    photo={person.photos[0]}
                    name={person.name}
                  />
                }
                title={person.name}
                description={person.placeMet || undefined}
              />
            ))}
          </List>
        )}
      </Section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${group.name}?`}
        description="Members stay; subgroups move to the top level."
        actionLabel="Delete"
        destructive
        onConfirm={() => onDelete(group._id)}
      />
    </PageBody>
  );
}
