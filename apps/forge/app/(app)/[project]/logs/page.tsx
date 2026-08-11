"use client";

import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useState } from "react";
import { ContainerSelect } from "@/components/container-select";
import { LogStream } from "@/components/log-stream";
import { useProjectContainers } from "@/components/project-containers";
import { useTarget } from "@/components/target-context";
import { api } from "@/lib/api";

/**
 * Runtime output for one of the project's containers.
 *
 * Scoped by the route, so unlike the old host-wide logs page there is never a
 * question of whose output this is — the picker only offers containers this
 * project owns, and it defaults to the one serving production.
 */
export default function ProjectLogsPage() {
  const { target } = useTarget();
  const { containers, live, loading } = useProjectContainers(
    target.projectSlug,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const containerId = selected ?? live?.id ?? "";

  const subscribe = useCallback(
    (onLine: (line: string) => void, signal: AbortSignal) =>
      api.forge.streamLogs(containerId, onLine, signal),
    [containerId],
  );

  if (loading && containers.length === 0) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="flex min-h-96 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <h2 className="text-sm font-semibold">logs</h2>
        <ContainerSelect
          containers={containers}
          selected={containerId || null}
          onSelect={setSelected}
        />
      </div>

      {containerId ? (
        <LogStream
          subscribe={subscribe}
          resetKey={containerId}
          emptyLabel="waiting for output…"
        />
      ) : (
        <p className="text-xs text-muted-foreground">—</p>
      )}
    </div>
  );
}
