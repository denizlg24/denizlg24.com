import type {
  AgentDeploymentRequest,
  DeploymentPhase,
} from "@repo/schemas/cloud";
import type { ResolvedBuilder } from "./build";
import type { BuildLog } from "./build-log";
import { type Exec, execOrThrow } from "./exec";

export const DEFAULT_CONTAINER_PORT = 3_000;

export interface DeploymentRoute {
  deploymentId: string;
  projectSlug: string;
  hostname: string;
  port: number;
}

export interface RouteManager {
  publish(route: DeploymentRoute): Promise<void>;
  withdraw(deploymentId: string): Promise<void>;
}

/**
 * Routes nothing. `CaddyRouter` is the real implementation; this exists so a
 * deployment can be run without a Caddy to talk to — the build log always
 * records the loopback port, so the container is still reachable.
 */
export function loopbackOnlyRouteManager(): RouteManager {
  return {
    publish: async () => {},
    withdraw: async () => {},
  };
}

export type HealthProbe = (
  url: string,
  signal: AbortSignal,
) => Promise<number | null>;

export const fetchHealthProbe: HealthProbe = async (url, signal) => {
  try {
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      headers: { "user-agent": "forge-agent/health" },
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
};

export interface RunOptions {
  request: AgentDeploymentRequest;
  builder: ResolvedBuilder;
  imageTag: string;
  port: number;
  log: BuildLog;
  signal: AbortSignal;
  exec: Exec;
  routes: RouteManager;
  network: string;
  env?: Record<string, string>;
  onPhase?: (phase: DeploymentPhase) => Promise<void>;
  healthProbe?: HealthProbe;
  healthPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RunOutcome {
  containerId: string;
  containerName: string;
  port: number;
  containerPort: number;
}

export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunError";
  }
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The only env the platform injects, and it is added here rather than by the
 * control plane because it is run-time only: `NODE_ENV=production` during a
 * build makes an install step skip devDependencies, and the build then fails on
 * a missing compiler — a failure that reads as a broken repository rather than
 * as an env var the platform set behind your back. The deployment's own vars
 * are spread over these, so setting either explicitly still wins, and `PORT` is
 * passed again as a `--env` flag once the container port is known.
 */
export const RUN_DEFAULT_ENV: Readonly<Record<string, string>> = {
  PORT: "3000",
  NODE_ENV: "production",
};

export function containerNameFor(deploymentId: string): string {
  return `dpl-${deploymentId}`;
}

/**
 * One `--env KEY=VALUE` argv entry per variable, rather than the `--env-file`
 * this used to write.
 *
 * argv is a list of byte strings with no line structure, and `spawnExec` never
 * goes through a shell, so a value carrying a newline, a quote, a `$` or a `#`
 * reaches the container exactly as it was stored. `docker --env-file` parses
 * `KEY=VALUE` lines and nothing else: it could not represent a newline at all,
 * so the only safe thing available was to refuse the deployment — which is how
 * a PEM key or a service-account JSON used to fail *after* its build had
 * already succeeded, while the same value had passed the build fine as a
 * `--build-arg`.
 *
 * The cost is that values are now visible in `ps` on the Forge host. They were
 * already readable there via `docker inspect`, and the host runs nothing but
 * this agent and the containers it starts.
 */
export function renderEnvArgs(env: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new RunError(`Environment key is not a valid identifier: ${key}`);
    }
    args.push("--env", `${key}=${value}`);
  }
  return args;
}

export function healthUrl(port: number, healthPath: string): string {
  const path = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
  return `http://127.0.0.1:${port}${path}`;
}

/**
 * The image's own `EXPOSE` is the only honest source for a Dockerfile build.
 * A wrong guess presents as a 90-second health timeout with a container that is
 * perfectly healthy, so the resolved value is logged and reported either way.
 */
