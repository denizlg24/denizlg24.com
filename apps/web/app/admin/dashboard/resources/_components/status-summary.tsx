"use client";

import { Badge } from "@/components/ui/badge";
import type { LeanResource } from "./resources-manager";

function getResourceStatus(
  resource: LeanResource,
): "up" | "degraded" | "down" | "unknown" {
  const agent = resource.agentService;
  if (!agent.enabled || agent.lastStatus === null) return "unknown";
  if (agent.lastStatus === "unreachable") return "down";
  if (agent.lastStatus === "degraded") return "degraded";
  return "up";
}

interface StatusSummaryProps {
  resources: LeanResource[];
}

export function StatusSummary({ resources }: StatusSummaryProps) {
  const counts = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const r of resources) {
    counts[getResourceStatus(r)]++;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {counts.down > 0 && (
        <Badge variant="destructive" className="text-xs">
          {counts.down} Down
        </Badge>
      )}
      {counts.degraded > 0 && (
        <Badge className="text-xs bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/15">
          {counts.degraded} Degraded
        </Badge>
      )}
      {counts.up > 0 && (
        <Badge className="text-xs bg-accent/15 text-accent-strong border-accent/30 hover:bg-accent/15">
          {counts.up} Operational
        </Badge>
      )}
      {counts.unknown > 0 && (
        <Badge variant="secondary" className="text-xs">
          {counts.unknown} Unknown
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">
        {resources.length} total
      </span>
    </div>
  );
}
