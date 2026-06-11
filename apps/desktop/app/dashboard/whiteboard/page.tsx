"use client";

import { PenTool, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IWhiteboardMeta } from "@/lib/data-types";
import { WhiteboardCard } from "./_components/whiteboard-card";
import { WhiteboardEditor } from "./_components/whiteboard-editor";

export default function Page() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const API = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [whiteboards, setWhiteboards] = useState<IWhiteboardMeta[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const [renameTarget, setRenameTarget] = useState<IWhiteboardMeta | null>(
    null,
  );
  const [renameName, setRenameName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<IWhiteboardMeta | null>(
    null,
  );

  const fetchWhiteboards = async () => {
    if (!API) return;
    setLoading(true);
    try {
      const result = await API.GET<{ whiteboards: IWhiteboardMeta[] }>({
        endpoint: "whiteboard",
      });
      if ("code" in result) {
        console.error(result);
        setLoading(false);
        return;
      }
      setWhiteboards(result.whiteboards);
      setLoading(false);
    } catch (_error) {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!API || !createName.trim()) return;
    setIsSubmitting(true);
    try {
      const result = await API.POST<{ whiteboard: IWhiteboardMeta }>({
        endpoint: "whiteboard",
        body: { name: createName.trim() },
      });
      if ("code" in result) {
        toast.error("Failed to create board");
        return;
      }
      setWhiteboards((prev) => [...prev, result.whiteboard]);
      setCreateOpen(false);
      setCreateName("");
      toast.success("Board created");
      setActiveId(result.whiteboard._id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRenameDialog = useCallback((board: IWhiteboardMeta) => {
    setRenameTarget(board);
    setRenameName(board.name);
  }, []);

  const handleRename = async () => {
    if (!API || !renameTarget || !renameName.trim()) return;
    setIsSubmitting(true);
    try {
      const result = await API.PUT<{ whiteboard: IWhiteboardMeta }>({
        endpoint: `whiteboard/${renameTarget._id}`,
        body: { name: renameName.trim() },
      });
      if ("code" in result) {
        toast.error("Failed to rename board");
        return;
      }
      setWhiteboards((prev) =>
        prev.map((b) =>
          b._id === renameTarget._id ? { ...b, name: renameName.trim() } : b,
        ),
      );
      setRenameTarget(null);
      toast.success("Board renamed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!API || !deleteTarget) return;
    setIsSubmitting(true);
    try {
      const result = await API.DELETE<{}>({
        endpoint: `whiteboard/${deleteTarget._id}`,
      });
      if ("code" in result) {
        toast.error("Failed to delete board");
        return;
      }
      setWhiteboards((prev) => prev.filter((b) => b._id !== deleteTarget._id));
      setDeleteTarget(null);
      toast.success("Board deleted");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = useCallback(() => {
    setActiveId(null);
    setLoading(true);
  }, []);

  useEffect(() => {
    if (!API || !loading) return;
    fetchWhiteboards();
  }, [API, loading, fetchWhiteboards]);

  if (activeId) {
    return <WhiteboardEditor id={activeId} onBack={handleBack} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <PenTool className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Whiteboards</span>
        <Button size={"sm"} onClick={() => setCreateOpen(true)}>
          <Plus />
          Add Board
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border bg-card overflow-hidden animate-pulse"
              >
                <div className="h-32 bg-muted/40" />
                <div className="p-3 flex flex-col gap-2">
                  <div className="h-4 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-1/2 bg-muted rounded" />
                </div>
              </div>
            ))}
          {!loading &&
            API &&
            whiteboards.map((board) => (
              <WhiteboardCard
                key={board._id}
                board={board}
                api={API}
                onRename={openRenameDialog}
                onDelete={setDeleteTarget}
                onOpen={setActiveId}
              />
            ))}

          {!loading && (
            <button
              onClick={() => setCreateOpen(true)}
              className="rounded-2xl border-2 border-dashed bg-transparent hover:bg-muted/50 transition-colors h-full min-h-29 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <div className="size-8 rounded-full border-2 border-dashed flex items-center justify-center">
                <Plus className="size-4" />
              </div>
              <span className="text-xs font-medium">New Board</span>
            </button>
          )}
        </div>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setCreateName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Board</DialogTitle>
            <DialogDescription>
              Give your whiteboard a name to get started.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="e.g. Sprint Planning"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setCreateName("");
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isSubmitting || !createName.trim()}
            >
              {isSubmitting ? "Creating\u2026" : "Create Board"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Board</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-name">Name</Label>
            <Input
              id="rename-name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={isSubmitting || !renameName.trim()}
            >
              {isSubmitting ? "Saving\u2026" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Board</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              All elements will be permanently deleted. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting\u2026" : "Delete Board"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
