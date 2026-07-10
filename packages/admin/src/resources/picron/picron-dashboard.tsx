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
import { Input } from "@repo/ui/input";
import { Loader2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import { type JobFormData, JobFormDialog } from "./job-form-dialog";
import { JobHistoryDialog } from "./job-history-dialog";
import { PiCronJobRow } from "./picron-job-row";

function jobHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "other";
  }
}

function jobToFormData(job: PiCronJob): JobFormData {
  return {
    name: job.name,
    expression: job.expression,
    url: job.url,
    method: job.method,
    headers: job.headers,
    body: job.body || undefined,
    timeout: job.timeout,
    enabled: job.enabled,
  };
}

function sortJobs(jobs: PiCronJob[]): PiCronJob[] {
  return [...jobs].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<PiCronJob | null>(
    null,
  );
  const [editingJob, setEditingJob] = useState<PiCronJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PiCronJob | null>(null);
  const [historyJob, setHistoryJob] = useState<PiCronJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  const basePath = `resources/${resourceId}/capabilities/${capability._id}/picron`;

  const fetchData = useCallback(
    (opts?: { silent?: boolean }) => {
      if (opts?.silent) setRefreshing(true);
      else setLoading(true);
      Promise.all([
        client.get<PiCronJob[]>(`${basePath}/jobs`).catch(() => null),
        client.get<PiCronStats>(`${basePath}/stats`).catch(() => null),
      ])
        .then(([jobsRes, statsRes]) => {
          if (jobsRes) setJobs(jobsRes);
          if (statsRes) setStats(statsRes);
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [client, basePath],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refreshStats = useCallback(() => {
    client
      .get<PiCronStats>(`${basePath}/stats`)
      .then(setStats)
      .catch(() => {});
  }, [client, basePath]);

  const handleCreateJob = async (data: JobFormData) => {
    try {
      const result = await client.post<PiCronJob>(`${basePath}/jobs`, data);
      setJobs((prev) => [...prev, result]);
      setCreateOpen(false);
      setDuplicateSource(null);
      toast.success("Job created");
      refreshStats();
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
      refreshStats();
    } catch {
      toast.error("Failed to update job");
    }
  };

  const handleToggleEnabled = async (job: PiCronJob) => {
    const enabled = !job.enabled;
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, enabled } : j)),
    );
    try {
      const result = await client.put<PiCronJob>(`${basePath}/jobs/${job.id}`, {
        ...jobToFormData(job),
        enabled,
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? result : j)));
      refreshStats();
    } catch {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      toast.error(enabled ? "Failed to resume job" : "Failed to pause job");
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
      refreshStats();
    } catch {
      toast.error("Failed to delete job");
    } finally {
      setDeleting(false);
    }
  };

  const handleTrigger = async (job: PiCronJob) => {
    try {
      await client.post(`${basePath}/jobs/${job.id}/trigger`, {});
      toast.success(`Triggered "${job.name}"`);
      fetchData({ silent: true });
    } catch {
      toast.error("Failed to trigger job");
    }
  };

  const urlSuggestions = useMemo(
    () => [...new Set(jobs.map((job) => job.url))].sort(),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (job) =>
        job.name.toLowerCase().includes(q) ||
        job.url.toLowerCase().includes(q) ||
        job.expression.includes(q),
    );
  }, [jobs, query]);

  const hostGroups = useMemo(() => {
    const map = new Map<string, PiCronJob[]>();
    for (const job of sortJobs(filteredJobs)) {
      const host = jobHost(job.url);
      const group = map.get(host);
      if (group) group.push(job);
      else map.set(host, [job]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredJobs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderRow = (job: PiCronJob) => (
    <PiCronJobRow
      key={job.id}
      job={job}
      onEdit={() => setEditingJob(job)}
      onDuplicate={() => setDuplicateSource(job)}
      onToggleEnabled={() => handleToggleEnabled(job)}
      onDelete={() => setDeleteTarget(job)}
      onTrigger={() => handleTrigger(job)}
      onHistory={() => setHistoryJob(job)}
    />
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium flex items-center gap-2">
          Cron Jobs
          {refreshing && (
            <Loader2 className="size-3 animate-spin text-muted-foreground/40" />
          )}
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

      {jobs.length > 5 && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, URL, or schedule…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 text-center py-8">
          No cron jobs configured
        </p>
      ) : filteredJobs.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 text-center py-8">
          No jobs match &quot;{query}&quot;
        </p>
      ) : hostGroups.length === 1 ? (
        <div className="flex flex-col gap-0.5">
          {hostGroups[0]?.[1].map(renderRow)}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {hostGroups.map(([host, hostJobs]) => (
            <div key={host}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 px-3 mb-1">
                {host}
                <span className="ml-1.5 normal-case">· {hostJobs.length}</span>
              </p>
              <div className="flex flex-col gap-0.5">
                {hostJobs.map(renderRow)}
              </div>
            </div>
          ))}
        </div>
      )}

      <JobFormDialog
        open={createOpen || !!duplicateSource}
        key={duplicateSource?.id ?? "createDialog"}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setDuplicateSource(null);
          }
        }}
        onSubmit={handleCreateJob}
        template={duplicateSource}
        urlSuggestions={urlSuggestions}
      />

      <JobFormDialog
        open={!!editingJob}
        key={editingJob?.id ?? "editDialog"}
        onOpenChange={(o) => !o && setEditingJob(null)}
        onSubmit={handleUpdateJob}
        editingJob={editingJob}
        urlSuggestions={urlSuggestions}
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