export async function resolveContainerPort(
  options: Pick<
    RunOptions,
    "request" | "builder" | "imageTag" | "exec" | "signal"
  > & { log: Pick<BuildLog, "note"> },
): Promise<number> {
  const declared = options.request.runtime.containerPort;
  if (declared) return declared;
  // Nixpacks images carry no EXPOSE, but we built them with PORT=3000 set, so
  // there is nothing to discover and nothing worth warning about.
  if (options.builder === "nixpacks") return DEFAULT_CONTAINER_PORT;

  try {
    const result = await execOrThrow(options.exec, "docker image inspect", {
      command: [
        "docker",
        "image",
        "inspect",
        options.imageTag,
        "--format",
        "{{json .Config.ExposedPorts}}",
      ],
      signal: options.signal,
      timeoutMs: 30_000,
    });
    const parsed: unknown = JSON.parse(result.stdout.trim() || "null");
    if (parsed !== null && typeof parsed === "object") {
      const tcp = Object.keys(parsed)
        .filter((key) => key.endsWith("/tcp"))
        .map((key) => Number.parseInt(key.slice(0, key.indexOf("/")), 10))
        .filter((port) => Number.isInteger(port) && port > 0)
        .sort((a, b) => a - b);
      if (tcp[0] !== undefined) return tcp[0];
    }
  } catch {
    // Fall through to the default; an image we cannot inspect is still worth
    // trying on 3000, and the log records that we guessed.
  }
  options.log.note(
    `image exposes no port; assuming ${DEFAULT_CONTAINER_PORT} (set containerPort to pin it)`,
  );
  return DEFAULT_CONTAINER_PORT;
}

export interface ContainerState {
  running: boolean;
  /** The cgroup killed it for exceeding `--memory`. */
  oomKilled: boolean;
  exitCode: number | null;
}

/**
 * Running, plus why it is not.
 *
 * `OOMKilled` is the field worth the extra parsing: a container over its
 * ceiling is killed with SIGKILL and exits 137, which is indistinguishable from
 * any other hard stop unless this is read. Reporting it as "exited before it
 * became healthy" sends you to the application logs for a limit problem, and
 * the logs show nothing because the process was never told anything.
 */
