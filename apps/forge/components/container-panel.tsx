"use client";

import { DeploymentKindBadge } from "@repo/cloud-ui/deploy-status";
import { formatRelative } from "@repo/cloud-ui/format";
import type { ForgeContainer } from "@repo/schemas/cloud";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@repo/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { LogStream } from "./log-stream";
import { RequestTable } from "./request-table";

/**
 * Logs and requests for one container, opened from its row.
 *
 * This replaces the standalone logs page, where a flat `<select>` of every
 * container on the host was the only thing telling you whose output you were
 * reading. Attached to the row, that question cannot be got wrong.
 */
export function ContainerPanel({
  container,
  onOpenChange,
}: {
  container: ForgeContainer | null;
  onOpenChange: (open: boolean) => void;
}) {
  const containerId = container?.id ?? "";
  const subscribe = useCallback(
    (onLine: (line: string) => void, signal: AbortSignal) =>
      api.forge.streamLogs(containerId, onLine, signal),
    [containerId],
  );

  return (
    <Sheet open={container !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 sm:max-w-3xl"
      >
        {container ? (
          <>
            <SheetHeader className="gap-1">
              <SheetTitle className="flex flex-wrap items-baseline gap-2 text-sm">
                {container.projectSlug ?? container.name}
                {container.kind === "production" ||
                container.kind === "preview" ? (
                  <DeploymentKindBadge kind={container.kind} />
                ) : null}
              </SheetTitle>
              <p className="font-mono text-[11px] text-muted-foreground">
                {container.name} · {container.image} ·{" "}
                {formatRelative(container.createdAt)}
              </p>
            </SheetHeader>
            <Tabs
              defaultValue="logs"
              className="flex min-h-0 flex-1 flex-col gap-3"
            >
              <TabsList variant="line">
                <TabsTrigger value="logs">logs</TabsTrigger>
                <TabsTrigger
                  value="requests"
                  disabled={!container.deploymentId}
                >
                  requests
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="logs"
                className="flex min-h-0 flex-1 flex-col"
              >
                <LogStream subscribe={subscribe} resetKey={containerId} />
              </TabsContent>
              <TabsContent
                value="requests"
                className="flex min-h-0 flex-1 flex-col"
              >
                {container.deploymentId ? (
                  <RequestTable deploymentId={container.deploymentId} />
                ) : null}
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
