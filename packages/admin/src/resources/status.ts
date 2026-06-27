import type { IResource } from "@repo/schemas";

export type ResourceStatus = "up" | "degraded" | "down" | "unknown";

export const RESOURCE_TYPE_LABELS: Record<IResource["type"], string> = {
  pi: "PI",
  vps: "VPS",
  api: "API",
  service: "SVC",
};

export function getResourceStatus(resource: IResource): ResourceStatus {
  const agent = resource.agentService;
  if (!agent.enabled || agent.lastStatus === null) return "unknown";
  if (agent.lastStatus === "unreachable") return "down";
  if (agent.lastStatus === "degraded") return "degraded";
  return "up";
}
