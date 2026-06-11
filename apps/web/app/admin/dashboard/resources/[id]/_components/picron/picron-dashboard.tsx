"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PiCronJob, PiCronStats } from "@/lib/picron";
import { JobFormDialog } from "./job-form-dialog";
import { PiCronJobCard } from "./picron-job-card";

interface PiCronDashboardProps {
  resourceId: string;
  capId: string;
  name: string;
  baseUrl: string;
}

export function PiCronDashboard({
  resourceId,
  capId,
  name,
  baseUrl,
}: PiCronDashboardProps) {
  const [jobs, setJobs] = useState<PiCronJob[]>([]);
  const [stats, setStats] = useState<PiCronStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const apiBase = `/api/admin/resources/${resourceId}/capabilities/${capId}/picron`;

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const [jobsRes, statsRes] = await Promise.all([
          fetch(`${apiBase}/jobs`, { cache: "no-store" }),
          fetch(`${apiBase}/stats`, { cache: "no-store" }),
        ]);

        if (!jobsRes.ok) {
          const d = await jobsRes.json();
          throw new Error(d.error ?? "Failed to load jobs");
        }

        const jobsData = await jobsRes.json();
        setJobs(Array.isArray(jobsData) ? jobsData : []);

        if (statsRes.ok) {
          setStats((await statsRes.json()) as PiCronStats);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => load(true);

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard label="Total Jobs" value={stats.total_jobs} />
          <StatCard label="Active" value={stats.active_jobs} />
          <StatCard label="Total Runs" value={stats.total_executions} />
          <StatCard
            label="Failed (24h)"
            value={stats.failed_executions_24h}
            alert={stats.failed_executions_24h > 0}
          />
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add Job
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-8 space-y-3">
          <p className="text-sm text-destructive font-medium">
            Failed to connect to PiCron
          </p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm font-medium mb-1">No jobs yet</p>
          <p className="text-xs mb-3">Schedule your first HTTP request.</p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Job
          </Button>
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <PiCronJobCard
              key={job.id}
              resourceId={resourceId}
              capId={capId}
              job={job}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}

      <JobFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        resourceId={resourceId}
        capId={capId}
        onSuccess={refresh}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="border rounded-md p-3 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-xl font-semibold tabular-nums ${alert ? "text-destructive" : ""}`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}
