"use client";

import type { DeployTargetListEntry } from "@repo/schemas/cloud";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback } from "react";
import { Unreachable } from "../unreachable";
import { usePoll } from "../use-poll";
import { deployApi } from "./api";
import { TargetCard } from "./target-card";

/**
 * Polls while anything is mid-build. A deploy takes minutes and the status is
 * the reason the page is open, so the list refreshes itself rather than making
 * someone reload to find out.
 */
const POLL_MS = 5_000;

export function TargetGrid({
  projectId,
  targetHref,
  emptyLabel = "—",
}: {
  /** Narrows to one project; omitted, every target on the box. */
  projectId?: string;
  targetHref: (target: DeployTargetListEntry) => string;
  emptyLabel?: string;
}) {
  const fetchTargets = useCallback(() => deployApi.targets(), []);
  const { data, error, unreachable, loading, reload } = usePoll(
    fetchTargets,
    POLL_MS,
  );

  if (unreachable) {
    return <Unreachable retrying={loading} onRetry={() => void reload()} />;
  }
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  const targets: DeployTargetListEntry[] = projectId
    ? data.filter((target) => target.projectId === projectId)
    : data;

  if (targets.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {targets.map((target) => (
        <TargetCard key={target.id} target={target} href={targetHref(target)} />
      ))}
    </div>
  );
}
