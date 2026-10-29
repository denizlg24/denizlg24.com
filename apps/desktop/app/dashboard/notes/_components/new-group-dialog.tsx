"use client";

import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Textarea } from "@repo/ui/textarea";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import type { INoteGroup } from "@/lib/data-types";
import { GroupTreeCombobox } from "./group-tree-combobox";

export function NewGroupDialog({
  api,
  open,
  parentId,
  groups,
  onOpenChange,
  onCreated,
}: {
  api: denizApi | null;
  open: boolean;
  parentId: string | null;
  groups: INoteGroup[];
  onOpenChange: (open: boolean) => void;
  onCreated: (group: INoteGroup) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setSelectedParentId(parentId);
  }, [open, parentId]);

  const parent = groups.find((group) => group._id === selectedParentId);

  const submit = async () => {
    if (!api) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const result = await api.POST<{ group: INoteGroup }>({
      endpoint: "note-groups",
      body: {
        name: trimmed,
        description: description.trim() || undefined,
        parentId: selectedParentId,
      },
    });
    setSubmitting(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onCreated(result.group);
    onOpenChange(false);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New group"
      onSubmit={submit}
      submitLabel="Create"
      submitDisabled={!api || name.trim().length === 0}
      pending={submitting}
    >
      <FormGrid>
        <FormField label="Name" htmlFor="new-group-name">
          <Input
            id="new-group-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="Parent">
          <div className="flex h-8 items-center gap-1">
            <span className="min-w-0 truncate text-sm text-accent-strong">
              {parent?.name ?? "Top level"}
            </span>
            <GroupTreeCombobox
              groups={groups}
              value={selectedParentId ? [selectedParentId] : []}
              onChange={(next) =>
                setSelectedParentId(
                  next.find((id) => id !== selectedParentId) ?? null,
                )
              }
              placeholder="Choose"
              searchPlaceholder="Search groups…"
              emptyMessage="No groups"
            />
          </div>
        </FormField>
        <FormField
          label="Description"
          htmlFor="new-group-description"
          className="sm:col-span-2"
        >
          <Textarea
            id="new-group-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-32"
          />
        </FormField>
      </FormGrid>
    </FormDialog>
  );
}
