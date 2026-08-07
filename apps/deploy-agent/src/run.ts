import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  envRoot: string;
  network: string;
  runEnv?: Record<string, string>;
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

export function containerNameFor(deploymentId: string): string {
  return `dpl-${deploymentId}`;
}

/**
 * `docker --env-file` parses `KEY=VALUE` lines and nothing else — no quoting,
 * no continuations. A value with a newline in it silently becomes two broken
 * entries, so it is refused here instead.
 */
export function renderEnvFile(env: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new RunError(`Environment key is not a valid identifier: ${key}`);
    }
    if (/[\n\r\0]/.test(value)) {
      throw new RunError(
        `Environment value for ${key} contains a newline, which docker --env-file cannot represent`,
      );
    }
    lines.push(`${key}=${value}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
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
    "request" | "builder" | "imageTag" | "exec" | "signal" | "log"
  >,
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

async function containerRunning(
  exec: Exec,
  name: string,
  signal: AbortSignal,
): Promise<boolean> {
  const result = await exec({
    command: ["docker", "inspect", "--format", "{{.State.Running}}", name],
    signal,
    timeoutMs: 15_000,
  });
  return result.exitCode === 0 && result.stdout.trim() === "true";
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

export async function startContainer(options: RunOptions): Promise<RunOutcome> {
  const { request, exec, signal, log } = options;
  const name = containerNameFor(request.deploymentId);
  const containerPort = await resolveContainerPort(options);
  const memory = `${request.runtime.memoryLimitMb}m`;
  const envFile = join(options.envRoot, `${request.deploymentId}.env`);

  await mkdir(options.envRoot, { recursive: true });
  await rm(envFile, { force: true });
  await writeFile(envFile, renderEnvFile(options.runEnv ?? {}), {
    mode: 0o600,
    flag: "wx",
  });

  let containerId: string;
  try {
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
      command: [
        "docker",
        "run",
        "--detach",
        "--name",
        name,
        "--network",
        options.network,
        "--restart",
        "unless-stopped",
        "--memory",
        memory,
        "--memory-swap",
        memory,
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
        "--env-file",
        envFile,
        "--env",
        `PORT=${containerPort}`,
        "--publish",
        `127.0.0.1:${options.port}:${containerPort}`,
        "--label",
        `forge.deployment=${request.deploymentId}`,
        "--label",
        `forge.project=${request.projectSlug}`,
        "--label",
        `forge.target=${request.targetId}`,
        "--label",
        `forge.kind=${request.kind}`,
        options.imageTag,
        // Run-time only, and only here: on the nixpacks path the same string
        // was already passed as `--start-cmd` at build time, and repeating it
        // as an argument would be handed to an entrypoint that does not want it.
        ...(options.builder === "dockerfile" && request.build.startCommand
          ? ["sh", "-c", request.build.startCommand]
          : []),
      ],
      signal,
      timeoutMs: 120_000,
    });
    containerId = created.stdout.trim().slice(0, 64);
  } finally {
    // The resolved env set is the most sensitive thing this box holds. It is on
    // disk for the length of one `docker run` and no longer.
    await rm(envFile, { force: true }).catch(() => {});
  }

  return {
    containerId,
    containerName: name,
    port: options.port,
    containerPort,
  };
}

/**
 * Any status under 500 passes. Requiring 200 breaks every app whose root is a
 * redirect and every API-only surface whose root is a 404 — and a 404 from the
 * app is still proof that the app is listening, which is the entire question.
 */
export async function awaitHealthy(
  options: RunOptions,
  outcome: RunOutcome,
): Promise<void> {
  const probe = options.healthProbe ?? fetchHealthProbe;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const pollMs = options.healthPollMs ?? 2_000;
  const url = healthUrl(outcome.port, options.request.runtime.healthPath);
  const deadline = now() + options.request.timeouts.healthMs;

  options.log.note(`health check ${url}`);
  let lastStatus: number | null = null;

  while (now() < deadline) {
    if (options.signal.aborted) throw new RunError("Deployment cancelled");

    const status = await probe(url, options.signal);
    if (status !== null && status < 500) {
      options.log.note(`healthy (HTTP ${status})`);
      return;
    }
    lastStatus = status;

    if (
      !(await containerRunning(
        options.exec,
        outcome.containerName,
        options.signal,
      ))
    ) {
      throw new RunError("Container exited before it became healthy");
    }
    await sleep(pollMs);
  }

  throw new RunError(
    lastStatus === null
      ? `Health check did not answer within ${Math.round(options.request.timeouts.healthMs / 1_000)}s`
      : `Health check kept answering HTTP ${lastStatus} for ${Math.round(options.request.timeouts.healthMs / 1_000)}s`,
  );
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
