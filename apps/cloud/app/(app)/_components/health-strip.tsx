"use client";

import type { OpsHealth } from "@repo/schemas/cloud";
import { healthTone, StatusDot } from "@/components/status-dot";
import { formatDurationMs } from "@/lib/format";

export function HealthStrip({ health }: { health: OpsHealth }) {
  const entries = Object.entries(health.checks) as [
    string,
    OpsHealth["checks"][keyof OpsHealth["checks"]],
  ][];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-2.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <StatusDot tone={healthTone(health.status)} />
        {health.status}
      </span>
      {entries.map(([name, check]) => (
        <span
          key={name}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title={check.message ?? undefined}
        >
          <StatusDot tone={healthTone(check.status)} />
          {name}
          {check.latencyMs !== null && (
            <span className="tabular-nums opacity-70">
              {formatDurationMs(check.latencyMs)}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
