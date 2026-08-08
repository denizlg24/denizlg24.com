import type {
  DeployDomainStatus,
  DeploymentPhase,
  DeploymentStatus,
} from "@repo/schemas/cloud";
import type { StatusTone } from "@repo/ui/status-dot";

export function deploymentTone(status: DeploymentStatus): StatusTone {
  switch (status) {
    case "ready":
      return "good";
    case "building":
    case "deploying":
      return "warning";
    case "failed":
      return "critical";
    // An interrupted run is not a build failure — the agent stopped reporting —
    // so it reads as serious rather than red alongside a genuine failure.
    case "interrupted":
      return "serious";
    default:
      return "muted";
  }
}

export function domainTone(status: DeployDomainStatus): StatusTone {
  switch (status) {
    case "active":
      return "good";
    case "verifying":
      return "warning";
    case "failed":
      return "critical";
    default:
      return "muted";
  }
}

/**
 * `building` is four minutes long, so the phase is what moves. Showing the
 * status alone leaves a label that never changes, which reads as a hang.
 */
export function deploymentLabel(
  status: DeploymentStatus,
  phase: DeploymentPhase | null,
): string {
  if ((status === "building" || status === "deploying") && phase) return phase;
  return status;
}

export function isDeploymentLive(status: DeploymentStatus): boolean {
  return status === "queued" || status === "building" || status === "deploying";
}

/**
 * A run that stopped without shipping. `superseded` is excluded: it did not
 * fail, it lost to a newer commit, and retrying it deliberately deploys code
 * that something already replaced.
 */
export function isDeploymentRetryable(status: DeploymentStatus): boolean {
  return (
    status === "failed" || status === "cancelled" || status === "interrupted"
  );
}
