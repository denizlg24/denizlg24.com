import type { ForgeAgentSnapshot, ForgeContainer } from "@repo/schemas/cloud";

import type { DockerClient, ForgeDockerContainer } from "./docker";
import type { HealthService } from "./health";
import { HostCollector } from "./host";

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

  constructor(options: ForgeTelemetryOptions) {
    this.#options = options;
    this.#host = options.host ?? new HostCollector();
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
    const [withMetrics, images] = await Promise.all([
      mapWithConcurrency(containers, METRICS_CONCURRENCY, (container) =>
        this.#withMetrics(container),
      ),
      this.#options.docker.listForgeImages(containers).catch(() => []),
    ]);
    return {
      timestamp: (this.#options.now?.() ?? new Date()).toISOString(),
      health,
      host,
      containers: withMetrics,
      images,
    };
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
