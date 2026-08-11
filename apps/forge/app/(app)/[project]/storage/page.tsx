"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Badge } from "@repo/ui/badge";
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
import Link from "next/link";
import { useCallback } from "react";
import { ResourceKindBadge, ScopeBadge } from "@/components/resource-badges";
import { useTarget } from "@/components/target-context";
import { api } from "@/lib/api";

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
  const { data, error, loading } = usePoll(fetchResources, null);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-48 w-full" />;

  const rows = data ?? [];

  return (
    <Section title="connected resources" count={rows.length}>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
