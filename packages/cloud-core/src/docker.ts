const DEFAULT_DOCKER_HOST = "tcp://docker-proxy:2375";
const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_TAIL_BYTES = 16 * 1_024;

interface DockerContainerJson {
  Id?: unknown;
  Names?: unknown;
  Image?: unknown;
  State?: unknown;
  Status?: unknown;
  Labels?: unknown;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: string | null;
  labels: Record<string, string>;
}

export interface DockerContainerStats {
  cpuPercent: number;
  memoryBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export interface DockerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DockerExecOptions {
  env?: readonly string[];
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberAt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nestedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function normalizeDockerHost(host: string): string {
  if (host.startsWith("tcp://")) {
    return `http://${host.slice("tcp://".length)}`;
  }
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }
  throw new Error(
    "DOCKER_HOST must use tcp://, http://, or https:// through the socket proxy",
  );
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function decodeTail(chunks: Uint8Array[], maxBytes = LOG_TAIL_BYTES): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(Math.min(total, maxBytes));
  let sourceOffset = Math.max(0, total - maxBytes);
  let outputOffset = 0;
  for (const chunk of chunks) {
    if (sourceOffset >= chunk.byteLength) {
      sourceOffset -= chunk.byteLength;
      continue;
    }
    const part = chunk.subarray(sourceOffset);
    output.set(
      part.subarray(0, output.byteLength - outputOffset),
      outputOffset,
    );
    outputOffset += part.byteLength;
    sourceOffset = 0;
    if (outputOffset >= output.byteLength) break;
  }
  return new TextDecoder().decode(output).trim();
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right;
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}

async function consumeDockerStream(
  body: ReadableStream<Uint8Array>,
  onStdout: (chunk: Uint8Array) => void,
  captureStdout: boolean,
): Promise<{ stdout: Uint8Array[]; stderr: Uint8Array[] }> {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array();
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value: incoming } = await reader.read();
      if (done) break;
      pending = appendBytes(pending, incoming);
      while (pending.byteLength >= 8) {
        const length = new DataView(
          pending.buffer,
          pending.byteOffset + 4,
          4,
        ).getUint32(0);
        if (pending.byteLength < 8 + length) break;
        const stream = pending[0];
        const payload = pending.slice(8, 8 + length);
        if (stream === 1) {
          onStdout(payload);
          if (captureStdout) stdout.push(payload);
        } else if (stream === 2) {
          stderr.push(payload);
        }
        pending = pending.slice(8 + length);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (pending.byteLength > 0) {
    throw new Error("Docker exec returned a truncated multiplexed stream");
  }
  return { stdout, stderr };
}

export class DockerClient {
  readonly baseUrl: string;

  constructor(
    host = process.env.DOCKER_HOST ?? DEFAULT_DOCKER_HOST,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizeDockerHost(host).replace(/\/$/, "");
  }

  private async request(
    path: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Response> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const message = (await response.text()).slice(-LOG_TAIL_BYTES);
      throw new Error(
        `Docker proxy request ${init.method ?? "GET"} ${path} failed (${response.status}): ${message}`,
      );
    }
    return response;
  }

  async ping(): Promise<void> {
    await this.request("/_ping");
  }

