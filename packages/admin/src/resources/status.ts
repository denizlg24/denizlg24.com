import type { IResource } from "@repo/schemas";
import type { StatusTone } from "@repo/ui/status-dot";

export type ResourceStatus = "up" | "degraded" | "down" | "unknown";

export const RESOURCE_TYPE_LABELS: Record<IResource["type"], string> = {
  pi: "PI",
  vps: "VPS",
  api: "API",
  service: "SVC",
};

export const RESOURCE_STATUS_TONE: Record<ResourceStatus, StatusTone> = {
  up: "good",
  degraded: "warning",
  down: "critical",
  unknown: "muted",
};

export function getResourceStatus(resource: IResource): ResourceStatus {
  const agent = resource.agentService;
  if (!agent.enabled || agent.lastStatus === null) return "unknown";
  if (agent.lastStatus === "unreachable") return "down";
  if (agent.lastStatus === "degraded") return "degraded";
  return "up";
}

/** Tone for a usage percentage: ≥90 critical, ≥70 warning. */
export function usagePercentTone(
  percent: number | null | undefined,
): "default" | "muted" | "warning" | "critical" {
  if (percent == null) return "muted";
  if (percent > 90) return "critical";
  if (percent > 70) return "warning";
  return "default";
}
