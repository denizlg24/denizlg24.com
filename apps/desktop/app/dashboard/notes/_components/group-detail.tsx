"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Textarea } from "@repo/ui/textarea";
import { ArrowLeft, FolderTree, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { INote, INoteGroup } from "@/lib/data-types";
import { GroupTreeCombobox } from "./group-tree-combobox";

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

const NONE_VALUE = "__none__";

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

  useEffect(() => {
    setName(group.name);
    setDescription(group.description || "");
  }, [group.name, group.description]);

  const parentOptions = useMemo(() => {
    const forbidden = descendantIds(group._id, groups);
    forbidden.add(group._id);

    return groups
      .filter((candidate) => !forbidden.has(candidate._id))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [group._id, groups]);

  const parent = useMemo(() => {
    if (!group.parentId) return null;
    return groups.find((candidate) => candidate._id === group.parentId) ?? null;
  }, [group.parentId, groups]);

  const subtreeIds = useMemo(() => {
    const result = descendantIds(group._id, groups);
    result.add(group._id);
    return result;
  }, [group._id, groups]);

  const members = useMemo(
    () =>
      notes.filter((note) =>
        (note.groupIds ?? []).some((groupId) => subtreeIds.has(groupId)),
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
    if (name.trim() && name !== group.name) {
      void onUpdate(group._id, { name: name.trim() });
    }
  };

  const saveDescription = () => {
    if (description !== (group.description || "")) {
      void onUpdate(group._id, { description });
    }
  };

  const handleParentChange = (value: string) => {
    const next = value === NONE_VALUE ? null : value;
    if ((group.parentId ?? null) === next) return;
    void onUpdate(group._id, { parentId: next });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <FolderTree className="size-4" />
          <div className="flex items-center gap-1.5 text-xs">
            {parent && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectGroup(parent)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {parent.name}
                </button>
                <span className="text-muted-foreground">/</span>
              </>
            )}
            <span className="font-medium">{group.name}</span>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this group?</AlertDialogTitle>
              <AlertDialogDescription>
                Child groups become top-level. Notes stay but lose this
                membership.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void onDelete(group._id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
          <div className="space-y-2">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={saveDescription}
              placeholder="What this group is about…"
              className="min-h-20 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Parent group</Label>
            <GroupTreeCombobox
              groups={[
                {
                  _id: NONE_VALUE,
                  name: "None",
                  autoCreated: false,
                  createdAt: new Date().toDateString(),
                  updatedAt: new Date().toDateString(),
                },
                ...parentOptions,
              ]}
              value={[parent ? parent._id : NONE_VALUE]}
              onChange={(next) => {
                const currentId = parent ? parent._id : NONE_VALUE;
                if (next.length === 0) {
                  handleParentChange(NONE_VALUE);
                  return;
                }
                const added = next.find((id) => id !== currentId);
                handleParentChange(added ?? NONE_VALUE);
              }}
              placeholder="None"
              searchPlaceholder="Search group hierarchy…"
              emptyMessage="No groups yet"
            />
          </div>

          {children.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Sub-groups ({children.length})</Label>
              <div className="flex flex-wrap gap-1">
                {children.map((child) => (
                  <button
                    type="button"
                    key={child._id}
                    onClick={() => onSelectGroup(child)}
                    className="rounded border px-2 py-0.5 text-[10px] hover:bg-muted"
                  >
                    {child.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs">
              Members ({members.length})
              {nestedMemberCount > 0 && (
                <span className="ml-1 font-normal text-muted-foreground">
                  · {directMemberCount} direct · {nestedMemberCount} nested
                </span>
              )}
            </Label>
            <div className="divide-y rounded border">
              {members.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  No notes in this group.
                </div>
              ) : (
                members.map((note) => (
                  <button
                    type="button"
                    key={note._id}
                    onClick={() => onSelectNote(note)}
                    className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                  >
                    {note.favicon ? (
                      <Image
                        src={note.favicon}
                        alt=""
                        width={14}
                        height={14}
                        className="size-3.5 shrink-0 rounded-sm"
                        unoptimized
                      />
                    ) : (
                      <div className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-muted text-[8px] text-muted-foreground">
                        N
                      </div>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {note.title}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground">
            {group.autoCreated ? "Auto-created by LLM" : "Manually created"} ·{" "}
            {new Date(group.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}
