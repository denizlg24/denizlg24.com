import type { ForgeAgentSnapshot, ForgeContainer } from "@repo/schemas/cloud";

import type { DockerClient, ForgeDockerContainer } from "./docker";
import type { HealthService } from "./health";

export interface ForgeTelemetryOptions {
  docker: DockerClient;
  health: HealthService;
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

  constructor(options: ForgeTelemetryOptions) {
    this.#options = options;
  }

  async snapshot(): Promise<ForgeAgentSnapshot> {
    const [health, containers] = await Promise.all([
      this.#options.health.check(),
      this.#options.docker.listForgeContainers(),
    ]);
    const [withMetrics, images] = await Promise.all([
      Promise.all(containers.map((container) => this.#withMetrics(container))),
      this.#options.docker.listForgeImages(containers),
    ]);
    return {
      timestamp: (this.#options.now?.() ?? new Date()).toISOString(),
      health,
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
