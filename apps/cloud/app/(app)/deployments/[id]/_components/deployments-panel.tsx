"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { Deployment, DeployTarget } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { ArrowUpRight, ScrollText } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  deploymentLabel,
  deploymentTone,
  isDeploymentLive,
} from "@/components/deploy/status";
import { api, errorMessage } from "@/lib/api";
import { LogSheet } from "./log-sheet";

const POLL_MS = 5_000;

export function DeploymentsPanel({
  target,
  refreshToken,
}: {
  target: DeployTarget;
  /** Bumped by the parent after a deploy, so the list reflects it at once. */
  refreshToken: number;
}) {
  const fetchDeployments = useCallback(
    () => api.deploy.deployments(target.id, { limit: 25 }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is the signal
    [target.id, refreshToken],
  );
  const { data, error, loading, reload } = usePoll(fetchDeployments, POLL_MS);
  const [logsFor, setLogsFor] = useState<Deployment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = useCallback(
    async (id: string, label: string, run: () => Promise<unknown>) => {
      setBusyId(id);
      try {
        await run();
        toast.success(label);
        await reload();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-48 w-full" />;

  const rows = data?.items ?? [];
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">—</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead>Commit</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const busy = busyId === row.id;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs">
                      <StatusDot
                        tone={deploymentTone(row.status)}
                        label={row.status}
                      />
                      {deploymentLabel(row.status, row.phase)}
                    </span>
                    {row.error && (
                      <p className="mt-1 max-w-md truncate text-xs text-destructive">
                        {row.error}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{row.gitRef}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.gitSha.slice(0, 7)}
                  </TableCell>
                  <TableCell className="text-xs">{row.kind}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatRelative(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      {row.status === "ready" && (
                        <Button asChild variant="ghost" size="sm">
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            <ArrowUpRight className="size-3" />
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLogsFor(row)}
                      >
                        <ScrollText className="size-3" />
                      </Button>
                      {isDeploymentLive(row.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void act(row.id, "Cancelled", () =>
                              api.deploy.cancel(row.id),
                            )
                          }
                        >
                          Cancel
                        </Button>
                      )}
                      {row.status === "ready" && row.kind === "preview" && (
                        // Promote does not rebuild — the image is already live
                        // and healthy, so this only changes which names route.
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void act(row.id, "Promoted", async () => {
                              const result = await api.deploy.promote(row.id);
                              // The row says production and Caddy may not. A
                              // second promote is idempotent; silence is not.
                              if (result.warning) toast.warning(result.warning);
                            })
                          }
                        >
                          Promote
                        </Button>
                      )}
                      {row.status === "ready" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void act(row.id, "Restarted", () =>
                              api.deploy.restart(row.id),
                            )
                          }
                        >
                          Restart
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(row.id, "Rollback queued", () =>
                            api.deploy.rollback(row.id),
                          )
                        }
                      >
                        Rollback
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <LogSheet deployment={logsFor} onClose={() => setLogsFor(null)} />
    </>
  );
}
