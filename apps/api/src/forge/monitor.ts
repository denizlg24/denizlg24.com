import {
  CloudCoreError,
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

const SAMPLE_INTERVAL_MS = 30_000;

export class ForgeAgentUnavailableError extends CloudCoreError {
  readonly status = 503;

  constructor() {
    super(
      "The Forge deploy agent is not configured",
      "FORGE_AGENT_UNAVAILABLE",
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ForgeMonitorOptions {
  db: Database;
  deployAgent: DeployAgentProxy | null;
  intervalMs?: number;
  now?: () => Date;
}

/** Polls the Forge deploy agent, retains its snapshot, and stores chart data. */
export class ForgeMonitor {
  readonly #options: ForgeMonitorOptions;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running: Promise<ForgeOverview> | null = null;
  #latest: ForgeOverview | null = null;
  readonly #networkTotals = new Map<
    string,
    { at: number; rxBytes: number; txBytes: number }
  >();

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
      throw new ForgeAgentUnavailableError();
    }
    return this.#options.deployAgent.stream(
      `/containers/${encodeURIComponent(containerId)}/logs`,
      signal,
    );
  }

  restartDeployment(deploymentId: string): Promise<Response> {
    if (!this.#options.deployAgent) {
      throw new ForgeAgentUnavailableError();
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
    const agentResult = await Promise.resolve(this.#agentSnapshot()).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    const overview: ForgeOverview = {
      timestamp: timestamp.toISOString(),
      agent: agentResult.status === "fulfilled" ? agentResult.value : null,
      errors: {
        agent:
          agentResult.status === "rejected"
            ? describe(agentResult.reason)
            : null,
      },
    };
    const samples = this.#metricSamples(timestamp, overview);
    this.#latest = overview;
    if (samples.length > 0) {
      await insertMetricSamples(this.#options.db, samples).catch((error) => {
        console.error("[forge-metrics] Sample persistence failed", error);
      });
    }
    return overview;
  }

  #metricSamples(ts: Date, overview: ForgeOverview): MetricSampleInput[] {
    const samples: MetricSampleInput[] = [];
    const agent = overview.agent;
    if (agent) {
      const { cpu, memory } = agent.host;
      samples.push(
        {
          ts,
          kind: "forge-host",
          key: "cpu.usage_percent",
          value: cpu.usagePercent,
        },
        {
          ts,
          kind: "forge-host",
          key: "load.1",
          value: cpu.load1,
        },
        {
          ts,
          kind: "forge-host",
          key: "load.5",
          value: cpu.load5,
        },
        {
          ts,
          kind: "forge-host",
          key: "load.15",
          value: cpu.load15,
        },
        {
          ts,
          kind: "forge-host",
          key: "memory.usage_percent",
          value: memory.usagePercent,
        },
      );
      if (agent.health.disk.usedPercent !== null) {
        samples.push({
          ts,
          kind: "forge-host",
          key: "disk.usage_percent",
          value: agent.health.disk.usedPercent,
        });
      }
      if (
        agent.health.buildDisk?.usedPercent !== null &&
        agent.health.buildDisk?.usedPercent !== undefined
      ) {
        samples.push({
          ts,
          kind: "forge-host",
          key: "build_disk.usage_percent",
          value: agent.health.buildDisk.usedPercent,
        });
      }
      const seenNetworkKeys = new Set<string>();
      for (const container of agent.containers) {
        if (!container.metrics) continue;
        const key = container.deploymentId ?? container.id.slice(0, 12);
        seenNetworkKeys.add(key);
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
        );
        const previous = this.#networkTotals.get(key);
        const current = {
          at: ts.getTime(),
          rxBytes: container.metrics.networkRxBytes,
          txBytes: container.metrics.networkTxBytes,
        };
        this.#networkTotals.set(key, current);
        const elapsedSeconds = previous
          ? (current.at - previous.at) / 1_000
          : 0;
        if (
          previous &&
          elapsedSeconds > 0 &&
          current.rxBytes >= previous.rxBytes &&
          current.txBytes >= previous.txBytes
        ) {
          samples.push(
            {
              ts,
              kind: "forge-container",
              key: `${key}:network.rx_bytes_per_second`,
              value: (current.rxBytes - previous.rxBytes) / elapsedSeconds,
              intervalSeconds: elapsedSeconds,
            },
            {
              ts,
              kind: "forge-container",
              key: `${key}:network.tx_bytes_per_second`,
              value: (current.txBytes - previous.txBytes) / elapsedSeconds,
              intervalSeconds: elapsedSeconds,
            },
          );
        }
      }
      for (const key of this.#networkTotals.keys()) {
        if (!seenNetworkKeys.has(key)) this.#networkTotals.delete(key);
      }
    }
    return samples;
  }
}
