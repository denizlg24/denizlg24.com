"use client";

import { formatDurationSeconds, formatRelative } from "@repo/cloud-ui/format";
import type { ForgeOverview } from "@repo/schemas/cloud";
import { StatusDot } from "@repo/ui/status-dot";

/**
 * Who this machine is, and whether anything is still talking to it.
 *
 * Separate from the utilization tiles on purpose: those go blank when the agent
 * stops answering, and a blank page is the least informative rendering of the
 * one state worth alerting on. The identity here is whatever was last known,
 * and the status line is read from this poll — so an unreachable box still says
 * which box it was and when it was last seen.
 */

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="truncate font-mono text-xs" title={value}>
        {value}
      </div>
    </div>
  );
}

export function MachinePanel({ overview }: { overview: ForgeOverview }) {
  const agent = overview.agent;
  const system = agent?.host.system ?? null;
  const reachable = agent !== null;

  return (
    <section className="flex flex-col gap-3 border-b pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-center gap-2">
          <StatusDot
            tone={reachable ? "good" : "critical"}
            label={reachable ? "reachable" : "unreachable"}
          />
          <span className="font-mono text-sm">
            {system?.hostname ?? "forge"}
          </span>
          <span className="text-xs text-muted-foreground">
            {reachable ? "reachable" : "unreachable"}
          </span>
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          seen {formatRelative(overview.timestamp)}
        </span>
      </div>

      {overview.errors.agent ? (
        <p className="font-mono text-xs text-destructive">
          {overview.errors.agent}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="model" value={system?.model ?? "—"} />
        <Field
          label="cpu"
          value={
            system?.cpuModel ?? (agent ? `${agent.host.cpu.cores} cores` : "—")
          }
        />
        <Field label="os" value={system?.osRelease ?? "—"} />
        <Field label="kernel" value={system?.kernel ?? "—"} />
        <Field
          label="booted"
          value={system?.bootedAt ? formatRelative(system.bootedAt) : "—"}
        />
        <Field
          label="agent"
          value={
            agent
              ? `${agent.health.version} · up ${formatDurationSeconds(agent.health.uptimeSeconds)}`
              : "—"
          }
        />
      </div>
    </section>
  );
}
