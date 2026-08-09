import {
  type Database,
  insertMetricSamples,
  type MetricSampleInput,
} from "@repo/cloud-core";
import {
  type ForgeAgentSnapshot,
  type ForgeOverview,
  forgeAgentSnapshotSchema,
} from "@repo/schemas/cloud";

import type { DeployAgentProxy } from "../deploy/proxy";
import type { ResourceAgentClient } from "./resource-agent";

const SAMPLE_INTERVAL_MS = 30_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ForgeMonitorOptions {
  db: Database;
  deployAgent: DeployAgentProxy | null;
  resourceAgent: ResourceAgentClient | null;
  intervalMs?: number;
  now?: () => Date;
}

/** Polls both Forge agents, retains the latest snapshot, and stores chart data. */
export class ForgeMonitor {
  readonly #options: ForgeMonitorOptions;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running: Promise<ForgeOverview> | null = null;
  #latest: ForgeOverview | null = null;

  constructor(options: ForgeMonitorOptions) {
    this.#options = options;
    this.#intervalMs = options.intervalMs ?? SAMPLE_INTERVAL_MS;
  }

  async start(): Promise<void> {
    if (this.#timer) return;
    await this.sample().catch((error) => {
      console.error("[forge-metrics] Initial sample failed", error);
    });
    this.#timer = setInterval(() => {
      void this.sample().catch((error) => {
        console.error("[forge-metrics] Sample failed", error);
      });
    }, this.#intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async overview(): Promise<ForgeOverview> {
    return this.#latest ?? this.sample();
  }

  async sample(): Promise<ForgeOverview> {
    if (this.#running) return this.#running;
    this.#running = this.#collectAndPersist();
    try {
      return await this.#running;
    } finally {
      this.#running = null;
    }
  }

  runtimeLogs(containerId: string, signal?: AbortSignal): Promise<Response> {
    if (!this.#options.deployAgent) {
      throw new Error("The Forge deploy agent is not configured");
    }
    return this.#options.deployAgent.stream(
      `/containers/${encodeURIComponent(containerId)}/logs`,
      signal,
    );
  }

  restartDeployment(deploymentId: string): Promise<Response> {
    if (!this.#options.deployAgent) {
      throw new Error("The Forge deploy agent is not configured");
    }
    return this.#options.deployAgent.post(
      `/deployments/${encodeURIComponent(deploymentId)}/restart`,
    );
  }

  async #agentSnapshot(): Promise<ForgeAgentSnapshot> {
    if (!this.#options.deployAgent) {
      throw new Error("The Forge deploy agent is not configured");
    }
    const response = await this.#options.deployAgent.json<unknown>(
      "/telemetry",
      { method: "GET" },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Forge deploy agent returned ${response.status}`);
    }
    const envelope = response.body as { snapshot?: unknown } | null;
    return forgeAgentSnapshotSchema.parse(envelope?.snapshot);
  }

  async #collectAndPersist(): Promise<ForgeOverview> {
    const timestamp = this.#options.now?.() ?? new Date();
    const [resourceResult, agentResult] = await Promise.allSettled([
      this.#options.resourceAgent
        ? this.#options.resourceAgent.health()
        : Promise.reject(
            new Error("The Forge resource agent is not configured"),
          ),
      this.#agentSnapshot(),
    ]);
    const overview: ForgeOverview = {
      timestamp: timestamp.toISOString(),
      resource:
        resourceResult.status === "fulfilled" ? resourceResult.value : null,
      agent: agentResult.status === "fulfilled" ? agentResult.value : null,
      errors: {
        resource:
          resourceResult.status === "rejected"
            ? describe(resourceResult.reason)
            : null,
        agent:
          agentResult.status === "rejected"
            ? describe(agentResult.reason)
            : null,
      },
    };
    const samples = this.#metricSamples(timestamp, overview);
    if (samples.length > 0) {
      await insertMetricSamples(this.#options.db, samples);
    }
    this.#latest = overview;
    return overview;
  }

  #metricSamples(ts: Date, overview: ForgeOverview): MetricSampleInput[] {
    const samples: MetricSampleInput[] = [];
    const resource = overview.resource;
    if (resource) {
      const memory = resource.system.memory;
      const disk = resource.system.disk;
      samples.push(
        {
          ts,
          kind: "forge-host",
          key: "cpu.usage_percent",
          value: resource.system.cpu_usage_percent,
        },
        {
          ts,
          kind: "forge-host",
          key: "load.1",
          value: resource.system.load_avg[0],
        },
        {
          ts,
          kind: "forge-host",
          key: "load.5",
          value: resource.system.load_avg[1],
        },
        {
          ts,
          kind: "forge-host",
          key: "load.15",
          value: resource.system.load_avg[2],
        },
      );
      if (memory.total > 0) {
        samples.push({
          ts,
          kind: "forge-host",
          key: "memory.usage_percent",
          value: (memory.used / memory.total) * 100,
        });
      }
      if (disk.total > 0) {
        samples.push({
          ts,
          kind: "forge-host",
          key: "disk.usage_percent",
          value: (disk.used / disk.total) * 100,
        });
      }
    }

    const agent = overview.agent;
    if (agent) {
      if (agent.health.disk.usedPercent !== null) {
        samples.push({
          ts,
          kind: "forge-host",
          key: "docker_disk.usage_percent",
          value: agent.health.disk.usedPercent,
        });
      }
      for (const container of agent.containers) {
        if (!container.metrics) continue;
        const key = container.deploymentId ?? container.id.slice(0, 12);
        samples.push(
          {
            ts,
            kind: "forge-container",
            key: `${key}:cpu.usage_percent`,
            value: container.metrics.cpuPercent,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:memory.usage_percent`,
            value: container.metrics.memoryPercent,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:memory.bytes`,
            value: container.metrics.memoryBytes,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:network.rx_bytes`,
            value: container.metrics.networkRxBytes,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:network.tx_bytes`,
            value: container.metrics.networkTxBytes,
          },
        );
      }
    }
    return samples;
  }
}
