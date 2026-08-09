import type {
  DeployDomainStatus,
  DeploymentKind,
  DeploymentPhase,
  DeploymentStatus,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";

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

/**
 * `ready` means serving, not merely "built successfully": going ready calls
 * `supersedeOlderDeployments`, which retires every other row for the same
 * target and kind — the previously ready one included. So at most one `ready`
 * deployment exists per target and kind, and it is the one behind the
 * hostname. Anything that stops being true of that invariant makes this badge
 * a lie, not just imprecise.
 */
export function isDeploymentCurrent(status: DeploymentStatus): boolean {
  return status === "ready";
}

const BADGE = "h-5 gap-1 rounded-full px-2 py-0 text-[10px] font-normal";

/**
 * Production carries the weight because it is the one that costs something to
 * get wrong; preview stays quiet so a list of them does not read as a list of
 * warnings.
 */
export function DeploymentKindBadge({
  kind,
  className,
}: {
  kind: DeploymentKind;
  className?: string;
}) {
  return (
    <Badge
      variant={kind === "production" ? "secondary" : "outline"}
      className={cn(
        BADGE,
        kind === "production" ? "font-medium" : "text-muted-foreground",
        className,
      )}
    >
      {kind}
    </Badge>
  );
}

/** The deployment currently behind the hostname. */
export function DeploymentCurrentBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn(BADGE, className)}>
      <StatusDot tone="good" className="size-1.5" />
      current
    </Badge>
  );
}

/**
 * The pair, in the order they are read: what this deployment is for, then
 * whether it is the one live right now.
 */
export function DeploymentBadges({
  kind,
  status,
  className,
}: {
  kind: DeploymentKind;
  status: DeploymentStatus;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <DeploymentKindBadge kind={kind} />
      {isDeploymentCurrent(status) ? <DeploymentCurrentBadge /> : null}
    </span>
  );
}
