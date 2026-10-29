"use client";

import {
  type ICapability,
  PICRON_HTTP_METHODS,
  type PiCronJob,
  type PiCronStats,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListGroupLabel } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Stat, StatGroup } from "@repo/ui/stat";
import { SearchField } from "@repo/ui/toolbar";
import { Clock, Plus } from "lucide-react";
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
  const method = job.method.toUpperCase();
  return {
    name: job.name,
    expression: job.expression,
    url: job.url,
    method: PICRON_HTTP_METHODS.find((m) => m === method) ?? "GET",
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

  const handleDeleteJob = async (target: PiCronJob) => {
    try {
      await client.del(`${basePath}/jobs/${target.id}`);
      setJobs((prev) => prev.filter((j) => j.id !== target.id));
      toast.success("Job deleted");
      refreshStats();
    } catch {
      toast.error("Failed to delete job");
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
    <Section
      title={capability.label}
      count={jobs.length > 0 ? jobs.length : undefined}
      actions={
        <>
          {refreshing && <Spinner className="size-3 text-muted-foreground" />}
          {jobs.length > 5 && (
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Filter jobs"
              className="w-48"
            />
          )}
          <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Job
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <>
          {stats && (
            <StatGroup>
              <Stat label="Jobs" value={stats.total_jobs} />
              <Stat label="Active" value={stats.active_jobs} />
              <Stat label="Runs" value={stats.total_executions} />
              <Stat
                label="Fails 24h"
                value={stats.failed_executions_24h}
                tone={stats.failed_executions_24h > 0 ? "critical" : "default"}
              />
            </StatGroup>
          )}

          {jobs.length === 0 ? (
            <EmptyState compact icon={<Clock />} label="No jobs" />
          ) : filteredJobs.length === 0 ? (
            <EmptyState compact label="0 results" />
          ) : hostGroups.length === 1 ? (
            <List>{hostGroups[0]?.[1].map(renderRow)}</List>
          ) : (
            <List>
              {hostGroups.map(([host, hostJobs]) => (
                <div key={host} className="flex flex-col">
                  <ListGroupLabel>
                    <span className="font-mono normal-case">{host}</span>
                    <span className="ml-1.5 tabular-nums">
                      {hostJobs.length}
                    </span>
                  </ListGroupLabel>
                  {hostJobs.map(renderRow)}
                </div>
              ))}
            </List>
          )}
        </>
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
          key={historyJob.id}
          onOpenChange={(o) => !o && setHistoryJob(null)}
          jobId={historyJob.id}
          jobName={historyJob.name}
          resourceId={resourceId}
          capId={capability._id}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "job"}?`}
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDeleteJob(deleteTarget);
        }}
      />
    </Section>
  );
}
