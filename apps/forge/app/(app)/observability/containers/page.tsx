"use client";

import { DeploymentKindBadge } from "@repo/cloud-ui/deploy-status";
import {
  formatBytes,
  formatPercent,
  formatRelative,
} from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { ForgeContainer } from "@repo/schemas/cloud";
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
import { RotateCw, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ContainerPanel } from "@/components/container-panel";
import { PageHeading } from "@/components/page-heading";
import {
  activeProject,
  ProjectFilter,
  ProjectGroupRow,
} from "@/components/project-group-ui";
import { groupByProject } from "@/components/project-groups";
import { api, errorMessage } from "@/lib/api";

const COLUMNS = 8;

export default function ContainersPage() {
  const { data, error, reload } = usePoll(api.forge.overview, 15_000);
  const [restarting, setRestarting] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [project, setProject] = useState<string | null>(null);
  const [opened, setOpened] = useState<ForgeContainer | null>(null);

  const containers = data?.agent?.containers ?? [];
  const groups = useMemo(
    () =>
      groupByProject(containers, (container) => ({
        projectSlug: container.projectSlug,
        kind: container.kind,
      })),
    [containers],
  );
  const active = activeProject(groups, project);
  const shown = active
    ? groups.filter((group) => group.projectSlug === active)
    : groups;

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

  const toggle = (slug: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  function row(container: ForgeContainer, inset: boolean) {
    const deploymentId = container.deploymentId;
    return (
      <TableRow key={container.id}>
        <TableCell className={inset ? "pl-9" : undefined}>
          <div className="flex flex-col">
            <span className="flex items-center gap-2">
              <span className={inset ? "text-xs" : "font-medium"}>
                {container.name}
              </span>
              {container.kind === "production" ||
              container.kind === "preview" ? (
                <DeploymentKindBadge kind={container.kind} />
              ) : null}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {container.image} · {formatRelative(container.createdAt)}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot
              tone={container.state === "running" ? "good" : "critical"}
              label={container.state}
            />
            <span className="text-xs">{container.state}</span>
          </span>
          {container.health ? (
            <span className="ml-2 text-[11px] text-muted-foreground">
              {container.health}
            </span>
          ) : null}
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
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setOpened(container)}
              aria-label={`Logs and requests for ${container.name}`}
            >
              <ScrollText className="size-3.5" />
            </Button>
            {deploymentId ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={restarting.has(deploymentId)}
                onClick={() => void restart(deploymentId)}
                aria-label={`Restart ${container.name}`}
              >
                <RotateCw
                  className={`size-3.5 ${restarting.has(deploymentId) ? "animate-spin" : ""}`}
                />
              </Button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="containers"
        detail="live Docker state; Forge-labelled workloads only"
      />
      {!data && !error ? <Skeleton className="h-64" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {data ? (
        <>
          <ProjectFilter
            groups={groups}
            selected={project}
            onSelect={setProject}
          />

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
              {shown.flatMap((group) => {
                const isCollapsed = collapsed.has(group.projectSlug);
                return [
                  <ProjectGroupRow
                    key={`${group.projectSlug}-group`}
                    slug={group.projectSlug}
                    detail={group.all.length}
                    columns={COLUMNS}
                    collapsed={isCollapsed}
                    onToggle={() => toggle(group.projectSlug)}
                  />,
                  ...(isCollapsed
                    ? []
                    : [
                        ...group.production.map((container) =>
                          row(container, false),
                        ),
                        ...group.previews.map((container) =>
                          row(container, true),
                        ),
                      ]),
                ];
              })}
              {shown.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={COLUMNS}
                    className="h-24 text-center text-xs text-muted-foreground"
                  >
                    —
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </>
      ) : null}

      <ContainerPanel
        container={opened}
        onOpenChange={(open) => {
          if (!open) setOpened(null);
        }}
      />
    </div>
  );
}
