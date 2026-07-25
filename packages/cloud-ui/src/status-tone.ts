import type { StatusTone } from "@repo/ui/status-dot";

export function healthTone(
  status: "ok" | "degraded" | "down" | "unknown",
): StatusTone {
  switch (status) {
    case "ok":
      return "good";
    case "degraded":
      return "warning";
    case "down":
      return "critical";
    default:
      return "muted";
  }
}

export function runTone(
  status: "pending" | "running" | "completed" | "failed",
): StatusTone {
  switch (status) {
    case "completed":
      return "good";
    case "failed":
      return "critical";
    case "running":
      return "warning";
    default:
      return "muted";
  }
}
