"use client";

import {
  type EnvoyDayStatus,
  type EnvoyStatusStats,
  envoyStatusStatsSchema,
} from "@repo/schemas/envoy";
import { Badge } from "@repo/ui/badge";
import { Activity, Database, GitFork, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";

const SERVICE_META = {
  database: { label: "PostgreSQL", icon: Database },
  storage: { label: "Deniz Cloud S3", icon: HardDrive },
  github: { label: "GitHub OAuth", icon: GitFork },
} as const;

const DAY_TONE: Record<EnvoyDayStatus, string> = {
  operational: "bg-status-good",
  degraded: "bg-status-warning",
  down: "bg-status-critical",
  "no-data": "bg-muted",
};

export function ApiStatusComponent() {
  const [stats, setStats] = useState<EnvoyStatusStats>();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/status/stats");
        if (!response.ok) return;
        const parsed = envoyStatusStatsSchema.safeParse(await response.json());
        if (active && parsed.success) setStats(parsed.data);
      } catch {
        // Status is supplemental; the rest of the page remains fully usable.
      } finally {
        if (active) setSettled(true);
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const healthy = stats?.currentStatus?.healthy;
  const timeline = stats?.timeline.slice(-45) ?? [];

  return (
    <section
      id="status"
      className="mx-auto w-full max-w-7xl border-x border-t bg-surface/45 px-6 py-20 sm:px-10 lg:px-16"
    >
      <div className="flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            live infrastructure
          </p>
          <h2 className="mt-3 font-calistoga text-3xl text-foreground sm:text-4xl">
            Service status
          </h2>
        </div>
        {!settled ? (
          <Badge variant="outline" className="gap-2 bg-background">
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
            Checking
          </Badge>
        ) : healthy === true ? (
          <Badge variant="outline" className="gap-2 bg-background">
            <span className="size-1.5 rounded-full bg-status-good" />
            All systems operational
          </Badge>
        ) : healthy === false ? (
          <Badge variant="outline" className="gap-2 bg-background">
            <span className="size-1.5 rounded-full bg-status-critical" />
            Service disruption
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-2 bg-background">
            <span className="size-1.5 rounded-full bg-muted" />
            No recent data
          </Badge>
        )}
      </div>

      <div className="grid border-b md:grid-cols-3">
        {(
          Object.entries(SERVICE_META) as [
            keyof typeof SERVICE_META,
            (typeof SERVICE_META)[keyof typeof SERVICE_META],
          ][]
        ).map(([key, { icon: Icon, label }]) => {
          const service = stats?.currentStatus?.services[key];
          return (
            <div
              key={key}
              className="flex items-center gap-3 border-b py-5 md:border-r md:border-b-0 md:px-5 md:first:pl-0 md:last:border-r-0"
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {label}
              </span>
              <span
                className={`ml-auto size-1.5 rounded-full ${
                  service
                    ? service.healthy
                      ? "bg-status-good"
                      : "bg-status-critical"
                    : "bg-muted"
                }`}
              />
              <span className="w-12 text-right font-mono text-[11px] text-muted-foreground">
                {service?.responseTime == null
                  ? "—"
                  : `${service.responseTime}ms`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-mono uppercase tracking-[0.16em]">
              recent availability
            </span>
            <span>
              {timeline.length ? `${timeline.length} days` : "No data"}
            </span>
          </div>
          <div className="flex h-9 gap-1">
            {timeline.length ? (
              timeline.map((day) => (
                <span
                  key={day.date}
                  className={`min-w-1 flex-1 rounded-sm ${DAY_TONE[day.status]}`}
                  title={`${day.date}: ${day.status}`}
                />
              ))
            ) : (
              <div className="w-full rounded-sm bg-muted/70" />
            )}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-8 sm:gap-12">
          <div>
            <dt className="text-xs text-muted-foreground">90d uptime</dt>
            <dd className="mt-1 font-mono text-xl text-foreground">
              {stats?.uptime == null ? "—" : `${stats.uptime}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">24h requests</dt>
            <dd className="mt-1 font-mono text-xl text-foreground">
              {stats?.totalRequests24h?.toLocaleString() ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Avg response</dt>
            <dd className="mt-1 flex items-center gap-2 font-mono text-xl text-foreground">
              <Activity className="size-4 text-accent-strong dark:text-accent" />
              {stats?.avgResponseTime == null
                ? "—"
                : `${stats.avgResponseTime}ms`}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
