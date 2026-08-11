import {
  CloudCoreError,
  type Database,
  insertMetricSamples,
  type MetricSampleInput,
} from "@repo/cloud-core";
import {
  type ForgeAgentSnapshot,
  type ForgeOverview,
  type ForgeRequestLogPage,
  type ForgeRequestLogQuery,
  type ForgeRequestLogs,
  type ForgeRequestLogsQuery,
  forgeAgentSnapshotSchema,
  forgeRequestLogPageSchema,
  forgeRequestLogRecordSchema,
  forgeRequestLogsSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";

import type { DeployAgentProxy } from "../deploy/proxy";
import { hostMetricSamples } from "./host-series";

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

/** The agent answered, and refused. Distinct from it not being configured. */
export class ForgeAgentRequestError extends CloudCoreError {
  readonly status = 503;

  constructor(detail: string) {
    super(
      `The Forge deploy agent refused the request log: ${detail}`,
      "FORGE_AGENT_REQUEST_FAILED",
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

  async requestLogs(
    deploymentId: string,
    query: ForgeRequestLogQuery,
  ): Promise<ForgeRequestLogPage> {
    if (!this.#options.deployAgent) {
      throw new ForgeAgentUnavailableError();
    }
    // Forwarded rather than applied here: the agent reads the log backwards and
    // stops at `limit`, so filtering on this side would only ever search the
    // last page of a file and report "no 5xx" for a deployment full of them.
    const search = new URLSearchParams({ limit: String(query.limit) });
    for (const method of query.method) search.append("method", method);
    for (const status of query.status) search.append("status", status);
    if (query.search !== null) search.set("search", query.search);
    if (query.minDurationMs !== null) {
      search.set("minDurationMs", String(query.minDurationMs));
    }
    const response = await this.#options.deployAgent.json<unknown>(
      `/deployments/${encodeURIComponent(deploymentId)}/requests?${search}`,
    );
    // A non-2xx body is an error envelope, not a record list. Parsing it would
    // surface as a zod failure naming fields the caller never sent, so the status
    // is checked first and reported as what it is.
    if (response.status < 200 || response.status >= 300) {
      throw new ForgeAgentRequestError(
        typeof response.body === "object" &&
          response.body !== null &&
          "error" in response.body
          ? JSON.stringify((response.body as { error: unknown }).error)
          : `status ${response.status}`,
      );
    }
    // `.catch` rather than a required field: an agent deployed behind this one
    // answers with the bare record list, and losing the scan counters is a
    // cosmetically poorer empty state, not a reason to fail the request.
    return forgeRequestLogPageSchema
      .catch((issue) => ({
        requests: z
          .object({ requests: z.array(forgeRequestLogRecordSchema) })
          .parse(issue.value).requests,
        scanned: 0,
        truncated: false,
      }))
      .parse(response.body);
  }

  /**
   * The container output for one request, forwarded to the agent.
   *
   * Nothing is cached or stored here for the same reason the request list is
   * not: these are lines the container already wrote, held by Docker's own log
   * driver, and a second copy in Postgres would outgrow every other table on the
   * box within a week.
   */
  async requestOutput(
    deploymentId: string,
    query: ForgeRequestLogsQuery,
  ): Promise<ForgeRequestLogs> {
    if (!this.#options.deployAgent) {
      throw new ForgeAgentUnavailableError();
    }
    const search = new URLSearchParams({
      from: query.from,
      to: query.to,
      limit: String(query.limit),
    });
    if (query.requestId !== null) search.set("requestId", query.requestId);
    const response = await this.#options.deployAgent.json<unknown>(
      `/deployments/${encodeURIComponent(deploymentId)}/request-logs?${search}`,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new ForgeAgentRequestError(
        typeof response.body === "object" &&
          response.body !== null &&
          "error" in response.body
          ? JSON.stringify((response.body as { error: unknown }).error)
          : `status ${response.status}`,
      );
    }
    return forgeRequestLogsSchema.parse(response.body);
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
    const startedAt = performance.now();
    const agentResult = await Promise.resolve(this.#agentSnapshot()).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    const latencyMs = performance.now() - startedAt;
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
    const samples = this.#metricSamples(timestamp, overview, latencyMs);
    this.#latest = overview;
    if (samples.length > 0) {
      await insertMetricSamples(this.#options.db, samples).catch((error) => {
        console.error("[forge-metrics] Sample persistence failed", error);
      });
    }
    return overview;
  }

  #metricSamples(
    ts: Date,
    overview: ForgeOverview,
    latencyMs: number,
  ): MetricSampleInput[] {
    const samples: MetricSampleInput[] = [];
    const agent = overview.agent;
    // Reachability is the one series that has to be written when the box is
    // unreachable, because every other one stops. An alert rule aggregates the
    // rows in its window and a window with no rows never evaluates, so a host
    // that vanishes would otherwise stay silently "ok" forever. Skipped only
    // when there is no agent configured at all: a control plane that was never
    // pointed at a Forge host is not a Forge host that is down.
    if (this.#options.deployAgent) {
      samples.push({
        ts,
        kind: "forge-host",
        key: "agent.up",
        value: agent ? 1 : 0,
      });
      if (agent) {
        samples.push({
          ts,
          kind: "forge-host",
          key: "agent.latency_ms",
          value: latencyMs,
        });
      }
    }
    if (agent) {
      // Every numeric leaf the host reported, derived from the snapshot rather
      // than listed here — a tower publishes whichever sensors its kernel
      // modules found, and that set is not knowable at compile time.
      samples.push(...hostMetricSamples(ts, agent.host));
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
            },
            {
              ts,
              kind: "forge-container",
              key: `${key}:network.tx_bytes_per_second`,
              value: (current.txBytes - previous.txBytes) / elapsedSeconds,
            },
          );
        }
      }
      for (const key of this.#networkTotals.keys()) {
        if (!seenNetworkKeys.has(key)) this.#networkTotals.delete(key);
      }

      // Already deltas for the interval the agent drained, so unlike the network
      // counters there is nothing to differentiate here. Keyed by deployment id
      // like the container series, so a project's request history and its CPU
      // history join on the same key.
      //
      // Stored as counts per sample interval, on the default `intervalSeconds`,
      // and both of those are deliberate. `rollupAndPruneMetrics` averages 30s
      // rows into 300s buckets and filters on `interval_seconds = 30` exactly —
      // a measured float would round to something else in the `smallint` column
      // and the row would then never be rolled up *or* pruned. Averaging counts
      // that all describe one sample interval keeps their meaning at every
      // resolution: the value is always "requests per sample", which the UI
      // scales to a rate. A poll the agent misses makes one sample cover two
      // intervals and reads as a spike; that is the honest reading, because the
      // traffic did arrive.
      for (const stats of agent.requests ?? []) {
        const key = stats.deploymentId;
        samples.push(
          {
            ts,
            kind: "forge-container",
            key: `${key}:requests.count`,
            value: stats.count,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:requests.2xx`,
            value: stats.status2xx,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:requests.3xx`,
            value: stats.status3xx,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:requests.4xx`,
            value: stats.status4xx,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:requests.5xx`,
            value: stats.status5xx,
          },
          {
            ts,
            kind: "forge-container",
            key: `${key}:response.bytes`,
            value: stats.bytesOut,
          },
        );
        // Only when the interval actually saw traffic. A percentile over no
        // requests is 0, and storing that would drag every average down and draw
        // a latency chart that dips to zero every time an app is idle.
        if (stats.count > 0) {
          samples.push(
            {
              ts,
              kind: "forge-container",
              key: `${key}:request.duration_ms.p50`,
              value: stats.durationP50Ms,
            },
            {
              ts,
              kind: "forge-container",
              key: `${key}:request.duration_ms.p95`,
              value: stats.durationP95Ms,
            },
          );
        }
      }
    }
    return samples;
  }
}
