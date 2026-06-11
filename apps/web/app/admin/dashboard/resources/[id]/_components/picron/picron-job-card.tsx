"use client";

import { formatDistanceToNow } from "date-fns";
import { Clock, Eye, EyeOff, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PiCronJob } from "@/lib/picron";
import { JobFormDialog } from "./job-form-dialog";
import { JobHistoryDialog } from "./job-history-dialog";

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-accent/20 text-accent-strong",
  POST: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  PUT: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
  PATCH:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
};

function LastStatus({ status }: { status: number | null }) {
  if (status === null)
    return <span className="text-xs text-muted-foreground">Never run</span>;
  if (status === 0)
    return (
      <span className="text-xs text-destructive font-medium">
        Network error
      </span>
    );
  const color =
    status >= 200 && status < 300 ? "text-accent-strong" : "text-destructive";
  return (
    <span className={`text-xs font-mono font-medium ${color}`}>{status}</span>
  );
}

interface PiCronJobCardProps {
  resourceId: string;
  capId: string;
  job: PiCronJob;
  onRefresh: () => void;
}

export function PiCronJobCard({
  resourceId,
  capId,
  job,
  onRefresh,
}: PiCronJobCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const apiBase = `/api/admin/resources/${resourceId}/capabilities/${capId}/picron`;

  const handleToggle = async () => {
    setToggling(true);
    try {
      const res = await fetch(`${apiBase}/jobs/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to toggle job");
      }
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to toggle job",
      );
    } finally {
      setToggling(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    toast.loading("Triggering job...", { id: `trigger-${job.id}` });
    try {
      const res = await fetch(`${apiBase}/jobs/${job.id}/trigger`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to trigger job");
      }
      toast.success("Job triggered successfully", { id: `trigger-${job.id}` });
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to trigger job",
        { id: `trigger-${job.id}` },
      );
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${apiBase}/jobs/${job.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to delete job");
      }
      toast.success("Job deleted");
      setDeleteOpen(false);
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete job",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span
              className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs font-mono font-semibold ${METHOD_COLORS[job.method.toUpperCase()] ?? ""}`}
            >
              {job.method.toUpperCase()}
            </span>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="font-medium text-sm">{job.name}</span>
                {!job.enabled && (
                  <Badge variant="secondary" className="text-xs">
                    Disabled
                  </Badge>
                )}
              </div>

              <p className="text-xs font-mono text-muted-foreground mb-1">
                {job.expression}
              </p>

              <p className="text-xs text-muted-foreground truncate mb-1">
                {job.url}
              </p>

              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                {job.next_run && (
                  <span>
                    Next:{" "}
                    <span className="text-foreground">
                      {formatDistanceToNow(new Date(job.next_run), {
                        addSuffix: true,
                      })}
                    </span>
                  </span>
                )}
                {job.last_run && (
                  <span>
                    Last: <LastStatus status={job.last_status} />
                    {" · "}
                    {formatDistanceToNow(new Date(job.last_run), {
                      addSuffix: true,
                    })}
                  </span>
                )}
                {!job.last_run && <LastStatus status={null} />}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleToggle}
              disabled={toggling}
              title={job.enabled ? "Disable job" : "Enable job"}
            >
              {job.enabled ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleTrigger}
              disabled={triggering}
              title="Run now"
            >
              <Play className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setHistoryOpen(true)}
              title="Execution history"
            >
              <Clock className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setEditOpen(true)}
              title="Edit job"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              title="Delete job"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <JobFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        resourceId={resourceId}
        capId={capId}
        job={job}
        onSuccess={onRefresh}
      />
      <JobHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        resourceId={resourceId}
        capId={capId}
        jobId={job.id}
        jobName={job.name}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogTitle>Delete Job</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{job.name}&rdquo;? This cannot be undone.
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
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
