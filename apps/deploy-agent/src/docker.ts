export interface DockerPing {
  version: string;
  containersRunning: number;
}

export interface ForgeDockerContainer {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: string;
  status: string;
  health: string | null;
  createdAt: string;
  deploymentId: string | null;
  targetId: string | null;
  projectSlug: string | null;
  kind: string | null;
}

export interface ForgeDockerContainerStats {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}

export interface ForgeDockerImage {
  id: string;
  tags: string[];
  createdAt: string;
  sizeBytes: number;
  sharedSizeBytes: number | null;
  containerIds: string[];
  projectSlug: string | null;
  kind: string | null;
  /** Carries `forge/<slug>:latest`, which GC can never reap. */
  isCacheTag: boolean;
}

/**
 * The project and role an image tag encodes.
 *
 * Builds are tagged `forge/<projectSlug>:<shortSha>-<deploymentId8>` plus a moving
 * `forge/<projectSlug>:latest` used as the `--cache-from` source. Parsing it here
 * rather than in the dashboard keeps the tag format one thing the UI does not have
 * to know — and the `:latest` flag is what lets the images list say "cache" about
 * the one image per project that legitimately has no container and never will.
 */
export function parseForgeImageTags(tags: readonly string[]): {
  projectSlug: string | null;
  isCacheTag: boolean;
} {
  let projectSlug: string | null = null;
  let isCacheTag = false;
  for (const tag of tags) {
    const match = /^forge\/([a-z0-9][a-z0-9-]*):(.+)$/.exec(tag);
    if (!match?.[1]) continue;
    projectSlug ??= match[1];
    if (match[2] === "latest") isCacheTag = true;
  }
  return { projectSlug, isCacheTag };
}

export type FetchLike = (
  input: string,
  init?: RequestInit & { unix?: string },
) => Promise<Response>;

export interface DockerClientOptions {
  socketPath: string;
  timeoutMs?: number;
  fetchImplementation?: FetchLike;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_LOG_FRAME_BYTES = 16 * 1024 * 1024;

export class ForgeContainerNotFoundError extends Error {
  constructor() {
    super("Forge container was not found");
    this.name = "ForgeContainerNotFoundError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function numberAt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right;
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function isDockerFrameHeader(buffer: Uint8Array): boolean {
  if (buffer.byteLength < 8) return false;
  const stream = buffer[0];
  if (stream !== 0 && stream !== 1 && stream !== 2) return false;
  if (buffer[1] !== 0 || buffer[2] !== 0 || buffer[3] !== 0) return false;
  const length = new DataView(
    buffer.buffer,
    buffer.byteOffset + 4,
    4,
  ).getUint32(0);
  return length <= MAX_LOG_FRAME_BYTES;
}

async function* dockerLogPayloads(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let framed: boolean | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending = appendBytes(pending, value);
      if (framed === null && pending.byteLength >= 8) {
        framed = isDockerFrameHeader(pending);
      }
      if (framed === false) {
        yield pending;
        pending = new Uint8Array();
        continue;
      }
      if (framed !== true) continue;
      while (pending.byteLength >= 8) {
        if (!isDockerFrameHeader(pending)) {
          throw new Error("Docker returned an invalid log frame");
        }
        const length = new DataView(
          pending.buffer,
          pending.byteOffset + 4,
          4,
        ).getUint32(0);
        if (pending.byteLength < 8 + length) break;
        yield pending.slice(8, 8 + length);
        pending = pending.slice(8 + length);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (pending.byteLength > 0) {
    if (framed === true)
      throw new Error("Docker returned a truncated log frame");
    yield pending;
  }
}

async function* dockerLogLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const payload of dockerLogPayloads(body)) {
    pending += decoder.decode(payload, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      yield pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending.length > 0) yield pending;
}

/**
 * Talks to the daemon over its unix socket directly. There is no socket proxy
 * here, unlike the Pi: the agent runs on the host it deploys to, and a proxy
 * that allowed image builds would allow everything anyway.
 */
export class DockerClient {
  readonly #socketPath: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(options: DockerClientOptions) {
    this.#socketPath = options.socketPath;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? (fetch as FetchLike);
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.#fetch(`http://localhost${path}`, {
      ...init,
      unix: this.#socketPath,
      signal: init.signal ?? AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `Docker ${path} responded ${response.status} ${response.statusText}`,
      );
    }
    return response;
  }

