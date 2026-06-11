"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ILeanCapability } from "@/models/Resource";
import { PiCronDashboard } from "./picron/picron-dashboard";

const TYPE_LABELS: Record<string, string> = {
  picron: "PiCron",
};

interface CapabilitySectionProps {
  resourceId: string;
  capability: ILeanCapability;
  onRefresh: () => void;
}

export function CapabilitySection({
  resourceId,
  capability,
  onRefresh,
}: CapabilitySectionProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/resources/${resourceId}/capabilities/${capability._id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to delete capability");
      }
      toast.success("Capability removed");
      setDeleteOpen(false);
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete capability",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {TYPE_LABELS[capability.type] ?? capability.type}
          </Badge>
          <span className="text-sm font-medium">{capability.label}</span>
          {capability.baseUrl && (
            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
              {capability.baseUrl}
            </span>
          )}
          {!capability.isActive && (
            <Badge variant="secondary" className="text-xs">
              Inactive
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
          title="Remove capability"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {capability.type === "picron" && (
        <PiCronDashboard
          resourceId={resourceId}
          capId={capability._id}
          name={capability.label}
          baseUrl={capability.baseUrl}
        />
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogTitle>Remove Capability</DialogTitle>
          <DialogDescription>
            Remove &ldquo;{capability.label}&rdquo; from this resource? This
            cannot be undone.
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
