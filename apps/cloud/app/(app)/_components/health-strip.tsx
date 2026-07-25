"use client";

import { formatDurationMs } from "@repo/cloud-ui/format";
import { healthTone } from "@repo/cloud-ui/status-tone";
import type { OpsHealth } from "@repo/schemas/cloud";
import { StatusDot } from "@repo/ui/status-dot";

export function HealthStrip({ health }: { health: OpsHealth }) {
  const entries = Object.entries(health.checks) as [
    string,
    OpsHealth["checks"][keyof OpsHealth["checks"]],
  ][];
  // The aggregate goes down if any single component does, so on its own it
  // reads as "the whole cloud is down" when one optional service is simply not
  // running. Naming the culprits keeps the roll-up honest and glanceable.
  const failing = entries
    .filter(([, check]) => check.status !== "ok")
    .map(([name]) => name);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-2.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <StatusDot tone={healthTone(health.status)} label={health.status} />
        {health.status}
        {failing.length > 0 && (
          <span className="font-normal text-muted-foreground">
            {failing.join(" ")}
          </span>
        )}
      </span>
      {entries.map(([name, check]) => (
        <span
          key={name}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title={check.message ?? undefined}
        >
          <StatusDot tone={healthTone(check.status)} label={check.status} />
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
