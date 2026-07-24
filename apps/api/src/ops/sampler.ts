import {
  type Database,
  type DockerClient,
  files,
  folders,
  insertMetricSamples,
  type MetricSampleInput,
} from "@repo/cloud-core";
import type { ContainerSnapshot, OpsOverview } from "@repo/schemas/cloud";
import { count, sum } from "drizzle-orm";

import { HostCollector } from "./host";

const SAMPLING_INTERVAL_MS = 30_000;

export interface MetricsSamplerOptions {
  db: Database;
  docker: DockerClient;
  devices: readonly string[];
  intervalMs?: number;
}

export class MetricsSampler {
  private readonly host: HostCollector;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<OpsOverview> | null = null;
  private latest: OpsOverview | null = null;

  constructor(private readonly options: MetricsSamplerOptions) {
    this.host = new HostCollector(options.devices);
    this.intervalMs = options.intervalMs ?? SAMPLING_INTERVAL_MS;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.sample().catch((error) => {
      console.error("[metrics] Initial sample failed", error);
    });
    this.timer = setInterval(() => {
      void this.sample().catch((error) => {
        console.error("[metrics] Sample failed", error);
      });
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async overview(): Promise<OpsOverview> {
    return this.latest ?? this.sample();
  }

  async sample(): Promise<OpsOverview> {
    if (this.running) return this.running;
    this.running = this.collectAndPersist();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async collectContainers(): Promise<ContainerSnapshot[]> {
    const containers = await this.options.docker.listContainers();
    const snapshots: ContainerSnapshot[] = [];
    for (const container of containers) {
      const stats =
        container.state === "running"
          ? await this.options.docker
              .containerStats(container.id)
              .catch(() => null)
          : null;
      snapshots.push({
        id: container.id,
        name: container.name,
        image: container.image,
        state: container.state,
        status: container.status,
        health: container.health,
        cpuPercent: stats?.cpuPercent ?? null,
        memoryBytes: stats?.memoryBytes ?? null,
        memoryPercent: stats?.memoryPercent ?? null,
        networkRxBytes: stats?.networkRxBytes ?? null,
        networkTxBytes: stats?.networkTxBytes ?? null,
      });
    }
    return snapshots;
  }

  private async storageSnapshot(): Promise<OpsOverview["storage"]> {
    const [fileResult, folderResult, sizeResult] = await Promise.all([
      this.options.db.select({ count: count() }).from(files),
      this.options.db.select({ count: count() }).from(folders),
      this.options.db.select({ total: sum(files.sizeBytes) }).from(files),
    ]);
    return {
      fileCount: fileResult[0]?.count ?? 0,
      folderCount: folderResult[0]?.count ?? 0,
      totalSizeBytes: Number(sizeResult[0]?.total ?? 0),
    };
  }

  private async collectAndPersist(): Promise<OpsOverview> {
    const timestamp = new Date();
    const [host, containers, storage] = await Promise.all([
      this.host.collect(),
      this.collectContainers().catch((error) => {
        console.error("[metrics] Container collection failed", error);
        return [];
      }),
      this.storageSnapshot(),
    ]);
    const overview: OpsOverview = {
      timestamp: timestamp.toISOString(),
      ...host,
      containers,
      storage,
    };
    const samples = this.toSamples(timestamp, overview);
    await insertMetricSamples(this.options.db, samples);
    this.latest = overview;
    return overview;
  }

  private toSamples(ts: Date, overview: OpsOverview): MetricSampleInput[] {
    const samples: MetricSampleInput[] = [
      {
        ts,
        kind: "host",
        key: "cpu.usage_percent",
        value: overview.cpu.usagePercent,
      },
      { ts, kind: "host", key: "load.1", value: overview.cpu.load1 },
      { ts, kind: "host", key: "load.5", value: overview.cpu.load5 },
      { ts, kind: "host", key: "load.15", value: overview.cpu.load15 },
      {
        ts,
        kind: "host",
        key: "memory.usage_percent",
        value: overview.memory.usagePercent,
      },
    ];
    if (overview.cpu.temperatureCelsius !== null) {
      samples.push({
        ts,
        kind: "host",
        key: "cpu.temperature_celsius",
        value: overview.cpu.temperatureCelsius,
      });
    }
    for (const disk of overview.disks) {
      samples.push({
        ts,
        kind: "disk",
        key: `${disk.device}.usage_percent`,
        value: disk.usagePercent,
      });
    }
    for (const network of overview.network) {
      samples.push(
        {
          ts,
          kind: "network",
          key: `${network.interface}.rx_bytes_per_second`,
          value: network.rxBytesPerSecond,
        },
        {
          ts,
          kind: "network",
          key: `${network.interface}.tx_bytes_per_second`,
          value: network.txBytesPerSecond,
        },
      );
    }
    for (const container of overview.containers) {
      if (container.cpuPercent !== null) {
        samples.push({
          ts,
          kind: "container",
          key: `${container.id}.cpu_percent`,
          value: container.cpuPercent,
        });
      }
      if (container.memoryPercent !== null) {
        samples.push({
          ts,
          kind: "container",
          key: `${container.id}.memory_percent`,
          value: container.memoryPercent,
        });
      }
      if (container.networkRxBytes !== null) {
        samples.push({
          ts,
          kind: "container",
          key: `${container.id}.network_rx_bytes`,
          value: container.networkRxBytes,
        });
      }
      if (container.networkTxBytes !== null) {
        samples.push({
          ts,
          kind: "container",
          key: `${container.id}.network_tx_bytes`,
          value: container.networkTxBytes,
        });
      }
    }
    return samples;
  }
}
