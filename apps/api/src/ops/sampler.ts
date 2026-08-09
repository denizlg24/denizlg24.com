import {
  type Database,
  type DockerClient,
  files,
  folders,
  insertMetricSamples,
  type MetricSampleInput,
} from "@repo/cloud-core";
import type {
  ContainerSnapshot,
  DatabaseStats,
  OpsOverview,
} from "@repo/schemas/cloud";
import { count, sum } from "drizzle-orm";
import type { MongoClient } from "mongodb";

import { collectDatabaseStats } from "./database-stats";
import { type DiskDevice, HostCollector } from "./host";

const SAMPLING_INTERVAL_MS = 30_000;

interface RedisInfoClient {
  info(section: string): Promise<string>;
}

export interface MetricsSamplerOptions {
  db: Database;
  docker: DockerClient;
  devices: readonly DiskDevice[];
  intervalMs?: number;
  /**
   * Optional so a sampler can be stood up in tests without the engines. When
   * absent, `databases` reports nulls and no `db:` series are written.
   */
  mongo?: MongoClient;
  redis?: RedisInfoClient;
}

const EMPTY_DATABASE_STATS: DatabaseStats = {
  postgres: null,
  mongodb: null,
  redis: null,
};

/**
 * An unreachable engine writes no points rather than zeroes: a gap in the chart
 * reads as "not collected", while a zero reads as "no connections", and those
 * are opposite conclusions during an incident.
 */