async function containerState(
  exec: Exec,
  name: string,
  signal: AbortSignal,
): Promise<ContainerState> {
  const result = await exec({
    command: [
      "docker",
      "inspect",
      "--format",
      "{{.State.Running}} {{.State.OOMKilled}} {{.State.ExitCode}}",
      name,
    ],
    signal,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0) {
    return { running: false, oomKilled: false, exitCode: null };
  }
  const [running, oomKilled, exitCode] = result.stdout.trim().split(/\s+/);
  return {
    running: running === "true",
    oomKilled: oomKilled === "true",
    exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : null,
  };
}

async function captureContainerLogs(
  options: RunOptions,
  name: string,
): Promise<void> {
  const result = await options.exec({
    command: ["docker", "logs", "--tail", "200", name],
    timeoutMs: 30_000,
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  options.log.note(`container logs (last 200 lines):`);
  options.log.write(output.length > 0 ? `${output}\n` : "(no output)\n");
}

/**
 * Every flag `docker run` needs, as one array.
 *
 * Split out from `startContainer` because applying an env change recreates the
 * container, and it has to be recreated with *these* flags — a container that
 * came back with a different memory ceiling or no `--restart` policy because a
 * second argv drifted from this one would be a much harder failure to see than
 * a missing variable.
 */
export function containerCreateArgs(options: {
  request: AgentDeploymentRequest;
  imageTag: string;
  port: number;
  containerPort: number;
  network: string;
  env?: Record<string, string>;
  name?: string;
  /**
   * Appended after the image, overriding its `CMD`. Empty leaves the image's own
   * command in place — which is what every nixpacks build wants, because the
   * start command was already baked in at build time as `--start-cmd`.
   */
  command?: readonly string[];
}): string[] {
  const { request } = options;
  const memory = `${request.runtime.memoryLimitMb}m`;
  return [
    "docker",
    "run",
    "--detach",
    "--name",
    options.name ?? containerNameFor(request.deploymentId),
    "--network",
    options.network,
    "--restart",
    "unless-stopped",
    // The hard ceiling. Equal to --memory-swap so swap stays off: on this
    // host a container thrashing swap degrades every other container and
    // the tunnel with it, which is worse than one clean kill.
    "--memory",
    memory,
    "--memory-swap",
    memory,
    // The soft limit (memory.low). Under host pressure the kernel reclaims
    // from containers above their reservation first, so an app inside its
    // planned working set is the last to be squeezed. This is what makes
    // the gap up to --memory usable rather than theoretical.
    "--memory-reservation",
    `${request.runtime.memoryReservationMb}m`,
    // When the host itself runs out, the kernel picks a victim by badness
    // score and would happily choose dockerd, this agent, or Caddy —
    // killing Caddy takes every deployment down at once. A positive
    // adjustment makes a deployed app always the cheaper target.
    "--oom-score-adj",
    "500",
    "--cpus",
    String(request.runtime.cpuLimit),
    "--pids-limit",
    "512",
    "--security-opt",
    "no-new-privileges",
    "--log-opt",
    "max-size=10m",
    "--log-opt",
    "max-file=3",
    ...renderEnvArgs({ ...RUN_DEFAULT_ENV, ...options.env }),
    // After the deployment's own vars, so the resolved container port wins over
    // anything stored under the same name.
    "--env",
    `PORT=${options.containerPort}`,
    "--publish",
    `127.0.0.1:${options.port}:${options.containerPort}`,
    "--label",
    `forge.deployment=${request.deploymentId}`,
    "--label",
    `forge.project=${request.projectSlug}`,
    "--label",
    `forge.target=${request.targetId}`,
    "--label",
    `forge.kind=${request.kind}`,
    options.imageTag,
    ...(options.command ?? []),
  ];
}

/**
 * Run-time only, and only on the dockerfile path: on the nixpacks path the same
 * string was already passed as `--start-cmd` at build time, and repeating it as
 * an argument would be handed to an entrypoint that does not want it.
 */
export function startCommandArgs(
  request: AgentDeploymentRequest,
  builder: ResolvedBuilder,
): string[] {
  return builder === "dockerfile" && request.build.startCommand
    ? ["sh", "-c", request.build.startCommand]
    : [];
}

export async function startContainer(options: RunOptions): Promise<RunOutcome> {
  const { request, exec, signal, log } = options;
  const name = containerNameFor(request.deploymentId);
  const containerPort = await resolveContainerPort(options);

  // A name left behind by an interrupted run would fail the create with a
  // conflict that reads as a bug in the allocator.
  await exec({
    command: ["docker", "rm", "--force", name],
    signal,
    timeoutMs: 60_000,
  });

  log.note(
    `starting ${name} on 127.0.0.1:${options.port} → container port ${containerPort}`,
  );
  const created = await execOrThrow(exec, "docker run", {
    command: containerCreateArgs({
      request,
      imageTag: options.imageTag,
      port: options.port,
      containerPort,
      network: options.network,
      env: options.env,
      name,
      command: startCommandArgs(request, options.builder),
    }),
    signal,
    timeoutMs: 120_000,
  });

  return {
    containerId: created.stdout.trim().slice(0, 64),
    containerName: name,
    port: options.port,
    containerPort,
  };
}

/**
 * Any status under 500 passes. Requiring 200 breaks every app whose root is a
 * redirect and every API-only surface whose root is a 404 — and a 404 from the
 * app is still proof that the app is listening, which is the entire question.
 *
 * Shared with the env-apply recreate: a container that comes back on new
 * variables has to be gated exactly as hard as one that comes back on a new
 * image, including the OOM case, or applying an env change becomes the one way
 * to put an unhealthy container into the routing table.
 */
async function gateOnHealth(options: {
  exec: Exec;
  containerName: string;
  url: string;
  timeoutMs: number;
  memoryLimitMb: number;
  signal: AbortSignal;
  probe: HealthProbe;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  pollMs: number;
  note: (message: string) => void;
  cancelledMessage: string;
}): Promise<void> {
  const deadline = options.now() + options.timeoutMs;
  const seconds = Math.round(options.timeoutMs / 1_000);
  options.note(`health check ${options.url}`);
  let lastStatus: number | null = null;

  while (options.now() < deadline) {
    if (options.signal.aborted) throw new RunError(options.cancelledMessage);

    const status = await options.probe(options.url, options.signal);
    if (status !== null && status < 500) {
      options.note(`healthy (HTTP ${status})`);
      return;
    }
    lastStatus = status;

    const state = await containerState(
      options.exec,
      options.containerName,
      options.signal,
    );
    if (!state.running) {
      throw new RunError(
        state.oomKilled
          ? `Container exceeded its ${options.memoryLimitMb} MB memory ceiling and was killed`
          : "Container exited before it became healthy",
      );
    }
    await options.sleep(options.pollMs);
  }

  throw new RunError(
    lastStatus === null
      ? `Health check did not answer within ${seconds}s`
      : `Health check kept answering HTTP ${lastStatus} for ${seconds}s`,
  );
}

export async function awaitHealthy(
  options: RunOptions,
  outcome: RunOutcome,
): Promise<void> {
  await gateOnHealth({
    exec: options.exec,
    containerName: outcome.containerName,
    url: healthUrl(outcome.port, options.request.runtime.healthPath),
    timeoutMs: options.request.timeouts.healthMs,
    memoryLimitMb: options.request.runtime.memoryLimitMb,
    signal: options.signal,
    probe: options.healthProbe ?? fetchHealthProbe,
    sleep:
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    now: options.now ?? Date.now,
    pollMs: options.healthPollMs ?? 2_000,
    note: (message) => options.log.note(message),
    cancelledMessage: "Deployment cancelled",
  });
}

export interface ReapOptions {
  exec: Exec;
  log: BuildLog;
  targetId: string;
  kind: string;
  keepDeploymentId: string;
  drainMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Production only. Preview hostnames are unique per deployment, so reaping by
 * target there would kill another branch's live preview; those are the GC
 * pass's business (§7.2).
 */
export async function reapSuperseded(
  options: ReapOptions,
): Promise<{ deploymentId: string; containerId: string }[]> {
  if (options.kind !== "production") return [];

  const listed = await options.exec({
    command: [
      "docker",
      "ps",
      "--no-trunc",
      "--filter",
      `label=forge.target=${options.targetId}`,
      "--filter",
      `label=forge.kind=production`,
      "--format",
      '{{.ID}}\t{{.Label "forge.deployment"}}',
    ],
    signal: options.signal,
    timeoutMs: 30_000,
  });
  if (listed.exitCode !== 0) {
    options.log.note(
      "could not list superseded containers; leaving them running",
    );
    return [];
  }

  const stale = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [containerId = "", deploymentId = ""] = line.split("\t");
      return { containerId, deploymentId };
    })
    .filter(
      (entry) =>
        entry.containerId.length > 0 &&
        entry.deploymentId !== options.keepDeploymentId,
    );

  if (stale.length === 0) return [];

  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // The route already points at the new container; this is the window in which
  // requests already accepted by the old one finish.
  await sleep(options.drainMs);

  const reaped: { deploymentId: string; containerId: string }[] = [];
  for (const entry of stale) {
    const stopped = await options.exec({
      command: ["docker", "stop", "--time", "10", entry.containerId],
      timeoutMs: 60_000,
    });
    if (stopped.exitCode !== 0) {
      options.log.note(
        `could not stop superseded container ${entry.containerId.slice(0, 12)}`,
      );
      continue;
    }
    await options.exec({
      command: ["docker", "rm", entry.containerId],
      timeoutMs: 60_000,
    });
    options.log.note(
      `reaped superseded container ${entry.containerId.slice(0, 12)}`,
    );
    reaped.push(entry);
  }
  return reaped;
}

export interface RestartOptions {
  deploymentId: string;
  exec: Exec;
  /** From the live route table, so a restart never guesses at the port. */
  port: number | null;
  healthPath?: string;
  healthTimeoutMs?: number;
  healthPollMs?: number;
  healthProbe?: HealthProbe;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RestartResult {
  restarted: boolean;
  healthy: boolean | null;
  error: string | null;
}

/**
 * No rebuild, and no route change — the container keeps its name, its port and
 * its place in the routing table, so a restart that comes back healthy is
 * invisible to Caddy. The health probe is advisory: a container that restarts
 * and then fails to listen is already serving 502s, and reporting that is more
 * use than pretending the restart failed.
 */
export async function restartDeployment(
  options: RestartOptions,
): Promise<RestartResult> {
  const name = containerNameFor(options.deploymentId);
  const restarted = await options.exec({
    command: ["docker", "restart", "--time", "10", name],
    signal: options.signal,
    timeoutMs: 120_000,
  });
  if (restarted.exitCode !== 0) {
    return {
      restarted: false,
      healthy: null,
      error:
        restarted.stderr.trim() ||
        `docker restart exited ${restarted.exitCode}`,
    };
  }
  if (options.port === null) {
    return { restarted: true, healthy: null, error: null };
  }

  const probe = options.healthProbe ?? fetchHealthProbe;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const url = healthUrl(options.port, options.healthPath ?? "/");
  const deadline = now() + (options.healthTimeoutMs ?? 90_000);
  const signal = options.signal ?? new AbortController().signal;

  while (now() < deadline) {
    const status = await probe(url, signal);
    if (status !== null && status < 500) {
      return { restarted: true, healthy: true, error: null };
    }
    await sleep(options.healthPollMs ?? 2_000);
  }
  return {
    restarted: true,
    healthy: false,
    error: "Container restarted but did not answer the health check",
  };
}

export interface ApplyEnvOptions {
  request: AgentDeploymentRequest;
  /** From the live route table, so the replacement keeps its place in Caddy. */
  port: number;
  network: string;
  env: Record<string, string>;
  exec: Exec;
  signal?: AbortSignal;
  healthProbe?: HealthProbe;
  healthPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  note?: (message: string) => void;
}

interface ContainerSpec {
  imageTag: string;
  containerPort: number;
  command: string[];
}

/**
 * What the running container was created with, read back off the container
 * itself.
 *
 * The alternative — re-deriving it from the deployment request — cannot work
 * here. `resolveBuilder` decides between a Dockerfile and nixpacks by probing
 * the checked-out repository, and GC deletes that checkout after two hours, so
 * by the time anyone edits a variable the evidence is gone. Guessing from
 * `build.dockerfilePath` alone gets the `builder: "auto"` case wrong, and the
 * cost of getting it wrong is a container that comes back running the image's
 * default command instead of its configured start command.
 *
 * `.Config.Cmd` is exact whether it was overridden or inherited: re-passing an
 * inherited CMD produces the same entrypoint/CMD pairing docker would have used
 * anyway. `.HostConfig.PortBindings` carries the resolved container port as its
 * key, which is more reliable than inspecting the image a second time.
 */
async function inspectContainerSpec(
  exec: Exec,
  name: string,
  signal: AbortSignal,
): Promise<ContainerSpec | null> {
  const result = await exec({
    command: [
      "docker",
      "inspect",
      "--format",
      "{{json .Config.Image}}\t{{json .Config.Cmd}}\t{{json .HostConfig.PortBindings}}",
      name,
    ],
    signal,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) return null;

  const [rawImage = "", rawCmd = "", rawPorts = ""] = result.stdout
    .trim()
    .split("\t");
  let imageTag: unknown;
  let cmd: unknown;
  let ports: unknown;
  try {
    imageTag = JSON.parse(rawImage || "null");
    cmd = JSON.parse(rawCmd || "null");
    ports = JSON.parse(rawPorts || "null");
  } catch {
    return null;
  }
  if (typeof imageTag !== "string" || imageTag.length === 0) return null;

  const command = Array.isArray(cmd)
    ? cmd.filter((part): part is string => typeof part === "string")
    : [];
  const bindings =
    ports !== null && typeof ports === "object"
      ? Object.keys(ports)
          .map((key) => Number.parseInt(key.split("/")[0] ?? "", 10))
          .filter((port) => Number.isInteger(port) && port > 0)
      : [];
  const containerPort = bindings[0];
  if (containerPort === undefined) return null;

  return { imageTag, containerPort, command };
}

export interface ApplyEnvResult {
  recreated: boolean;
  containerId: string | null;
  healthy: boolean;
  /** The previous container is serving again because the new one failed. */
  rolledBack: boolean;
  error: string | null;
}

/**
 * Applies a changed environment by *recreating* the container.
 *
 * `docker restart` cannot do this and never could: a container's environment is
 * fixed when it is created, so stopping and starting the same container object
 * re-reads nothing. That is why the restart button appeared to work and changed
 * nothing.
 *
 * The old container is renamed aside rather than removed, because it is the only
 * rollback available — the replacement can fail its health check on a typo'd
 * variable, and the alternative to keeping it is an outage that lasts until
 * someone notices. It has to be stopped either way: both containers publish
 * `127.0.0.1:<port>`, so they cannot run at once.
 *
 * The port and the container name are unchanged throughout, so Caddy is never
 * touched and no route is republished.
 */
export async function applyDeploymentEnv(
  options: ApplyEnvOptions,
): Promise<ApplyEnvResult> {
  const { request, exec } = options;
  const signal = options.signal ?? new AbortController().signal;
  const note = options.note ?? (() => {});
  const name = containerNameFor(request.deploymentId);
  const previous = `${name}-prev`;

  // Read before anything moves: this is the only record of how the container was
  // created, and it has to survive the rename to be worth reading.
  const spec = await inspectContainerSpec(exec, name, signal);
  if (!spec) {
    return {
      recreated: false,
      containerId: null,
      healthy: false,
      rolledBack: false,
      error:
        "No container to recreate for this deployment; redeploy it instead of applying env",
    };
  }

  // A leftover from an attempt that died mid-flight would collide with the
  // rename below and strand this one before it started.
  await exec({
    command: ["docker", "rm", "--force", previous],
    signal,
    timeoutMs: 60_000,
  });

  const renamed = await exec({
    command: ["docker", "rename", name, previous],
    signal,
    timeoutMs: 30_000,
  });
  const hadPrevious = renamed.exitCode === 0;
  if (hadPrevious) {
    // Both containers publish the same loopback port, so the old one has to let
    // go of it before the new one can bind.
    await exec({
      command: ["docker", "stop", "--time", "10", previous],
      signal,
      timeoutMs: 120_000,
    });
  }

  const restorePrevious = async (): Promise<boolean> => {
    if (!hadPrevious) return false;
    await exec({
      command: ["docker", "rm", "--force", name],
      signal,
      timeoutMs: 60_000,
    });
    const back = await exec({
      command: ["docker", "rename", previous, name],
      signal,
      timeoutMs: 30_000,
    });
    if (back.exitCode !== 0) return false;
    const started = await exec({
      command: ["docker", "start", name],
      signal,
      timeoutMs: 120_000,
    });
    return started.exitCode === 0;
  };

  try {
    note(
      `recreating ${name} on 127.0.0.1:${options.port} → container port ${spec.containerPort}`,
    );
    const created = await execOrThrow(exec, "docker run", {
      command: containerCreateArgs({
        request,
        imageTag: spec.imageTag,
        port: options.port,
        containerPort: spec.containerPort,
        network: options.network,
        env: options.env,
        name,
        command: spec.command,
      }),
      signal,
      timeoutMs: 120_000,
    });
    const containerId = created.stdout.trim().slice(0, 64);

    await gateOnHealth({
      exec,
      containerName: name,
      url: healthUrl(options.port, request.runtime.healthPath),
      timeoutMs: request.timeouts.healthMs,
      memoryLimitMb: request.runtime.memoryLimitMb,
      signal,
      probe: options.healthProbe ?? fetchHealthProbe,
      sleep:
        options.sleep ??
        ((ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms))),
      now: options.now ?? Date.now,
      pollMs: options.healthPollMs ?? 2_000,
      note,
      cancelledMessage: "Environment apply cancelled",
    });

    if (hadPrevious) {
      await exec({
        command: ["docker", "rm", "--force", previous],
        signal,
        timeoutMs: 60_000,
      });
    }
    return {
      recreated: true,
      containerId,
      healthy: true,
      rolledBack: false,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    note(`env apply failed: ${message}`);
    const rolledBack = await restorePrevious();
    return {
      recreated: false,
      containerId: null,
      healthy: false,
      rolledBack,
      error: rolledBack
        ? `${message}. The previous container was restored.`
        : hadPrevious
          ? `${message}. The previous container could not be restored.`
          : message,
    };
  }
}

export interface TeardownOptions {
  deploymentId: string;
  exec: Exec;
  routes: RouteManager;
  ports?: { releaseOwner: (owner: string) => void };
}

export interface TeardownResult {
  containerRemoved: boolean;
  imageRemoved: string | null;
}

/**
 * The route comes down before the container does — the other order serves 502s
 * for however long the removal takes. `forge/<slug>:latest` is never deleted:
 * it looks like a stale tag and it is the thing making the next build fast.
 */
export async function teardownDeployment(
  options: TeardownOptions,
): Promise<TeardownResult> {
  const { exec, deploymentId } = options;
  const name = containerNameFor(deploymentId);

  await options.routes.withdraw(deploymentId);

  const inspected = await exec({
    command: ["docker", "inspect", "--format", "{{.Config.Image}}", name],
    timeoutMs: 30_000,
  });
  const imageTag =
    inspected.exitCode === 0 ? inspected.stdout.trim() || null : null;

  const removed = await exec({
    command: ["docker", "rm", "--force", name],
    timeoutMs: 60_000,
  });
  options.ports?.releaseOwner(deploymentId);

  let imageRemoved: string | null = null;
  if (imageTag && !imageTag.endsWith(":latest")) {
    const deleted = await exec({
      command: ["docker", "rmi", imageTag],
      timeoutMs: 120_000,
    });
    // A refusal here is normal: another container may still be running this
    // image, and an image left behind is the GC pass's problem, not a failure.
    if (deleted.exitCode === 0) imageRemoved = imageTag;
  }

  return { containerRemoved: removed.exitCode === 0, imageRemoved };
}

export async function removeContainer(exec: Exec, name: string): Promise<void> {
  await exec({
    command: ["docker", "rm", "--force", name],
    timeoutMs: 60_000,
  });
}

/**
 * Start, gate, route. The failure branch is the whole reason the gate exists:
 * the new container is removed and the one currently serving the hostname is
 * left exactly as it was, so a broken deploy cannot take the live site down.
 */
export async function runDeployment(options: RunOptions): Promise<RunOutcome> {
  await options.onPhase?.("starting");
  const outcome = await startContainer(options);
  try {
    await options.onPhase?.("health-check");
    await awaitHealthy(options, outcome);
  } catch (error) {
    await captureContainerLogs(options, outcome.containerName).catch(() => {});
    await removeContainer(options.exec, outcome.containerName).catch(() => {});
    throw error;
  }

  await options.onPhase?.("routing");
  options.log.note(
    `serving ${options.request.hostname} from 127.0.0.1:${outcome.port}`,
  );
  await options.routes.publish({
    deploymentId: options.request.deploymentId,
    projectSlug: options.request.projectSlug,
    hostname: options.request.hostname,
    port: outcome.port,
  });
  return outcome;
}
