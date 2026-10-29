"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { RowActions } from "@repo/ui/toolbar";
import {
  ArrowLeft,
  CalendarClock,
  FileText,
  Folder,
  FolderTree,
  Sparkles,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { INote, INoteGroup } from "@/lib/data-types";
import { GroupTreeCombobox } from "./group-tree-combobox";
import { formatDate, relativeDate } from "./note-format";

interface Props {
  group: INoteGroup;
  groups: INoteGroup[];
  notes: INote[];
  onBack: () => void;
  onUpdate: (id: string, patch: Partial<INoteGroup>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSelectNote: (note: INote) => void;
  onSelectGroup: (group: INoteGroup) => void;
}

function descendantIds(rootId: string, groups: INoteGroup[]): Set<string> {
  const result = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const group of groups) {
      if (group.parentId === current && !result.has(group._id)) {
        result.add(group._id);
        stack.push(group._id);
      }
    }
  }

  return result;
}

export function GroupDetail({
  group,
  groups,
  notes,
  onBack,
  onUpdate,
  onDelete,
  onSelectNote,
  onSelectGroup,
}: Props) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || "");
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setName(group.name);
    setDescription(group.description || "");
  }, [group.name, group.description]);

  const subtreeIds = useMemo(() => {
    const result = descendantIds(group._id, groups);
    result.add(group._id);
    return result;
  }, [group._id, groups]);

  const parentOptions = useMemo(
    () =>
      groups
        .filter((candidate) => !subtreeIds.has(candidate._id))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [groups, subtreeIds],
  );

  const parent = useMemo(() => {
    if (!group.parentId) return null;
    return groups.find((candidate) => candidate._id === group.parentId) ?? null;
  }, [group.parentId, groups]);

  const members = useMemo(
    () =>
      notes
        .filter((note) =>
          (note.groupIds ?? []).some((groupId) => subtreeIds.has(groupId)),
        )
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        ),
    [notes, subtreeIds],
  );

  const directMemberCount = useMemo(
    () =>
      notes.filter((note) => (note.groupIds ?? []).includes(group._id)).length,
    [notes, group._id],
  );
  const nestedMemberCount = members.length - directMemberCount;

  const children = groups.filter(
    (candidate) => candidate.parentId === group._id,
  );

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(group.name);
      return;
    }
    if (trimmed !== group.name) {
      void onUpdate(group._id, { name: trimmed });
    }
  };

  const saveDescription = () => {
    if (description !== (group.description || "")) {
      void onUpdate(group._id, { description });
    }
  };

  const changeParent = (next: string | null) => {
    if ((group.parentId ?? null) === next) return;
    void onUpdate(group._id, { parentId: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft />
        </Button>
        <FolderTree className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-1 text-xs">
          {parent && (
            <>
              <button
                type="button"
                onClick={() => onSelectGroup(parent)}
                className="truncate rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-surface hover:text-accent-strong"
              >
                {parent.name}
              </button>
              <span className="text-muted-foreground/50">/</span>
            </>
          )}
          <span className="truncate px-1 text-accent-strong">{group.name}</span>
        </div>
        <RowActions label="Group actions">
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </RowActions>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 pt-8 pb-16 sm:px-10">
          <div className="flex flex-col gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label="Name"
              placeholder="Untitled"
              className="w-full bg-transparent text-3xl font-semibold leading-tight tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/50"
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={saveDescription}
              aria-label="Description"
              placeholder="Description"
              rows={2}
              className="field-sizing-content min-h-6 w-full resize-none bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:text-accent-strong"
            />
          </div>

          <Properties>
            <Property icon={<Folder />} label="Parent">
              <div className="flex flex-wrap items-center gap-1 py-1">
                {parent && (
                  <Badge variant="secondary" className="max-w-64">
                    <span className="truncate">{parent.name}</span>
                  </Badge>
                )}
                <GroupTreeCombobox
                  groups={parentOptions}
                  value={parent ? [parent._id] : []}
                  onChange={(next) =>
                    changeParent(next.find((id) => id !== parent?._id) ?? null)
                  }
                  placeholder={parent ? "Change" : "None"}
                  searchPlaceholder="Search groups…"
                  emptyMessage="No groups"
                />
              </div>
            </Property>
            {children.length > 0 && (
              <Property icon={<FolderTree />} label="Sub-groups">
                <div className="flex flex-wrap gap-1 py-1">
                  {children.map((child) => (
                    <button
                      type="button"
                      key={child._id}
                      onClick={() => onSelectGroup(child)}
                      className="inline-flex h-6 items-center rounded-md bg-surface px-1.5 text-xs text-accent-strong transition-colors hover:bg-muted"
                    >
                      {child.name}
                    </button>
                  ))}
                </div>
              </Property>
            )}
            <Property
              icon={group.autoCreated ? <Sparkles /> : <CalendarClock />}
              label="Created"
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatDate(group.createdAt)}
                {group.autoCreated ? " · auto" : ""}
              </span>
            </Property>
          </Properties>

          <Section
            title="Notes"
            count={
              nestedMemberCount > 0
                ? `${directMemberCount} + ${nestedMemberCount}`
                : members.length
            }
          >
            {members.length === 0 ? (
              <EmptyState compact icon={<FileText />} label="No notes" />
            ) : (
              <List>
                {members.map((note) => (
                  <ListRow
                    key={note._id}
                    onClick={() => onSelectNote(note)}
                    leading={
                      note.favicon ? (
                        <Image
                          src={note.favicon}
                          alt=""
                          width={14}
                          height={14}
                          className="size-3.5 rounded-sm"
                          unoptimized
                        />
                      ) : (
                        <FileText />
                      )
                    }
                    title={note.title || "Untitled"}
                    meta={relativeDate(note.updatedAt)}
                  />
                ))}
              </List>
            )}
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete group?"
        description="Child groups move to the top level; notes keep their other groups."
        actionLabel="Delete"
        destructive
        onConfirm={() => onDelete(group._id)}
      />
    </div>
  );
}
