import { z } from "zod";
import {
  type CommandRunner,
  type ExecResult,
  runCommand,
  type StreamingProcess,
  type StreamSpawner,
  spawnStream,
} from "./exec";

/** Every run container carries it; boot recovery finds runs by it alone. */
export const RUN_LABEL = "agent-runner.run";

export interface Mount {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface ContainerSpec {
  name?: string;
  image: string;
  runtime: string;
  network: string;
  user: string;
  labels?: Record<string, string>;
  memory?: string;
  memorySwap?: string;
  cpus?: number;
  pidsLimit?: number;
  readOnly?: boolean;
  tmpfs?: string[];
  capAdd?: string[];
  mounts?: Mount[];
  workdir?: string;
  /** Read by the docker CLI on the host, so secrets never appear in argv. */
  envFile?: string;
  env?: Record<string, string>;
  entrypoint?: string;
  command: string[];
  detach?: boolean;
  remove?: boolean;
  interactive?: boolean;
}

/** `docker run` argv for a spec. Every container drops every capability first. */
export function runArgs(spec: ContainerSpec): string[] {
  const args = ["run"];
  if (spec.detach) args.push("--detach");
  if (spec.remove) args.push("--rm");
  if (spec.interactive) args.push("--interactive");
  if (spec.name) args.push("--name", spec.name);
  for (const [key, value] of Object.entries(spec.labels ?? {})) {
    args.push("--label", `${key}=${value}`);
  }
  args.push("--runtime", spec.runtime, "--network", spec.network);
  if (spec.memory) args.push("--memory", spec.memory);
  if (spec.memorySwap) args.push("--memory-swap", spec.memorySwap);
  if (spec.cpus) args.push("--cpus", String(spec.cpus));
  if (spec.pidsLimit) args.push("--pids-limit", String(spec.pidsLimit));
  if (spec.readOnly) args.push("--read-only");
  for (const tmpfs of spec.tmpfs ?? []) args.push("--tmpfs", tmpfs);
  args.push("--user", spec.user, "--cap-drop", "ALL");
  for (const cap of spec.capAdd ?? []) args.push("--cap-add", cap);
  args.push("--security-opt", "no-new-privileges");
  for (const mount of spec.mounts ?? []) {
    args.push(
      "--volume",
      `${mount.source}:${mount.target}${mount.readOnly ? ":ro" : ""}`,
    );
  }
  if (spec.workdir) args.push("--workdir", spec.workdir);
  if (spec.envFile) args.push("--env-file", spec.envFile);
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    args.push("--env", `${key}=${value}`);
  }
  if (spec.entrypoint) args.push("--entrypoint", spec.entrypoint);
  args.push(spec.image, ...spec.command);
  return args;
}

export interface RunContainer {
  id: string;
  name: string;
  runId: string;
  state: string;
}

const psLineSchema = z.object({
  ID: z.string(),
  Names: z.string(),
  State: z.string(),
  Labels: z.string(),
});

export function parseLabels(labels: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of labels.split(",")) {
    const index = pair.indexOf("=");
    if (index > 0) result[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return result;
}

export function parseRunContainers(psOutput: string): RunContainer[] {
  const containers: RunContainer[] = [];
  for (const line of psOutput.split("\n")) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = psLineSchema.safeParse(json);
    if (!parsed.success) continue;
    const runId = parseLabels(parsed.data.Labels)[RUN_LABEL];
    if (!runId) continue;
    containers.push({
      id: parsed.data.ID,
      name: parsed.data.Names,
      runId,
      state: parsed.data.State,
    });
  }
  return containers;
}

export class DockerError extends Error {
  constructor(
    message: string,
    readonly result: ExecResult,
  ) {
    super(message);
  }
}

/**
 * The docker CLI against the rootless sandbox daemon. `DOCKER_HOST` comes
 * from the unit (the unix socket), never the daemon's TCP listener.
 */
export class Docker {
  constructor(
    private readonly exec: CommandRunner = runCommand,
    private readonly spawn: StreamSpawner = spawnStream,
    private readonly binary = "docker",
  ) {}

  async #run(
    args: string[],
    options?: { stdin?: string; timeoutMs?: number },
  ): Promise<ExecResult> {
    return this.exec([this.binary, ...args], options);
  }

  async #ok(args: string[], what: string): Promise<string> {
    const result = await this.#run(args, { timeoutMs: 120_000 });
    if (result.exitCode !== 0) {
      throw new DockerError(
        `${what}: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
        result,
      );
    }
    return result.stdout.trim();
  }

  runtimes(): Promise<string> {
    return this.#ok(["info", "--format", "{{json .Runtimes}}"], "docker info");
  }

  runDetached(spec: ContainerSpec): Promise<string> {
    return this.#ok(runArgs({ ...spec, detach: true }), "docker run");
  }

  /** A one-shot helper container; the caller reads its exit code. */
  runOnce(
    spec: ContainerSpec,
    options: { stdin?: string; timeoutMs?: number } = {},
  ): Promise<ExecResult> {
    return this.#run(
      runArgs({
        ...spec,
        remove: true,
        interactive: options.stdin !== undefined,
      }),
      { timeoutMs: options.timeoutMs ?? 10 * 60_000, stdin: options.stdin },
    );
  }

  async stop(name: string, graceSeconds: number): Promise<void> {
    await this.#run(["stop", "--time", String(graceSeconds), name], {
      timeoutMs: (graceSeconds + 30) * 1000,
    });
  }

  async kill(name: string): Promise<void> {
    await this.#run(["kill", name], { timeoutMs: 30_000 });
  }

  async remove(name: string): Promise<void> {
    await this.#run(["rm", "--force", name], { timeoutMs: 60_000 });
  }

  /**
   * Blocks until the container exits; its exit code. The caller bounds it by
   * the run's deadline, not a fixed CLI timeout: runs last far longer than
   * any command here.
   */
  async wait(
    name: string,
    options: { timeoutMs?: number } = {},
  ): Promise<number> {
    const result = await this.#run(["wait", name], options);
    if (result.timedOut) {
      throw new DockerError(
        "docker wait outlived the run's deadline; the container did not stop",
        result,
      );
    }
    if (result.exitCode !== 0) {
      throw new DockerError(
        `docker wait: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
        result,
      );
    }
    const code = Number(result.stdout.trim().split("\n").at(-1));
    return Number.isFinite(code) ? code : -1;
  }

  /** Every line the container has written, then everything it writes next. */
  logs(name: string): StreamingProcess {
    return this.spawn([this.binary, "logs", "--follow", name]);
  }

  async listRuns(): Promise<RunContainer[]> {
    const output = await this.#ok(
      [
        "ps",
        "--all",
        "--no-trunc",
        "--filter",
        `label=${RUN_LABEL}`,
        "--format",
        "{{json .}}",
      ],
      "docker ps",
    );
    return parseRunContainers(output);
  }

  async state(name: string): Promise<string | null> {
    const result = await this.#run(
      ["inspect", "--format", "{{.State.Status}}", name],
      { timeoutMs: 30_000 },
    );
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  async networkExists(name: string): Promise<boolean> {
    const result = await this.#run(["network", "inspect", name], {
      timeoutMs: 30_000,
    });
    return result.exitCode === 0;
  }

  async createNetwork(name: string, bridge: string): Promise<void> {
    await this.#ok(
      [
        "network",
        "create",
        "--driver",
        "bridge",
        "--opt",
        `com.docker.network.bridge.name=${bridge}`,
        "--ipv6=false",
        name,
      ],
      "docker network create",
    );
  }
}
