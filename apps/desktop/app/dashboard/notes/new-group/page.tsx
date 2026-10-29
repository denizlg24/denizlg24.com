"use client";

import { Button } from "@repo/ui/button";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { FolderPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { INoteGroup } from "@/lib/data-types";
import { GroupTreeCombobox } from "../_components/group-tree-combobox";

export default function NewGroupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi();
  }, [settings, loadingSettings]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string | null>(
    () => searchParams.get("parent") ?? null,
  );
  const [groups, setGroups] = useState<INoteGroup[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

  const parent = groups.find((group) => group._id === parentId);

  const submit = async () => {
    if (!api || submitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSubmitting(true);

    const result = await api.POST<{ group: INoteGroup }>({
      endpoint: "note-groups",
      body: {
        name: trimmedName,
        description: description.trim() || undefined,
        parentId,
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
    <Page>
      <PageHeader
        leading={<SidebarTrigger className="-ml-1 size-7 md:hidden" />}
        icon={<FolderPlus />}
        title="New group"
        crumbs={[
          { label: "Notes", onClick: () => router.push("/dashboard/notes") },
        ]}
      >
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={submitting || !api || name.trim().length === 0}
        >
          {submitting && <Spinner className="size-3.5" />}
          Create
        </Button>
      </PageHeader>

      <PageBody width="narrow">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FormGrid>
            <FormField label="Name" htmlFor="group-name">
              <Input
                id="group-name"
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
                  value={parentId ? [parentId] : []}
                  onChange={(next) =>
                    setParentId(next.find((id) => id !== parentId) ?? null)
                  }
                  placeholder="Choose"
                  searchPlaceholder="Search groups…"
                  emptyMessage="No groups"
                />
              </div>
            </FormField>
            <FormField
              label="Description"
              htmlFor="group-description"
              className="sm:col-span-2"
            >
              <Textarea
                id="group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-32"
              />
            </FormField>
          </FormGrid>
        </form>
      </PageBody>
    </Page>
  );
}
