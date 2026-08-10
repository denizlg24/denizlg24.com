import type {
  ForgeAgentSnapshot,
  ForgeContainer,
  ForgeRequestLogRecord,
  ForgeRequestStats,
} from "@repo/schemas/cloud";

import type { DockerClient, ForgeDockerContainer } from "./docker";
import type { HealthService } from "./health";
import { HostCollector } from "./host";
import { type RequestLogStore, summariseRequests } from "./request-log";

const METRICS_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        const value = values[index];
        if (value !== undefined) results[index] = await map(value);
      }
    }),
  );
  return results;
}

export interface ForgeTelemetryOptions {
  docker: DockerClient;
  health: HealthService;
  host?: Pick<HostCollector, "collect">;
  /** Absent on a host with no access logs configured; requests are then omitted. */
  requests?: Pick<RequestLogStore, "drain" | "forget" | "tail">;
  now?: () => Date;
}

/**
 * A point-in-time, Forge-scoped view of the host's Docker daemon.
 *
 * The label filter lives inside `DockerClient`, rather than in a UI or proxy,
 * so adding a new caller can never make unrelated host containers visible by
 * forgetting a query parameter. Stats are best-effort per container: one
 * container disappearing between list and stats should not blank the page.
 */
export class ForgeTelemetry {
  readonly #options: ForgeTelemetryOptions;
  readonly #host: Pick<HostCollector, "collect">;
  readonly #tracked = new Set<string>();

  constructor(options: ForgeTelemetryOptions) {
    this.#options = options;
    this.#host = options.host ?? new HostCollector();
  }

  /** The most recent requests a deployment served, newest last. */
  async requests(
    deploymentId: string,
    limit: number,
  ): Promise<ForgeRequestLogRecord[]> {
    return (await this.#options.requests?.tail(deploymentId, limit)) ?? [];
  }

  async snapshot(): Promise<ForgeAgentSnapshot> {
    const healthPromise = this.#options.health.check();
    const hostPromise = this.#host.collect();
    const containers = await this.#options.docker
      .listForgeContainers()
      .catch(() => null);
    const [health, host] = await Promise.all([healthPromise, hostPromise]);
    if (!containers) {
      return {
        timestamp: (this.#options.now?.() ?? new Date()).toISOString(),
        health,
        host,
        containers: [],
        images: [],
      };
    }
    const [withMetrics, images, requests] = await Promise.all([
      mapWithConcurrency(containers, METRICS_CONCURRENCY, (container) =>
        this.#withMetrics(container),
      ),
      this.#options.docker.listForgeImages(containers).catch(() => []),
      this.#requestStats(containers),
    ]);
    return {
      timestamp: (this.#options.now?.() ?? new Date()).toISOString(),
      health,
      host,
      containers: withMetrics,
      images,
      ...(requests ? { requests } : {}),
    };
  }

  /**
   * Drains each live deployment's access log into one interval's counters.
   *
   * Draining here rather than on a timer of its own is what makes the numbers
   * mean anything: the control plane records a sample per poll, so the window the
   * counters describe has to be the window between polls. A separate schedule
   * would silently attribute traffic to the wrong bucket.
   *
   * A deployment with no traffic still reports a zero row. Omitting it would make
   * an idle app indistinguishable from one whose logging broke, and leave gaps
   * that a chart draws as a line straight across an outage.
   */
  async #requestStats(
    containers: readonly ForgeDockerContainer[],
  ): Promise<ForgeRequestStats[] | null> {
    const store = this.#options.requests;
    if (!store) return null;

    const live = new Set<string>();
    for (const container of containers) {
      if (container.deploymentId) live.add(container.deploymentId);
    }
    // A cursor for a container that has gone would otherwise be held for the
    // life of the process, and GC deletes the file underneath it anyway.
    for (const deploymentId of this.#tracked) {
      if (!live.has(deploymentId)) {
        store.forget(deploymentId);
        this.#tracked.delete(deploymentId);
      }
    }

    // Bounded like the container-stats pass above it, and for the same reason:
    // one open descriptor and one read buffer per live deployment at once is an
    // unbounded burst on a host with many of them.
    return mapWithConcurrency(
      [...live],
      METRICS_CONCURRENCY,
      async (deploymentId) => {
        this.#tracked.add(deploymentId);
        const records = await store.drain(deploymentId).catch(() => []);
        return summariseRequests(deploymentId, records);
      },
    );
  }

  async logs(
    containerId: string,
    options: { tail?: number; signal?: AbortSignal } = {},
  ): Promise<AsyncGenerator<string>> {
    const container =
      await this.#options.docker.resolveForgeContainer(containerId);
    return this.#options.docker.forgeContainerLogs(container, options);
  }

  async #withMetrics(container: ForgeDockerContainer): Promise<ForgeContainer> {
    const metrics =
      container.state === "running"
        ? await this.#options.docker
            .forgeContainerStats(container)
            .catch(() => null)
        : null;
    return { ...container, metrics };
  }
}
