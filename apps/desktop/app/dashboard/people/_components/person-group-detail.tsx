"use client";

import { ArrowLeft, FolderTree, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GroupTreeCombobox } from "@/app/dashboard/notes/_components/group-tree-combobox";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { IPerson, IPersonGroup } from "@/lib/data-types";

interface Props {
  group: IPersonGroup;
  groups: IPersonGroup[];
  people: IPerson[];
  onBack: () => void;
  onUpdate: (id: string, patch: Partial<IPersonGroup>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSelectPerson: (person: IPerson) => void;
}

function descendantIds(rootId: string, groups: IPersonGroup[]) {
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

  useEffect(() => {
    setName(group.name);
    setDescription(group.description || "");
  }, [group]);

  const parentOptions = useMemo(() => {
    const forbidden = descendantIds(group._id, groups);
    forbidden.add(group._id);
    return groups.filter((candidate) => !forbidden.has(candidate._id));
  }, [group._id, groups]);

  const members = useMemo(
    () => people.filter((person) => person.groupIds.includes(group._id)),
    [group._id, people],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <FolderTree className="size-4" />
          <h1 className="text-sm font-medium">{group.name}</h1>
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
                People stay but lose this membership. Child groups become
                top-level.
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

      <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
        <div className="space-y-2">
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() && name !== group.name) {
                void onUpdate(group._id, { name: name.trim() });
              }
            }}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Description</Label>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description !== (group.description || "")) {
                void onUpdate(group._id, { description });
              }
            }}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Parent group</Label>
          <GroupTreeCombobox
            groups={parentOptions}
            value={group.parentId ? [group.parentId] : []}
            onChange={(value) =>
              void onUpdate(group._id, { parentId: value.at(-1) ?? null })
            }
            placeholder="None"
            searchPlaceholder="Search group hierarchy…"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Members ({members.length})</Label>
          <div className="divide-y rounded border">
            {members.map((person) => (
              <button
                type="button"
                key={person._id}
                onClick={() => onSelectPerson(person)}
                className="flex w-full px-3 py-2 text-left text-sm hover:bg-muted/40"
              >
                {person.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