  /**
   * `/info` rather than `/_ping`, because a ping proves the socket answers and
   * nothing more. Every build needs the daemon to actually report its state,
   * and a daemon mid-restart answers the ping while failing that.
   */
  async ping(): Promise<DockerPing> {
    const response = await this.#request("/info");
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
      throw new Error("Docker /info returned a non-object body");
    }
    const info = body as {
      ServerVersion?: unknown;
      ContainersRunning?: unknown;
    };
    return {
      version:
        typeof info.ServerVersion === "string" ? info.ServerVersion : "unknown",
      containersRunning:
        typeof info.ContainersRunning === "number" ? info.ContainersRunning : 0,
    };
  }

  async listForgeContainers(): Promise<ForgeDockerContainer[]> {
    const filters = encodeURIComponent(
      JSON.stringify({ label: ["forge.deployment"] }),
    );
    const response = await this.#request(
      `/containers/json?all=1&filters=${filters}`,
    );
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Docker returned an invalid Forge container list");
    }
    return payload.flatMap((value) => {
      if (!isRecord(value)) return [];
      const id = stringAt(value, "Id");
      const image = stringAt(value, "Image");
      const imageId = stringAt(value, "ImageID");
      if (!id || !image || !imageId) return [];
      const names = Array.isArray(value.Names)
        ? value.Names.filter((name): name is string => typeof name === "string")
        : [];
      const labels = isRecord(value.Labels) ? value.Labels : {};
      const status = stringAt(value, "Status") ?? "unknown";
      const health =
        status
          .match(/\((?:health:\s*)?(healthy|unhealthy|starting)\)\s*$/i)?.[1]
          ?.toLowerCase() ?? null;
      const created = numberAt(value, "Created");
      return [
        {
          id,
          name: (names[0] ?? id.slice(0, 12)).replace(/^\//, ""),
          image,
          imageId,
          state: stringAt(value, "State") ?? "unknown",
          status,
          health,
          createdAt: new Date(created * 1_000).toISOString(),
          deploymentId: stringAt(labels, "forge.deployment"),
          targetId: stringAt(labels, "forge.target"),
          projectSlug: stringAt(labels, "forge.project"),
          kind: stringAt(labels, "forge.kind"),
        },
      ];
    });
  }

  async resolveForgeContainer(
    reference: string,
  ): Promise<ForgeDockerContainer> {
    const containers = await this.listForgeContainers();
    const exact = containers.find(
      (candidate) =>
        candidate.id === reference ||
        candidate.name === reference ||
        candidate.deploymentId === reference,
    );
    if (exact) return exact;
    const prefix =
      reference.length >= 12
        ? containers.find((candidate) => candidate.id.startsWith(reference))
        : undefined;
    if (!prefix) throw new ForgeContainerNotFoundError();
    return prefix;
  }

  async forgeContainerStats(
    reference: string | ForgeDockerContainer,
  ): Promise<ForgeDockerContainerStats> {
    const container =
      typeof reference === "string"
        ? await this.resolveForgeContainer(reference)
        : reference;
    const response = await this.#request(
      `/containers/${encodeURIComponent(container.id)}/stats?stream=false&one-shot=true`,
    );
    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new Error("Docker returned invalid Forge container stats");
    }

    const cpuStats = recordAt(payload, "cpu_stats");
    const previousCpuStats = recordAt(payload, "precpu_stats");
    const cpuUsage = recordAt(cpuStats, "cpu_usage");
    const previousCpuUsage = recordAt(previousCpuStats, "cpu_usage");
    const cpuDelta =
      numberAt(cpuUsage, "total_usage") -
      numberAt(previousCpuUsage, "total_usage");
    const systemDelta =
      numberAt(cpuStats, "system_cpu_usage") -
      numberAt(previousCpuStats, "system_cpu_usage");
    const onlineCpus =
      numberAt(cpuStats, "online_cpus") ||
      (Array.isArray(cpuUsage.percpu_usage) ? cpuUsage.percpu_usage.length : 1);
    const cpuPercent =
      cpuDelta > 0 && systemDelta > 0
        ? (cpuDelta / systemDelta) * onlineCpus * 100
        : 0;

    const memory = recordAt(payload, "memory_stats");
    const memoryBytes = numberAt(memory, "usage");
    const memoryLimitBytes = numberAt(memory, "limit");
    const networks = recordAt(payload, "networks");
    let networkRxBytes = 0;
    let networkTxBytes = 0;
    for (const network of Object.values(networks)) {
      if (!isRecord(network)) continue;
      networkRxBytes += numberAt(network, "rx_bytes");
      networkTxBytes += numberAt(network, "tx_bytes");
    }

    const blockEntries = recordAt(
      payload,
      "blkio_stats",
    ).io_service_bytes_recursive;
    let blockReadBytes = 0;
    let blockWriteBytes = 0;
    if (Array.isArray(blockEntries)) {
      for (const entry of blockEntries) {
        if (!isRecord(entry)) continue;
        const operation = stringAt(entry, "op")?.toLowerCase();
        if (operation === "read") blockReadBytes += numberAt(entry, "value");
        if (operation === "write") blockWriteBytes += numberAt(entry, "value");
      }
    }

    return {
      cpuPercent,
      memoryBytes,
      memoryLimitBytes,
      memoryPercent:
        memoryLimitBytes > 0 ? (memoryBytes / memoryLimitBytes) * 100 : 0,
      networkRxBytes,
      networkTxBytes,
      blockReadBytes,
      blockWriteBytes,
      pids: numberAt(recordAt(payload, "pids_stats"), "current"),
    };
  }

  async listForgeImages(
    containers?: readonly ForgeDockerContainer[],
  ): Promise<ForgeDockerImage[]> {
    const forgeContainers = containers ?? (await this.listForgeContainers());
    const filters = encodeURIComponent(
      JSON.stringify({ reference: ["forge/*"] }),
    );
    const response = await this.#request(
      `/images/json?all=0&filters=${filters}`,
    );
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Docker returned an invalid Forge image list");
    }
    return payload.flatMap((value) => {
      if (!isRecord(value)) return [];
      const id = stringAt(value, "Id");
      if (!id) return [];
      const tags = Array.isArray(value.RepoTags)
        ? value.RepoTags.filter((tag): tag is string => typeof tag === "string")
        : [];
      const created = numberAt(value, "Created");
      const sharedSize = value.SharedSize;
      const used = forgeContainers.filter(
        (container) => container.imageId === id,
      );
      const parsed = parseForgeImageTags(tags);
      return [
        {
          id,
          tags,
          createdAt: new Date(created * 1_000).toISOString(),
          sizeBytes: numberAt(value, "Size"),
          sharedSizeBytes:
            typeof sharedSize === "number" && sharedSize >= 0
              ? sharedSize
              : null,
          containerIds: used.map((container) => container.id),
          projectSlug: parsed.projectSlug,
          // Only the container can say which kind an image was built for — the
          // tag carries the project and the commit, not the environment. An image
          // no container references has no kind, which is exactly right: a
          // retained build belongs to no environment until something runs it.
          kind: used[0]?.kind ?? null,
          isCacheTag: parsed.isCacheTag,
        },
      ];
    });
  }

  async *forgeContainerLogs(
    reference: string | ForgeDockerContainer,
    options: { tail?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<string> {
    const container =
      typeof reference === "string"
        ? await this.resolveForgeContainer(reference)
        : reference;
    const tail = Math.min(Math.max(options.tail ?? 500, 1), 5_000);
    const query = new URLSearchParams({
      follow: "1",
      stdout: "1",
      stderr: "1",
      timestamps: "1",
      tail: String(tail),
    });
    const response = await this.#request(
      `/containers/${encodeURIComponent(container.id)}/logs?${query}`,
      { signal: options.signal },
    );
    if (!response.body) throw new Error("Docker returned no log stream");
    yield* dockerLogLines(response.body);
  }
}