function databaseSamples(ts: Date, stats: DatabaseStats): MetricSampleInput[] {
  const samples: MetricSampleInput[] = [];
  const { postgres, mongodb, redis } = stats;

  if (postgres) {
    samples.push(
      {
        ts,
        kind: "db",
        key: "postgres.connections",
        value: postgres.connections,
      },
      {
        ts,
        kind: "db",
        key: "postgres.connections_percent",
        value: postgres.usagePercent,
      },
      { ts, kind: "db", key: "postgres.active", value: postgres.active },
      {
        ts,
        kind: "db",
        key: "postgres.idle_in_transaction",
        value: postgres.idleInTransaction,
      },
      { ts, kind: "db", key: "postgres.waiting", value: postgres.waiting },
    );
  }

  if (mongodb) {
    samples.push(
      {
        ts,
        kind: "db",
        key: "mongodb.connections_current",
        value: mongodb.current,
      },
      {
        ts,
        kind: "db",
        key: "mongodb.connections_available",
        value: mongodb.available,
      },
      {
        ts,
        kind: "db",
        key: "mongodb.connections_percent",
        value: mongodb.usagePercent,
      },
      {
        ts,
        kind: "db",
        key: "mongodb.queued_total",
        value: mongodb.queuedReaders + mongodb.queuedWriters,
      },
    );
  }

  if (redis) {
    samples.push(
      {
        ts,
        kind: "db",
        key: "redis.connected_clients",
        value: redis.connectedClients,
      },
      {
        ts,
        kind: "db",
        key: "redis.used_memory_bytes",
        value: redis.usedMemoryBytes,
      },
    );
  }

  return samples;
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

  private async collectDatabases(): Promise<DatabaseStats> {
    const { mongo, redis } = this.options;
    if (!mongo || !redis) return EMPTY_DATABASE_STATS;
    return collectDatabaseStats({ db: this.options.db, mongo, redis });
  }

  private async collectAndPersist(): Promise<OpsOverview> {
    const timestamp = new Date();
    const [host, containers, storage, databases] = await Promise.all([
      this.host.collect(),
      this.collectContainers().catch((error) => {
        console.error("[metrics] Container collection failed", error);
        return [];
      }),
      this.storageSnapshot(),
      this.collectDatabases().catch((error) => {
        console.error("[metrics] Database stats failed", error);
        return EMPTY_DATABASE_STATS;
      }),
    ]);
    const overview: OpsOverview = {
      timestamp: timestamp.toISOString(),
      ...host,
      databases,
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

    // Run-queue depth normalised by core count, so one series reads the same on
    // a 4-core Pi as anywhere else and a threshold can be set once.
    if (overview.cpu.cores > 0) {
      samples.push({
        ts,
        kind: "host",
        key: "load.per_core",
        value: overview.cpu.load1 / overview.cpu.cores,
      });
    }

    samples.push(
      {
        ts,
        kind: "host",
        key: "swap.usage_percent",
        value: overview.swap.usagePercent,
      },
      {
        ts,
        kind: "host",
        key: "swap.used_bytes",
        value: overview.swap.usedBytes,
      },
    );
    // Absent on the first sample after a restart, like the other rate series.
    if (overview.swap.inBytesPerSecond !== undefined) {
      samples.push({
        ts,
        kind: "host",
        key: "swap.in_bytes_per_second",
        value: overview.swap.inBytesPerSecond,
      });
    }
    if (overview.swap.outBytesPerSecond !== undefined) {
      samples.push({
        ts,
        kind: "host",
        key: "swap.out_bytes_per_second",
        value: overview.swap.outBytesPerSecond,
      });
    }

    samples.push(
      {
        ts,
        kind: "host",
        key: "fd.allocated",
        value: overview.fileDescriptors.allocated,
      },
      {
        ts,
        kind: "host",
        key: "fd.usage_percent",
        value: overview.fileDescriptors.usagePercent,
      },
    );
    if (overview.fileDescriptors.processOpen !== null) {
      samples.push({
        ts,
        kind: "host",
        key: "fd.process_open",
        value: overview.fileDescriptors.processOpen,
      });
    }
    if (overview.fileDescriptors.processUsagePercent !== null) {
      samples.push({
        ts,
        kind: "host",
        key: "fd.process_usage_percent",
        value: overview.fileDescriptors.processUsagePercent,
      });
    }

    samples.push(
      {
        ts,
        kind: "host",
        key: "connections.established",
        value: overview.connections.established,
      },
      {
        ts,
        kind: "host",
        key: "connections.inbound",
        value: overview.connections.inbound,
      },
      {
        ts,
        kind: "host",
        key: "connections.outbound",
        value: overview.connections.outbound,
      },
      {
        ts,
        kind: "host",
        key: "connections.listening",
        value: overview.connections.listening,
      },
      {
        ts,
        kind: "host",
        key: "connections.time_wait",
        value: overview.connections.timeWait,
      },
      {
        ts,
        kind: "host",
        key: "connections.orphan",
        value: overview.connections.orphan,
      },
    );

    samples.push(...databaseSamples(ts, overview.databases));
    for (const disk of overview.disks) {
      // The UUID, so a series follows the physical disk rather than the name
      // the kernel happened to give it at boot. Falls back to the device path
      // only for a host still configured that way, which then keeps the old
      // rename-on-reboot behaviour it already had.
      const series = disk.uuid ?? disk.device;
      samples.push({
        ts,
        kind: "disk",
        key: `${series}.usage_percent`,
        value: disk.usagePercent,
      });
      // Absent on an offline disk and on the first sample after a restart.
      // Writing a zero in those cases would draw a trough that never happened.
      if (disk.readBytesPerSecond !== undefined) {
        samples.push({
          ts,
          kind: "disk",
          key: `${series}.read_bytes_per_second`,
          value: disk.readBytesPerSecond,
        });
      }
      if (disk.writeBytesPerSecond !== undefined) {
        samples.push({
          ts,
          kind: "disk",
          key: `${series}.write_bytes_per_second`,
          value: disk.writeBytesPerSecond,
        });
      }
      if (disk.utilizationPercent !== undefined) {
        samples.push({
          ts,
          kind: "disk",
          key: `${series}.io_utilization_percent`,
          value: disk.utilizationPercent,
        });
      }
    }

    // Collected for the overview tiles already; persisting it is what lets the
    // storage analytics page draw growth without a second aggregation pass.
    samples.push(
      {
        ts,
        kind: "storage",
        key: "total_bytes",
        value: overview.storage.totalSizeBytes,
      },
      {
        ts,
        kind: "storage",
        key: "file_count",
        value: overview.storage.fileCount,
      },
      {
        ts,
        kind: "storage",
        key: "folder_count",
        value: overview.storage.folderCount,
      },
    );
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
