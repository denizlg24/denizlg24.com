"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Unlink } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { toast } from "sonner";
import { ResourceKindBadge, ScopeBadge } from "@/components/resource-badges";
import {
  ConnectResourceDialog,
  CreateResourceDialog,
} from "@/components/resource-dialogs";
import { useTarget } from "@/components/target-context";
import { api, errorMessage } from "@/lib/api";

/**
 * What this project has connected, and what each connection puts in the
 * container.
 *
 * The distinction matters: connecting a resource makes its binding namespace
 * *resolvable*, and nothing reaches the container until an env var references
 * it. A resource connected but referenced by nothing is a real state and shows
 * as one rather than being quietly filtered out.
 */
export default function ProjectStoragePage() {
  const { target } = useTarget();
  const fetchResources = useCallback(
    () => api.deploy.targetResources(target.id),
    [target.id],
  );
  const { data, error, loading, reload } = usePoll(fetchResources, null);

  async function disconnect(resourceId: string, connectionId: string) {
    try {
      await api.deploy.disconnectResource(resourceId, connectionId);
      toast.success("Disconnected");
      await reload();
    } catch (disconnectError) {
      toast.error(errorMessage(disconnectError));
    }
  }

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-48 w-full" />;

  const rows = data ?? [];

  return (
    <Section
      title="connected resources"
      count={rows.length}
      actions={
        <div className="flex gap-2">
          <ConnectResourceDialog
            projectId={target.projectId}
            onConnected={reload}
            trigger={
              <Button variant="outline" size="sm">
                Connect existing
              </Button>
            }
          />
          <CreateResourceDialog
            projectId={target.projectId}
            onCreated={reload}
            trigger={<Button size="sm">Create new</Button>}
          />
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>resource</TableHead>
              <TableHead>scope</TableHead>
              <TableHead>injects</TableHead>
              <TableHead className="text-right">connected</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.connection.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ResourceKindBadge kind={row.resource.kind} />
                    <Link
                      href={`/resources/${row.resource.id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {row.resource.name}
                    </Link>
                    {row.connection.envPrefix ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {row.connection.envPrefix}_
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <ScopeBadge scopes={row.connection.scopes} />
                </TableCell>
                <TableCell>
                  {row.injectedKeys.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.injectedKeys.map((injected) => (
                        <Badge
                          key={`${injected.key}:${injected.reference}`}
                          variant={injected.secret ? "outline" : "secondary"}
                          className="font-mono text-[10px]"
                          title={injected.reference}
                        >
                          {injected.key}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(row.connection.createdAt)}
                </TableCell>
                {/* The resource and its data survive — this only stops the
                    project's bindings resolving through it. Any env var still
                    referencing it becomes unresolvable, which is why the
                    injected keys are on the row next to this button. */}
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Disconnect ${row.resource.name}`}
                    onClick={() =>
                      void disconnect(row.resource.id, row.connection.id)
                    }
                  >
                    <Unlink className="size-3" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
