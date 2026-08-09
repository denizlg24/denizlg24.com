"use client";

import {
  formatBytes,
  formatPercent,
  formatRelative,
} from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { RotateCw, ScrollText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { api, errorMessage } from "@/lib/api";

export default function ContainersPage() {
  const { data, error, reload } = usePoll(api.forge.overview, 15_000);
  const [restarting, setRestarting] = useState<Set<string>>(() => new Set());
  const containers = data?.agent?.containers ?? [];

  const restart = async (deploymentId: string) => {
    setRestarting((current) => new Set(current).add(deploymentId));
    try {
      await api.forge.restart(deploymentId);
      toast.success("Container restarted");
      await reload();
    } catch (restartError) {
      toast.error(errorMessage(restartError));
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
        next.delete(deploymentId);
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="containers"
        detail="live Docker state; Forge-labelled workloads only"
      />
      {!data && !error ? <Skeleton className="h-64" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {data ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>container</TableHead>
              <TableHead>state</TableHead>
              <TableHead className="text-right">cpu</TableHead>
              <TableHead className="text-right">memory</TableHead>
              <TableHead className="text-right">network rx / tx</TableHead>
              <TableHead className="text-right">block r / w</TableHead>
              <TableHead className="text-right">pids</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {containers.map((container) => (
              <TableRow key={container.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {container.projectSlug ?? container.name}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {container.image} · {formatRelative(container.createdAt)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={
                      container.state === "running"
                        ? "text-emerald-600"
                        : "text-destructive"
                    }
                  >
                    {container.state}
                  </span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {container.health ?? container.kind}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatPercent(container.metrics?.cpuPercent)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatPercent(container.metrics?.memoryPercent)}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {container.metrics
                      ? formatBytes(container.metrics.memoryBytes)
                      : ""}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {container.metrics
                    ? `${formatBytes(container.metrics.networkRxBytes)} / ${formatBytes(container.metrics.networkTxBytes)}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {container.metrics
                    ? `${formatBytes(container.metrics.blockReadBytes)} / ${formatBytes(container.metrics.blockWriteBytes)}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {container.metrics?.pids ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {container.deploymentId ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        asChild
                      >
                        <Link
                          href={`/logs?mode=runtime&id=${encodeURIComponent(container.id)}`}
                          aria-label={`Logs for ${container.name}`}
                        >
                          <ScrollText className="size-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                    {container.deploymentId ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={restarting.has(container.deploymentId)}
                        onClick={() => void restart(container.deploymentId!)}
                        aria-label={`Restart ${container.name}`}
                      >
                        <RotateCw
                          className={`size-3.5 ${restarting.has(container.deploymentId) ? "animate-spin" : ""}`}
                        />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {containers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  no Forge containers
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
