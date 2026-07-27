"use client";

import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";

type DayStatus = "operational" | "degraded" | "down" | "no-data";

interface ServiceHealth {
  healthy: boolean;
  responseTime: number | null;
}

interface StatusStats {
  currentStatus: {
    healthy: boolean;
    services: {
      database: ServiceHealth;
      storage: ServiceHealth;
      github: ServiceHealth;
    };
  } | null;
  uptime: number | null;
  errorRate: number | null;
  avgResponseTime: number | null;
  totalRequests24h: number;
  timeline: Array<{
    date: string;
    status: DayStatus;
    healthChecks: number;
    requests: number;
    errorRate: number;
  }>;
  errorsByCategory: Array<{
    category: string;
    count: number;
    errors: string[];
  }>;
  lastCheck: string | null;
}

const SERVICE_NAMES = {
  database: "Database",
  storage: "Storage (R2)",
  github: "GitHub API",
} as const;

export const ApiStatusComponent = () => {
  const [stats, setStats] = useState<StatusStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/status/stats");
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {
        // Silently fail - we'll show fallback UI
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: DayStatus) => {
    switch (status) {
      case "operational":
        return "bg-emerald-500";
      case "degraded":
        return "bg-yellow-500";
      case "down":
        return "bg-red-500";
      case "no-data":
        return "bg-muted-foreground/20";
    }
  };

  const getServiceStatusColor = (healthy: boolean | undefined) => {
    if (healthy === undefined) return "bg-muted-foreground/50";
    return healthy ? "bg-emerald-500" : "bg-red-500";
  };

  const currentStatus = stats?.currentStatus;
  const hasData = stats && stats.timeline.length > 0;
  const isHealthy = currentStatus?.healthy ?? null;

  return (
    <section className="w-full max-w-4xl mx-auto px-4 py-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-mono text-sm font-medium text-muted-foreground tracking-wider uppercase">
          System Status
        </h2>
        {loading ? (
          <Badge variant="secondary" className="gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 animate-pulse rounded-full bg-muted-foreground"></span>
            </span>
            Checking...
          </Badge>
        ) : isHealthy === true ? (
          <Badge className="gap-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            All Systems Operational
          </Badge>
        ) : isHealthy === false ? (
          <Badge variant="destructive" className="gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-300"></span>
            </span>
            Service Disruption
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground"></span>
            </span>
            No Data
          </Badge>
        )}
      </div>

      {/* Service Status Indicators */}
      {currentStatus && (
        <div className="flex flex-wrap gap-6 mb-10 justify-center">
          {(Object.entries(currentStatus.services) as [keyof typeof SERVICE_NAMES, ServiceHealth][]).map(
            ([key, service]) => (
              <div key={key} className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${getServiceStatusColor(service.healthy)}`}
                />
                <span className="text-sm text-muted-foreground">
                  {SERVICE_NAMES[key]}
                </span>
                {service.responseTime !== null && (
                  <span className="text-xs text-muted-foreground/60 font-mono">
                    {service.responseTime}ms
                  </span>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* Timeline */}
      {hasData && (
        <div className="mb-10">
          <div className="flex gap-[2px] h-8 items-end">
            {stats.timeline.map((day) => (
              <div key={day.date} className="group relative flex-1 min-w-0">
                <div
                  className={`w-full h-6 rounded-sm ${getStatusColor(day.status)} opacity-80 hover:opacity-100 transition-opacity cursor-default`}
                />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border border-border rounded-lg text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                  <div className="font-medium text-foreground mb-1">
                    {new Date(day.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  <div className="space-y-0.5 text-muted-foreground">
                    <div>
                      Status:{" "}
                      <span
                        className={
                          day.status === "operational"
                            ? "text-emerald-500"
                            : day.status === "degraded"
                              ? "text-yellow-500"
                              : day.status === "down"
                                ? "text-red-500"
                                : ""
                        }
                      >
                        {day.status === "no-data" ? "No data" : day.status}
                      </span>
                    </div>
                    {day.requests > 0 && (
                      <>
                        <div>Requests: {day.requests.toLocaleString()}</div>
                        <div>Error rate: {day.errorRate}%</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground font-mono">
            <span>90 days ago</span>
            <span>Today</span>
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="flex flex-wrap gap-8 justify-center text-center mb-10">
        <div>
          <div className="font-mono text-3xl font-bold text-foreground">
            {stats?.uptime != null ? `${stats.uptime}%` : "—"}
          </div>
          <div className="text-sm text-muted-foreground mt-1">Uptime (90d)</div>
        </div>
        <div className="w-px bg-border" />
        <div>
          <div
            className={`font-mono text-3xl font-bold ${
              stats?.errorRate != null && stats.errorRate > 5
                ? "text-red-500"
                : stats?.errorRate != null && stats.errorRate > 1
                  ? "text-yellow-500"
                  : "text-emerald-500"
            }`}
          >
            {stats?.errorRate != null ? `${stats.errorRate}%` : "—"}
          </div>
          <div className="text-sm text-muted-foreground mt-1">Error Rate (24h)</div>
        </div>
        <div className="w-px bg-border" />
        <div>
          <div className="font-mono text-3xl font-bold text-primary">
            {stats?.avgResponseTime != null ? `${stats.avgResponseTime}ms` : "—"}
          </div>
          <div className="text-sm text-muted-foreground mt-1">Avg Response</div>
        </div>
        <div className="w-px bg-border" />
        <div>
          <div className="font-mono text-3xl font-bold text-foreground">
            {stats?.totalRequests24h != null ? stats.totalRequests24h.toLocaleString() : "—"}
          </div>
          <div className="text-sm text-muted-foreground mt-1">Requests (24h)</div>
        </div>
      </div>

      {/* Error Insights */}
      {stats?.errorsByCategory && stats.errorsByCategory.length > 0 && (
        <div className="border-t border-border pt-6">
          <h3 className="font-mono text-xs font-medium text-muted-foreground tracking-wider uppercase mb-4">
            Recent Errors (24h)
          </h3>
          <div className="space-y-2">
            {stats.errorsByCategory.map((problem) => (
              <div
                key={problem.category}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground text-sm">
                  {problem.category}
                </span>
                <span className="text-red-500 font-mono">
                  {problem.count} error{problem.count !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Updated */}
      {stats?.lastCheck && (
        <div className="mt-6 text-center text-xs text-muted-foreground">
          Last health check:{" "}
          {new Date(stats.lastCheck).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}
    </section>
  );
};
