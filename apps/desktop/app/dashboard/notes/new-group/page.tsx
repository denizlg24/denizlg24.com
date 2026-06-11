"use client";

import { ArrowLeft, FolderPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { INoteGroup } from "@/lib/data-types";
import { GroupTreeCombobox } from "../_components/group-tree-combobox";

const NONE_VALUE = "__none__";

export default function NewGroupPage() {
  const router = useRouter();
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string>(NONE_VALUE);
  const [groups, setGroups] = useState<INoteGroup[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const selectedParentIds = parentId === NONE_VALUE ? [] : [parentId];

  useEffect(() => {
    if (!api) return;

    api
      .GET<{ groups: INoteGroup[] }>({ endpoint: "note-groups" })
      .then((result) => {
        if ("code" in result) return;

        setGroups(
          [...result.groups].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        );
      });
  }, [api]);

  const submit = async () => {
    if (!api || submitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }

    setSubmitting(true);

    const result = await api.POST<{ group: INoteGroup }>({
      endpoint: "note-groups",
      body: {
        name: trimmedName,
        description: description.trim() || undefined,
        parentId: parentId === NONE_VALUE ? null : parentId,
      },
    });

    setSubmitting(false);

    if ("code" in result) {
      toast.error(result.message);
      return;
    }

    toast.success("Group created");
    router.push("/dashboard/notes");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/dashboard/notes")}
            title="Back"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <FolderPlus className="size-4" />
          <h1 className="text-sm font-medium">New group</h1>
        </div>

        <Button
          size="sm"
          className="h-7"
          onClick={submit}
          disabled={submitting}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          Create
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl space-y-5 p-6">
          <div className="space-y-2">
            <Label className="text-xs">Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submit();
                }
              }}
              placeholder="Research"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this group is about…"
              className="min-h-20 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Parent group</Label>
            <GroupTreeCombobox
              groups={groups}
              value={selectedParentIds}
              onChange={(next) => setParentId(next.at(-1) ?? NONE_VALUE)}
              placeholder="Choose parent group…"
              searchPlaceholder="Search group hierarchy…"
              emptyMessage="No groups yet"
            />
            <p className="text-[10px] text-muted-foreground">
              Leave empty to create a top-level group.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
