"use client";

import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List } from "@repo/ui/list";
import { Page, PageBody } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { PenTool, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { denizApi } from "@/lib/api-wrapper";
import type { IWhiteboardMeta } from "@/lib/data-types";
import { WhiteboardRow } from "./_components/whiteboard-card";
import { WhiteboardEditor } from "./_components/whiteboard-editor";

type NameDialog =
  | { mode: "create" }
  | { mode: "rename"; board: IWhiteboardMeta };

function WhiteboardListSkeleton() {
  return (
    <div className="flex flex-col">
      {["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-2/5"].map((width, index) => (
        <div key={index} className="flex h-9 items-center gap-3">
          <Skeleton className="size-4" />
          <Skeleton className={`h-3.5 ${width}`} />
          <Skeleton className="ml-auto h-3 w-6" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function WhiteboardsPage() {
  const api = useMemo(() => new denizApi(), []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [whiteboards, setWhiteboards] = useState<IWhiteboardMeta[]>([]);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IWhiteboardMeta | null>(
    null,
  );

  const fetchWhiteboards = useCallback(async () => {
    setLoading(true);
    const result = await api.GET<{ whiteboards: IWhiteboardMeta[] }>({
      endpoint: "whiteboard",
    });
    if ("code" in result) toast.error(result.message);
    else setWhiteboards(result.whiteboards);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    if (activeId) return;
    void fetchWhiteboards();
  }, [activeId, fetchWhiteboards]);

  const openNameDialog = (dialog: NameDialog) => {
    setName(dialog.mode === "rename" ? dialog.board.name : "");
    setNameDialog(dialog);
  };

  const submitName = async () => {
    const trimmed = name.trim();
    if (!nameDialog || !trimmed) return;
    setIsSubmitting(true);
    if (nameDialog.mode === "create") {
      const result = await api.POST<{ whiteboard: IWhiteboardMeta }>({
        endpoint: "whiteboard",
        body: { name: trimmed },
      });
      setIsSubmitting(false);
      if ("code" in result) {
        toast.error("Failed to create board");
        return;
      }
      setNameDialog(null);
      setActiveId(result.whiteboard._id);
      return;
    }
    const target = nameDialog.board;
    const result = await api.PUT<{ whiteboard: IWhiteboardMeta }>({
      endpoint: `whiteboard/${target._id}`,
      body: { name: trimmed },
    });
    setIsSubmitting(false);
    if ("code" in result) {
      toast.error("Failed to rename board");
      return;
    }
    setWhiteboards((prev) =>
      prev.map((b) => (b._id === target._id ? { ...b, name: trimmed } : b)),
    );
    setNameDialog(null);
  };

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    const result = await api.DELETE<{ success: true }>({
      endpoint: `whiteboard/${target._id}`,
    });
    if ("code" in result) {
      toast.error("Failed to delete board");
      return;
    }
    setWhiteboards((prev) => prev.filter((b) => b._id !== target._id));
    setDeleteTarget(null);
  };

  if (activeId) {
    return <WhiteboardEditor id={activeId} onBack={() => setActiveId(null)} />;
  }

  return (
    <Page>
      <DashboardPageHeader icon={<PenTool />} title="Whiteboards">
        <Button size="sm" onClick={() => openNameDialog({ mode: "create" })}>
          <Plus />
          New
        </Button>
      </DashboardPageHeader>
      <PageBody>
        {loading && whiteboards.length === 0 ? (
          <WhiteboardListSkeleton />
        ) : whiteboards.length === 0 ? (
          <EmptyState icon={<PenTool />} label="No boards" />
        ) : (
          <List>
            {whiteboards.map((board) => (
              <WhiteboardRow
                key={board._id}
                board={board}
                api={api}
                onOpen={setActiveId}
                onRename={(target) =>
                  openNameDialog({ mode: "rename", board: target })
                }
                onDelete={setDeleteTarget}
              />
            ))}
          </List>
        )}
      </PageBody>

      <FormDialog
        open={nameDialog !== null}
        onOpenChange={(open) => !open && setNameDialog(null)}
        title={nameDialog?.mode === "rename" ? "Rename board" : "New board"}
        submitLabel={nameDialog?.mode === "rename" ? "Save" : "Create"}
        submitDisabled={!name.trim()}
        pending={isSubmitting}
        onSubmit={submitName}
      >
        <FormGrid>
          <FormField
            label="Name"
            htmlFor="whiteboard-name"
            className="sm:col-span-2"
          >
            <Input
              id="whiteboard-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </FormField>
        </FormGrid>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete “${deleteTarget?.name ?? ""}”?`}
        actionLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </Page>
  );
}
