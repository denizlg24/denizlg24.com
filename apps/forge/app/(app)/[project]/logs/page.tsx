"use client";

import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback, useState } from "react";
import { ContainerSelect } from "@/components/container-select";
import { LogStream } from "@/components/log-stream";
import { useProjectContainers } from "@/components/project-containers";
import { RequestExplorer } from "@/components/request-explorer";
import { useTarget } from "@/components/target-context";
import { api } from "@/lib/api";

/**
 * What the project served, and what it printed.
 *
 * Two tabs rather than one merged stream, because the two are genuinely
 * different objects: a request is a row Caddy wrote about traffic that reached
 * the container, and a log line is something the process printed for its own
 * reasons — a boot message, a cron tick, a warning with no request behind it at
 * all. Selecting a request is where they meet: Caddy stamps `X-Request-Id` on
 * the way in, so an app that logs it can have its output for that one request
 * pulled out exactly.
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
  const container =
    containers.find((entry) => entry.id === selected) ?? live ?? null;
  const containerId = container?.id ?? "";

  const subscribe = useCallback(
    (onLine: (line: string) => void, signal: AbortSignal) =>
      api.forge.streamLogs(containerId, onLine, signal),
    [containerId],
  );

  if (loading && containers.length === 0) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <Tabs
      defaultValue="requests"
      className="flex min-h-[36rem] flex-1 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <TabsList variant="line">
          <TabsTrigger value="requests">requests</TabsTrigger>
          <TabsTrigger value="logs">logs</TabsTrigger>
        </TabsList>
        <ContainerSelect
          containers={containers}
          selected={containerId || null}
          onSelect={setSelected}
        />
      </div>

      <TabsContent value="requests" className="flex min-h-0 flex-1 flex-col">
        {/* Requests are keyed by deployment, not container: the access log
            outlives the container, so recreating one on an env change keeps
            the traffic history the new container inherits. */}
        {container?.deploymentId ? (
          <RequestExplorer deploymentId={container.deploymentId} />
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </TabsContent>

      <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col">
        {containerId ? (
          <LogStream
            subscribe={subscribe}
            resetKey={containerId}
            emptyLabel="waiting for output…"
          />
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
