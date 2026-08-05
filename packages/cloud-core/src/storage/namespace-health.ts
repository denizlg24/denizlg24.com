export interface NamespaceHealthInput {
  dirty: boolean;
  dirtySince: Date | null;
  lastCompleteAt: Date | null;
  lastCompleteGeneration: number | null;
  unrepairedProblems: number;
  reapCandidates: number;
  watcherOverflows: number;
  /** Whether every configured branch marker validated on the last check. */
  branchesValid: boolean;
  namespaceMounted: boolean;
  metadataServiceReachable: boolean;
  now?: Date;
}

export type NamespaceHealthStatus = "ok" | "degraded" | "critical";

export interface NamespaceHealth {
  status: NamespaceHealthStatus;
  reasons: string[];
  dirtyAgeSeconds: number | null;
  lastCompleteAgeSeconds: number | null;
}

/** Beyond this, a dirty projection has stopped being lag and become drift. */
const DIRTY_BUDGET_SECONDS = 15 * 60;
const SCAN_STALE_SECONDS = 24 * 60 * 60;

function ageSeconds(from: Date | null, now: Date): number | null {
  return from
    ? Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000))
    : null;
}

/**
 * Collapses projection state into one status.
 *
 * A partial namespace is `critical` rather than `degraded`, per the plan: the
 * distinction is whether the system is serving a *wrong* view or merely a
 * *stale* one, and a missing branch means entries are absent from listings
 * while their bytes still exist.
 */
export function namespaceHealth(input: NamespaceHealthInput): NamespaceHealth {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  let status: NamespaceHealthStatus = "ok";

  const escalate = (next: NamespaceHealthStatus, reason: string) => {
    reasons.push(reason);
    if (next === "critical" || status === "ok") status = next;
    if (next === "critical") status = "critical";
  };

  if (!input.namespaceMounted) {
    escalate("critical", "namespace-not-mounted");
  }
  if (!input.branchesValid) {
    escalate("critical", "branch-marker-invalid");
  }
  if (!input.metadataServiceReachable) {
    escalate("critical", "metadata-service-unreachable");
  }

  const dirtyAgeSeconds = ageSeconds(input.dirtySince, now);
  if (input.dirty) {
    if (dirtyAgeSeconds !== null && dirtyAgeSeconds > DIRTY_BUDGET_SECONDS) {
      escalate("critical", "projection-dirty-beyond-sla");
    } else {
      escalate("degraded", "projection-dirty");
    }
  }

  if (input.lastCompleteGeneration === null) {
    escalate("degraded", "no-complete-scan-yet");
  }
  const lastCompleteAgeSeconds = ageSeconds(input.lastCompleteAt, now);
  if (
    lastCompleteAgeSeconds !== null &&
    lastCompleteAgeSeconds > SCAN_STALE_SECONDS
  ) {
    escalate("degraded", "last-complete-scan-stale");
  }

  if (input.unrepairedProblems > 0) {
    escalate("degraded", "unrepaired-projection-errors");
  }
  if (input.watcherOverflows > 0) {
    escalate("degraded", "watcher-overflow");
  }
  // Pending reaps are reported but never escalate on their own: they are a
  // queue awaiting evidence, not a fault.
  return { dirtyAgeSeconds, lastCompleteAgeSeconds, reasons, status };
}
