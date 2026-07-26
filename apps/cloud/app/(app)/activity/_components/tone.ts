import type { ActivitySeverity } from "@repo/schemas/cloud";
import type { StatusTone } from "@repo/ui/status-dot";

export function severityTone(severity: ActivitySeverity): StatusTone {
  switch (severity) {
    case "error":
      return "critical";
    case "warn":
      return "serious";
    default:
      return "muted";
  }
}

export function statusTone(status: number | null): StatusTone {
  if (status === null) return "muted";
  if (status >= 500) return "critical";
  if (status >= 400) return "serious";
  return "good";
}
