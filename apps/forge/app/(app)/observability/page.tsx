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
import { useCallback, useMemo, useState } from "react";
import { ContainersTable } from "@/components/observability/containers-table";
import {
  CoreGrid,
  DiskTable,
  NetworkTable,
  Panel,
  PressurePanel,
  ProcessTable,
  SensorGrid,
} from "@/components/observability/host-panels";
import { ImagesTable } from "@/components/observability/images-table";
import { MachinePanel } from "@/components/observability/machine-panel";
import { SeriesCharts } from "@/components/observability/series-charts";
import { PageHeading } from "@/components/page-heading";
import { activeProject, ProjectFilter } from "@/components/project-group-ui";
import { groupByProject } from "@/components/project-groups";
import { api } from "@/lib/api";

/**
 * Everything the host will tell us about itself, plus its containers and images.
 *
 * The live snapshot and the charts come from two different places on purpose.
 * The snapshot is whatever the agent read this second — every hwmon rail, every
 * core, every disk — and is rendered whole because it costs one poll. The charts
 * are driven by the series catalog, which is read back out of the samples table:
 * what a machine records depends on its hardware, so a page with hard-coded
 * panels would be wrong on the next box or after a drive is added.
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
  // The catalog changes when hardware does, not between polls, so it is fetched
  // once rather than on the snapshot's cadence.
  const fetchSeries = useCallback(() => api.forge.series(), []);
  const { data: catalog } = usePoll(fetchSeries, null);
  const [project, setProject] = useState<string | null>(null);

  const containers = useMemo(() => data?.agent?.containers ?? [], [data]);
  const images = useMemo(() => data?.agent?.images ?? [], [data]);
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
  const system = host?.system;
  const running = containers.filter(
    (container) => container.state === "running",
  ).length;
  const imageBytes = images.reduce((sum, image) => sum + image.sizeBytes, 0);
  const active = activeProject(filterGroups, project);
  const packageWatts = (host?.power ?? []).reduce(
    (sum, zone) => sum + zone.watts,
    0,
  );
  const fans = (host?.sensors ?? []).filter((sensor) => sensor.kind === "fan");

  return (
    <div className="flex flex-col gap-8">
      <PageHeading
        title="observability"
        detail={`sampled ${new Date(data.timestamp).toLocaleTimeString()}`}
      />
      <MachinePanel overview={data} />

      <section className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">
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
          label="temp"
          value={
            host?.cpu.temperatureCelsius === null ||
            host?.cpu.temperatureCelsius === undefined
              ? "—"
              : `${host.cpu.temperatureCelsius.toFixed(0)}°C`
          }
          detail={
            fans.length > 0
              ? `${Math.round(Math.max(...fans.map((fan) => fan.value)))} rpm`
              : undefined
          }
        />
        <Tile
          label="power"
          value={packageWatts > 0 ? `${packageWatts.toFixed(0)} W` : "—"}
          detail={
            (host?.power ?? []).length > 0
              ? `${host?.power.length} zones`
              : undefined
          }
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
          label="swap"
          value={formatPercent(memory?.swapUsagePercent ?? undefined)}
          detail={
            memory?.swapUsedBytes !== null &&
            memory?.swapUsedBytes !== undefined
              ? formatBytes(memory.swapUsedBytes)
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
      </section>

      {host && host.cpu.perCore.length > 0 ? (
        <Panel
          title="cores"
          note={
            host.cpu.contextSwitchesPerSecond !== null
              ? `${Math.round(host.cpu.contextSwitchesPerSecond)} ctx/s · ${Math.round(host.cpu.interruptsPerSecond ?? 0)} intr/s`
              : undefined
          }
        >
          <CoreGrid cores={host.cpu.perCore} />
        </Panel>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel title="storage">
          <DiskTable
            disks={host?.disks ?? []}
            filesystems={host?.filesystems ?? []}
          />
        </Panel>
        <Panel title="network">
          <NetworkTable interfaces={host?.network ?? []} />
        </Panel>
        {host?.pressure ? (
          <Panel title="pressure" note="stalled share, 10s average">
            <PressurePanel pressure={host.pressure} />
          </Panel>
        ) : null}
        <Panel
          title="processes"
          note={
            system?.processes !== null && system?.processes !== undefined
              ? `${system.processes} running · ${system.threads ?? 0} threads`
              : undefined
          }
        >
          <ProcessTable processes={host?.processes ?? []} />
        </Panel>
      </div>

      <Panel title="sensors" note={`${(host?.sensors ?? []).length} readings`}>
        <SensorGrid sensors={host?.sensors ?? []} />
      </Panel>

      <Panel title="history">
        {catalog ? (
          <SeriesCharts catalog={catalog} />
        ) : (
          <Skeleton className="h-48" />
        )}
      </Panel>

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
