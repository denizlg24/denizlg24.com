"use client";

import type { ICapability, PiCronJob, PiCronStats } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import { type JobFormData, JobFormDialog } from "./job-form-dialog";
import { JobHistoryDialog } from "./job-history-dialog";
import { PiCronJobRow } from "./picron-job-row";

export function PiCronDashboard({
  resourceId,
  capability,
}: {
  resourceId: string;
  capability: ICapability;
}) {
  const { client } = useAdmin();
  const [jobs, setJobs] = useState<PiCronJob[]>([]);
  const [stats, setStats] = useState<PiCronStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<PiCronJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PiCronJob | null>(null);
  const [historyJob, setHistoryJob] = useState<PiCronJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  const basePath = `resources/${resourceId}/capabilities/${capability._id}/picron`;

  const fetchData = useCallback(() => {
    setLoading(true);
    Promise.all([
      client
        .get<PiCronJob[]>(`${basePath}/jobs`)
        .catch(() => [] as PiCronJob[]),
      client.get<PiCronStats>(`${basePath}/stats`).catch(() => null),
    ])
      .then(([jobsRes, statsRes]) => {
        setJobs(jobsRes);
        setStats(statsRes);
      })
      .finally(() => setLoading(false));
  }, [client, basePath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateJob = async (data: JobFormData) => {
    try {
      const result = await client.post<PiCronJob>(`${basePath}/jobs`, data);
      setJobs((prev) => [...prev, result]);
      setCreateOpen(false);
      toast.success("Job created");
    } catch {
      toast.error("Failed to create job");
    }
  };

  const handleUpdateJob = async (data: JobFormData) => {
    if (!editingJob) return;
    try {
      const result = await client.put<PiCronJob>(
        `${basePath}/jobs/${editingJob.id}`,
        data,
      );
      setJobs((prev) => prev.map((j) => (j.id === editingJob.id ? result : j)));
      setEditingJob(null);
      toast.success("Job updated");
    } catch {
      toast.error("Failed to update job");
    }
  };

  const handleDeleteJob = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await client.del(`${basePath}/jobs/${deleteTarget.id}`);
      setJobs((prev) => prev.filter((j) => j.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("Job deleted");
    } catch {
      toast.error("Failed to delete job");
    } finally {
      setDeleting(false);
    }
  };

  const handleTrigger = async (job: PiCronJob) => {
    try {
      await client.post<PiCronJob>(`${basePath}/jobs/${job.id}/trigger`, {});
      toast.success(`Triggered "${job.name}"`);
      fetchData();
    } catch {
      toast.error("Failed to trigger job");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium">
          Cron Jobs
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 text-muted-foreground"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-3" /> New Job
        </Button>
      </div>

      {stats && (
        <div className="flex items-center gap-6 mb-4 pb-4 border-b border-border/30">
          <div>
            <p className="text-lg font-mono font-semibold tabular-nums">
              {stats.total_jobs}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
              total
            </p>
          </div>
          <div>
            <p className="text-lg font-mono font-semibold tabular-nums text-accent">
              {stats.active_jobs}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
              active
            </p>
          </div>
          <div>
            <p className="text-lg font-mono font-semibold tabular-nums">
              {stats.total_executions}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
              runs
            </p>
          </div>
          <div>
            <p
              className={`text-lg font-mono font-semibold tabular-nums ${stats.failed_executions_24h > 0 ? "text-red-500" : ""}`}
            >
              {stats.failed_executions_24h}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
              fails 24h
            </p>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 text-center py-8">
          No cron jobs configured
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {jobs.map((job) => (
            <PiCronJobRow
              key={job.id}
              job={job}
              onEdit={() => setEditingJob(job)}
              onDelete={() => setDeleteTarget(job)}
              onTrigger={() => handleTrigger(job)}
              onHistory={() => setHistoryJob(job)}
            />
          ))}
        </div>
      )}

      <JobFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreateJob}
      />

      <JobFormDialog
        open={!!editingJob}
        key={editingJob?.id ?? "editDialog"}
        onOpenChange={(o) => !o && setEditingJob(null)}
        onSubmit={handleUpdateJob}
        editingJob={editingJob}
      />

      {historyJob && (
        <JobHistoryDialog
          open={!!historyJob}
          key={historyJob?.id ?? "historyDialog"}
          onOpenChange={(o) => !o && setHistoryJob(null)}
          jobId={historyJob.id}
          jobName={historyJob.name}
          resourceId={resourceId}
          capId={capability._id}
        />
      )}

      <Dialog
        open={!!deleteTarget}
        key={deleteTarget?.id ?? "deleteDialog"}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Job</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteJob}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