  async listContainers(): Promise<DockerContainer[]> {
    const response = await this.request("/containers/json?all=1");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Docker returned an invalid container list");
    }
    return payload.flatMap((item) => {
      if (!isRecord(item)) return [];
      const container = item as DockerContainerJson;
      if (
        typeof container.Id !== "string" ||
        typeof container.Image !== "string"
      ) {
        return [];
      }
      const names = Array.isArray(container.Names)
        ? container.Names.filter(
            (name): name is string => typeof name === "string",
          )
        : [];
      const status =
        typeof container.Status === "string" ? container.Status : "unknown";
      const healthMatch = status.match(/\(health: ([^)]+)\)/);
      return [
        {
          id: container.Id,
          name: (names[0] ?? container.Id.slice(0, 12)).replace(/^\//, ""),
          image: container.Image,
          state:
            typeof container.State === "string" ? container.State : "unknown",
          status,
          health: healthMatch?.[1] ?? null,
          labels: stringRecord(container.Labels),
        },
      ];
    });
  }

  async resolveContainer(reference: string): Promise<DockerContainer> {
    const containers = await this.listContainers();
    const match = containers.find(
      (container) =>
        container.id === reference ||
        container.id.startsWith(reference) ||
        container.name === reference ||
        container.labels["com.docker.compose.service"] === reference,
    );
    if (!match) {
      throw new Error(`Docker container "${reference}" was not found`);
    }
    return match;
  }

  async restartContainer(reference: string): Promise<DockerContainer> {
    const container = await this.resolveContainer(reference);
    await this.request(
      `/containers/${encodeURIComponent(container.id)}/restart?t=30`,
      { method: "POST" },
      45_000,
    );
    return container;
  }

  async containerStats(reference: string): Promise<DockerContainerStats> {
    const response = await this.request(
      `/containers/${encodeURIComponent(reference)}/stats?stream=false`,
    );
    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new Error("Docker returned invalid container stats");
    }

    const cpuStats = nestedRecord(payload, "cpu_stats");
    const previousCpuStats = nestedRecord(payload, "precpu_stats");
    const cpuUsage = nestedRecord(cpuStats, "cpu_usage");
    const previousCpuUsage = nestedRecord(previousCpuStats, "cpu_usage");
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

    const memory = nestedRecord(payload, "memory_stats");
    const memoryBytes = numberAt(memory, "usage");
    const memoryLimit = numberAt(memory, "limit");
    const networks = nestedRecord(payload, "networks");
    let networkRxBytes = 0;
    let networkTxBytes = 0;
    for (const value of Object.values(networks)) {
      if (!isRecord(value)) continue;
      networkRxBytes += numberAt(value, "rx_bytes");
      networkTxBytes += numberAt(value, "tx_bytes");
    }

    return {
      cpuPercent,
      memoryBytes,
      memoryPercent: memoryLimit > 0 ? (memoryBytes / memoryLimit) * 100 : 0,
      networkRxBytes,
      networkTxBytes,
    };
  }

  private async createExec(
    containerReference: string,
    command: readonly string[],
    options: DockerExecOptions,
  ): Promise<string> {
    const container = await this.resolveContainer(containerReference);
    const response = await this.request(
      `/containers/${encodeURIComponent(container.id)}/exec`,
      {
        method: "POST",
        body: JSON.stringify({
          AttachStderr: true,
          AttachStdout: true,
          Cmd: command,
          ...(options.env ? { Env: options.env } : {}),
          Tty: false,
        }),
      },
      options.timeoutMs,
    );
    const payload: unknown = await response.json();
    if (!isRecord(payload) || typeof payload.Id !== "string") {
      throw new Error("Docker returned an invalid exec id");
    }
    return payload.Id;
  }

  private async startExec(
    execId: string,
    options: DockerExecOptions,
    onStdout: (chunk: Uint8Array) => void,
    captureStdout: boolean,
  ): Promise<{ stdout: Uint8Array[]; stderr: Uint8Array[] }> {
    const response = await this.request(
      `/exec/${encodeURIComponent(execId)}/start`,
      {
        method: "POST",
        body: JSON.stringify({ Detach: false, Tty: false }),
      },
      options.timeoutMs ?? 30 * 60 * 1_000,
    );
    if (!response.body) {
      throw new Error("Docker exec returned no output stream");
    }
    return consumeDockerStream(response.body, onStdout, captureStdout);
  }

  private async execExitCode(execId: string): Promise<number> {
    const response = await this.request(
      `/exec/${encodeURIComponent(execId)}/json`,
    );
    const payload: unknown = await response.json();
    if (!isRecord(payload) || typeof payload.ExitCode !== "number") {
      throw new Error("Docker returned an invalid exec status");
    }
    return payload.ExitCode;
  }

  async exec(
    containerReference: string,
    command: readonly string[],
    options: DockerExecOptions = {},
  ): Promise<DockerExecResult> {
    const execId = await this.createExec(containerReference, command, options);
    const { stdout, stderr } = await this.startExec(
      execId,
      options,
      () => undefined,
      true,
    );
    return {
      stdout: decodeTail(stdout, 64 * 1_024),
      stderr: decodeTail(stderr),
      exitCode: await this.execExitCode(execId),
    };
  }

  async execToFile(
    containerReference: string,
    command: readonly string[],
    outputPath: string,
    options: DockerExecOptions = {},
  ): Promise<{ bytesWritten: number; stderr: string; exitCode: number }> {
    const execId = await this.createExec(containerReference, command, options);
    const writer = Bun.file(outputPath).writer();
    let bytesWritten = 0;
    let streamResult: Awaited<ReturnType<typeof consumeDockerStream>>;
    try {
      streamResult = await this.startExec(
        execId,
        options,
        (chunk) => {
          bytesWritten += chunk.byteLength;
          writer.write(chunk);
        },
        false,
      );
    } finally {
      await writer.end();
    }
    return {
      bytesWritten,
      stderr: decodeTail(streamResult.stderr),
      exitCode: await this.execExitCode(execId),
    };
  }
}
