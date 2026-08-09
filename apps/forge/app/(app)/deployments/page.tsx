"use client";

import {
  formatBytes,
  formatDurationMs,
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
import { ExternalLink, RotateCw, ScrollText } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { api, errorMessage } from "@/lib/api";

export default function DeploymentsPage() {
  const fetchDeployments = useCallback(() => api.forge.deployments(100), []);
  const { data, error, reload } = usePoll(fetchDeployments, 30_000);
  const [restarting, setRestarting] = useState<Set<string>>(() => new Set());
  const restart = async (id: string) => {
    setRestarting((current) => new Set(current).add(id));
    try {
      await api.forge.restart(id);
      toast.success("Deployment restarted");
      await reload();
    } catch (restartError) {
      toast.error(errorMessage(restartError));
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="deployments"
        detail="latest 100 runs across every project"
      />
      {!data && !error ? <Skeleton className="h-64" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {data ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>project</TableHead>
              <TableHead>status</TableHead>
              <TableHead>commit</TableHead>
              <TableHead>host</TableHead>
              <TableHead className="text-right">image</TableHead>
              <TableHead className="text-right">build</TableHead>
              <TableHead>created</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((deployment) => (
              <TableRow key={deployment.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {deployment.projectSlug}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {deployment.targetName} · {deployment.kind}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={
                      deployment.status === "ready"
                        ? "text-emerald-600"
                        : deployment.status === "failed"
                          ? "text-destructive"
                          : "text-amber-600"
                    }
                  >
                    {deployment.status}
                  </span>
                  {deployment.phase ? (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {deployment.phase}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-56 flex-col">
                    <span className="font-mono text-xs">
                      {deployment.gitSha.slice(0, 7)}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {deployment.gitMessage ?? deployment.gitRef}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <a
                    className="inline-flex items-center gap-1 hover:underline"
                    href={`https://${deployment.hostname}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {deployment.hostname}
                    <ExternalLink className="size-3" />
                  </a>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {deployment.imageSizeBytes === null
                    ? "—"
                    : formatBytes(deployment.imageSizeBytes)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatDurationMs(deployment.buildDurationMs)}
                </TableCell>
                <TableCell>{formatRelative(deployment.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      asChild
                    >
                      <Link
                        href={`/logs?mode=build&id=${deployment.id}`}
                        aria-label="Build log"
                      >
                        <ScrollText className="size-3.5" />
                      </Link>
                    </Button>
                    {deployment.status === "ready" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={restarting.has(deployment.id)}
                        onClick={() => void restart(deployment.id)}
                        aria-label="Restart deployment"
                      >
                        <RotateCw
                          className={`size-3.5 ${restarting.has(deployment.id) ? "animate-spin" : ""}`}
                        />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
