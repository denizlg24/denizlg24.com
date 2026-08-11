"use client";

import {
  formatBytes,
  formatDurationSeconds,
  formatPercent,
} from "@repo/cloud-ui/format";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { ForgeContainer, ForgeImage } from "@repo/schemas/cloud";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ContainersTable } from "@/components/observability/containers-table";
import { ImagesTable } from "@/components/observability/images-table";
import { PageHeading } from "@/components/page-heading";
import { activeProject, ProjectFilter } from "@/components/project-group-ui";
import { groupByProject } from "@/components/project-groups";
import { api } from "@/lib/api";

const HostCharts = dynamic(
  () => import("@/components/host-charts").then((module) => module.HostCharts),
  { ssr: false, loading: () => <Skeleton className="h-48" /> },
);

/**
 * The host, its containers and its images on one page.
 *
 * They were three routes behind a section rail while the split moved them off
 * the top-level nav, and all three polled the same `forge.overview` response to
 * render a slice of it. Folded, that is one poll, one project filter scoping
 * both tables, and no way for the two lists to disagree about which project you
 * are looking at.
 */
const POLL_MS = 15_000;

function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 border-l pl-3 first:border-l-0 first:pl-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-lg tabular-nums">
        {value}
      </div>
      {detail ? (
        <div className="truncate text-[11px] text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export default function ObservabilityPage() {
  const { data, error, unreachable, loading, reload } = usePoll(
    api.forge.overview,
    POLL_MS,
  );
  const [project, setProject] = useState<string | null>(null);

  const containers = data?.agent?.containers ?? [];
  const images = data?.agent?.images ?? [];
  // The union of both lists, so the filter offers a project that has an image
  // left behind and no container still running — which is exactly the project
  // worth looking at.
  const filterGroups = useMemo(
    () =>
      groupByProject<ForgeContainer | ForgeImage>(
        [...containers, ...images],
        (item) => ({ projectSlug: item.projectSlug, kind: item.kind }),
      ),
    [containers, images],
  );

  if (!data) {
    if (unreachable)
      return <Unreachable retrying={loading} onRetry={() => void reload()} />;
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <Skeleton className="h-40" />
    );
  }

  const agent = data.agent;
  const host = agent?.host;
  const memory = host?.memory;
  const disk = agent?.health.disk;
  const buildDisk = agent?.health.buildDisk;
  const running = containers.filter(
    (container) => container.state === "running",
  ).length;
  const imageBytes = images.reduce((sum, image) => sum + image.sizeBytes, 0);
  const active = activeProject(filterGroups, project);

  return (
    <div className="flex flex-col gap-8">
      <PageHeading
        title="observability"
        detail={`sampled ${new Date(data.timestamp).toLocaleTimeString()}`}
      />
      {data.errors.agent ? (
        <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {data.errors.agent}
        </div>
      ) : null}
      <section className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
        <Tile
          label="host"
          value={agent?.health.status ?? "offline"}
          detail={agent ? `${host?.cpu.cores ?? 0} cores` : undefined}
        />
        <Tile
          label="uptime"
          value={
            agent ? formatDurationSeconds(agent.health.uptimeSeconds) : "—"
          }
        />
        <Tile
          label="cpu"
          value={formatPercent(host?.cpu.usagePercent)}
          detail={host ? `load ${host.cpu.load1.toFixed(2)}` : undefined}
        />
        <Tile
          label="memory"
          value={formatPercent(memory?.usagePercent)}
          detail={
            memory
              ? `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`
              : undefined
          }
        />
        <Tile
          label="runtime disk"
          value={formatPercent(disk?.usedPercent)}
          detail={
            disk?.freeBytes !== null && disk?.freeBytes !== undefined
              ? `${formatBytes(disk.freeBytes)} free`
              : undefined
          }
        />
        <Tile
          label="build disk"
          value={formatPercent(buildDisk?.usedPercent)}
          detail={
            buildDisk?.freeBytes !== null && buildDisk?.freeBytes !== undefined
              ? `${formatBytes(buildDisk.freeBytes)} free`
              : undefined
          }
        />
        <Tile
          label="docker"
          value={agent?.health.docker.reachable ? "online" : "offline"}
          detail={agent?.health.docker.version ?? undefined}
        />
        <Tile
          label="containers"
          value={`${running}`}
          detail={`${containers.length} total`}
        />
        <Tile
          label="images"
          value={`${images.length}`}
          detail={formatBytes(imageBytes)}
        />
        <Tile
          label="build queue"
          value={`${agent?.health.queue.running ?? 0}/${agent?.health.queue.capacity ?? 0}`}
          detail={agent?.health.status}
        />
      </section>

      <HostCharts />

      <ProjectFilter
        groups={filterGroups}
        selected={project}
        onSelect={setProject}
      />

      <Section title="containers">
        <ContainersTable
          containers={containers}
          project={active}
          onChanged={reload}
        />
      </Section>

      <Section title="images">
        <ImagesTable images={images} project={active} />
      </Section>
    </div>
  );
}
