import type {
  ForgeAgentSnapshot,
  ForgeContainer,
  ForgeRequestLogLine,
  ForgeRequestLogs,
  ForgeRequestStats,
} from "@repo/schemas/cloud";

import type { DockerClient, ForgeDockerContainer } from "./docker";
import type { HealthService } from "./health";
import { HostCollector } from "./host";
import {
  type RequestLogFilter,
  type RequestLogStore,
  type RequestLogTail,
  summariseRequests,
} from "./request-log";

const METRICS_CONCURRENCY = 4;

/**
 * Splits Docker's `timestamps=1` prefix off a line.
 *
 * The daemon writes an RFC3339 instant, a single space, then the line as the
 * container wrote it. Left in place it would be repeated in front of every
 * message in a UI that already has a time column, and would defeat any search
 * for text at the start of a line.
 */
export function parseTimestampedLine(entry: {
  stream: "stdout" | "stderr" | null;
  line: string;
}): ForgeRequestLogLine {
  const boundary = entry.line.indexOf(" ");
  if (boundary > 0) {
    const stamp = new Date(entry.line.slice(0, boundary));
    if (!Number.isNaN(stamp.getTime())) {
      return {
        ts: stamp.toISOString(),
        stream: entry.stream,
        message: entry.line.slice(boundary + 1),
      };
    }
  }
  // A line the daemon did not stamp is still a line worth showing; it just
  // cannot be placed on the timeline.
  return { ts: null, stream: entry.stream, message: entry.line };
}

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

  /** The most recent matching requests a deployment served, newest last. */
  async requests(
    deploymentId: string,
    limit: number,
    filter?: RequestLogFilter,
  ): Promise<RequestLogTail> {
    return (
      (await this.#options.requests?.tail(deploymentId, limit, filter)) ?? {
        requests: [],
        scanned: 0,
        truncated: false,
      }
    );
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

  /**
   * The container output belonging to one request.
   *
   * Two mechanisms, and the answer says which one it used. Caddy stamps every
   * proxied request with `X-Request-Id` and forwards it, so an app that logs the
   * header gives an exact join — those lines are its request's and nobody
   * else's. An app that does not gets the whole window the request was open
   * for, which is right under low concurrency and wrong under high; conflating
   * the two would let the second quietly pass for the first.
   *
   * The id is matched as a substring rather than by parsing the line: apps
   * format their logs however they like, and requiring a shape would mean
   * correlating for none of them.
   */
  async requestLogs(
    deploymentId: string,
    options: { from: Date; to: Date; requestId: string | null; limit: number },
  ): Promise<ForgeRequestLogs> {
    const containers = await this.#options.docker
      .listForgeContainers()
      .catch(() => []);
    const container = containers.find(
      (candidate) => candidate.deploymentId === deploymentId,
    );
    if (!container) {
      return { lines: [], correlation: "time-window", truncated: false };
    }

    const entries = await this.#options.docker
      .forgeContainerLogWindow(container, {
        // Widened by a second at each end because the daemon filters at
        // one-second resolution: a request that started at .95 would otherwise
        // fall outside a window asked for from .95.
        since: new Date(options.from.getTime() - 1_000),
        until: new Date(options.to.getTime() + 1_000),
      })
      .catch(() => []);

    const parsed = entries.map((entry) => parseTimestampedLine(entry));
    const requestId = options.requestId;
    const matched =
      requestId === null
        ? []
        : parsed.filter((line) => line.message.includes(requestId));

    const selected = matched.length > 0 ? matched : parsed;
    return {
      lines: selected.slice(-options.limit),
      correlation: matched.length > 0 ? "request-id" : "time-window",
      truncated: selected.length > options.limit,
    };
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
