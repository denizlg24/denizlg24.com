"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
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
import type { denizApi } from "@/lib/api-wrapper";
import type { ICapability, PiCronJob, PiCronStats } from "@/lib/data-types";
import { JobFormDialog } from "./job-form-dialog";
import { JobHistoryDialog } from "./job-history-dialog";
import { PiCronJobRow } from "./picron-job-row";

export function PiCronDashboard({
  API,
  resourceId,
  capability,
}: {
  API: denizApi;
  resourceId: string;
  capability: ICapability;
}) {
  const [jobs, setJobs] = useState<PiCronJob[]>([]);
  const [stats, setStats] = useState<PiCronStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<PiCronJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PiCronJob | null>(null);
  const [historyJob, setHistoryJob] = useState<PiCronJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  const basePath = `resources/${resourceId}/capabilities/${capability._id}/picron`;

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      API.GET<PiCronJob[]>({ endpoint: `${basePath}/jobs` }),
      API.GET<PiCronStats>({ endpoint: `${basePath}/stats` }),
    ])
      .then(([jobsRes, statsRes]) => {
        if (!("code" in jobsRes)) setJobs(jobsRes);
        if (!("code" in statsRes)) setStats(statsRes);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateJob = async (
    data: Parameters<typeof API.POST>[0]["body"],
  ) => {
    const result = await API.POST<PiCronJob>({
      endpoint: `${basePath}/jobs`,
      body: data,
    });
    if ("code" in result) {
      toast.error("Failed to create job");
      return;
    }
    setJobs((prev) => [...prev, result]);
    setCreateOpen(false);
    toast.success("Job created");
  };

  const handleUpdateJob = async (
    data: Parameters<typeof API.PUT>[0]["body"],
  ) => {
    if (!editingJob) return;
    const result = await API.PUT<PiCronJob>({
      endpoint: `${basePath}/jobs/${editingJob.id}`,
      body: data,
    });
    if ("code" in result) {
      toast.error("Failed to update job");
      return;
    }
    setJobs((prev) => prev.map((j) => (j.id === editingJob.id ? result : j)));
    setEditingJob(null);
    toast.success("Job updated");
  };

  const handleDeleteJob = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await API.DELETE<{ status: string }>({
      endpoint: `${basePath}/jobs/${deleteTarget.id}`,
    });
    setDeleting(false);
    if ("code" in result) {
      toast.error("Failed to delete job");
      return;
    }
    setJobs((prev) => prev.filter((j) => j.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast.success("Job deleted");
  };

  const handleTrigger = async (job: PiCronJob) => {
    const result = await API.POST<PiCronJob>({
      endpoint: `${basePath}/jobs/${job.id}/trigger`,
      body: {},
    });
    if ("code" in result) {
      toast.error("Failed to trigger job");
      return;
    }
    toast.success(`Triggered "${job.name}"`);
    fetchData();
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
          API={API}
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
