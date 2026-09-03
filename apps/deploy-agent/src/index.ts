import { mkdir } from "node:fs/promises";
import type { ResolvedBuilder } from "./build";
import { BuildLogStore } from "./build-log";
import { CaddyRouter } from "./caddy";
import { agentConfigFromEnv } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { DockerClient } from "./docker";
import { type Exec, spawnExec } from "./exec";
import { runGarbageCollection } from "./gc";
import { HealthService } from "./health";
import { HostMutationLock } from "./host-mutation-lock";
import { createDeploymentRunner } from "./pipeline";
import { PortAllocator } from "./ports";
import { DeploymentQueue, type QueueLogger } from "./queue";
import {
  assertRecoveryEnvironmentHmac,
  publishRecoveryImage,
} from "./recovery-image";
import { RequestLogStore } from "./request-log";
import { createAgentApp } from "./routes";
import {
  applyDeploymentEnv,
  restartDeployment,
  runDeployment,
  teardownDeployment,
} from "./run";
import { ForgeTelemetry } from "./telemetry";

const VERSION = process.env.APP_VERSION ?? "dev";

const logger: QueueLogger = {
  info: (message, fields) =>
    console.log(JSON.stringify({ level: "info", message, ...fields })),
  error: (message, fields) =>
    console.error(JSON.stringify({ level: "error", message, ...fields })),
};

const config = agentConfigFromEnv();

/**
 * `dockerSocket` is the authority for which daemon this agent drives, and that
 * has to hold for the CLI as much as for the API client below. An inherited
 * `DOCKER_HOST` — the ops socket-proxy, a dev shell, a compose file — otherwise
 * redirects every build and run at a daemon the config never named. A proxy
 * that only whitelists the ops endpoints then answers `docker buildx` with an
 * HTML 403, which surfaces as an unexplained "docker build failed".
 */
const exec: Exec = (options) =>
  spawnExec({
    ...options,
    env: { DOCKER_HOST: `unix://${config.dockerSocket}`, ...options.env },
  });

const docker = new DockerClient({ socketPath: config.dockerSocket });
const controlPlane = new ControlPlaneClient({
  baseUrl: config.controlPlaneUrl,
  token: config.token,
});

const logs = new BuildLogStore({ root: config.logRoot });
const ports = new PortAllocator();
const hostMutationLock = new HostMutationLock(config.hostMutationLockPath);
const withHostMutation = <T>(owner: string, operation: () => Promise<T>) =>
  hostMutationLock.run(owner, new AbortController().signal, operation);
const caddy = new CaddyRouter({
  statePath: config.caddyStatePath,
  adminUrl: config.caddyAdminUrl,
  listen: config.caddyListen,
  accessLogRoot: config.accessLogRoot,
  previewAuthUrl: new URL(
    "/api/forge-preview-auth",
    config.controlPlaneUrl,
  ).toString(),
  resolveDeploymentKinds: (deploymentIds) =>
    controlPlane.deploymentKinds(deploymentIds),
  logger,
});

const queue = new DeploymentQueue({
  capacity: config.maxConcurrentBuilds,
  pollIntervalMs: config.claimPollMs,
  heartbeatIntervalMs: config.heartbeatMs,
  claim: () => controlPlane.claim(),
  report: (deploymentId, update) => controlPlane.report(deploymentId, update),
  runner: createDeploymentRunner({
    exec,
    logs,
    ports,
    routes: caddy,
    buildRoot: config.buildRoot,
    cacheRoot: config.cacheRoot,
    buildxBuilder: config.buildxBuilder,
    buildkitEndpoint: config.buildkitEndpoint,
    serializeBunInstalls: config.serializeBunInstalls,
    scopeInstallCopy: config.scopeInstallCopy,
    network: config.dockerNetwork,
    buildMemoryLimit: `${config.buildMemoryLimitMb}m`,
    drainMs: config.drainMs,
    recoveryRegistryPrefix: config.recoveryRegistryPrefix,
    healthPollMs: config.healthPollMs,
    acquireHostMutationLock: (owner, signal) =>
      hostMutationLock.acquire(owner, signal),
    secrets: async (request, signal) => {
      const resolved = await controlPlane.env(request.deploymentId, signal);
      return { cloneToken: resolved.cloneToken, env: resolved.env };
    },
    moduleGraph: async (request, graph) => {
      // Decoration for the next push, never a reason to fail this build.
      await controlPlane
        .reportModuleGraph(request.deploymentId, graph)
        .catch((error: unknown) =>
          logger.error("module graph report failed", {
            deploymentId: request.deploymentId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    },
  }),
  logger,
});

const health = new HealthService({
  docker,
  dockerDataRoot: config.dockerDataRoot,
  buildDataRoot: config.buildRoot,
  version: VERSION,
  queue: () => queue.snapshot(),
  memoryHeadroomMb: config.memoryHeadroomMb,
  // Every build slot is reserved, not just the running one: the budget has to
  // hold when the queue is full, not only when it is idle.
  buildReserveMb: config.buildMemoryLimitMb * config.maxConcurrentBuilds,
});
const requestLogs = new RequestLogStore({ root: config.accessLogRoot });
const telemetry = new ForgeTelemetry({
  docker,
  health,
  requests: requestLogs,
});

/** The live routing table is the only honest source for a running port. */
function routedPort(deploymentId: string): number | null {
  const entry = caddy
    .routes()
    .find((route) => route.deploymentId === deploymentId);
  const port = Number(entry?.upstream.split(":").at(-1));
  return Number.isInteger(port) && port > 0 ? port : null;
}

const app = createAgentApp({
  token: config.token,
  health,
  telemetry,
  queue,
  logs,
  routes: () => caddy.routes(),
  teardown: (deploymentId) =>
    withHostMutation(`teardown:${deploymentId}`, () =>
      teardownDeployment({ deploymentId, exec, routes: caddy, ports }),
    ),
  restart: (deploymentId) =>
    withHostMutation(`restart:${deploymentId}`, () =>
      restartDeployment({
        deploymentId,
        exec,
        port: routedPort(deploymentId),
        healthPollMs: config.healthPollMs,
      }),
    ),
  applyEnv: (body) =>
    withHostMutation(`apply-env:${body.request.deploymentId}`, async () => {
      const deploymentId = body.request.deploymentId;
      // The route table is the honest source for a running port, but a deployment
      // whose route was never published has none — the caller's recorded port is
      // the only thing left, and without either there is nothing to publish on.
      const port = routedPort(deploymentId) ?? body.port ?? null;
      if (port === null) {
        return {
          recreated: false,
          containerId: null,
          healthy: false,
          rolledBack: false,
          error: "No routed port for this deployment; redeploy it instead",
        };
      }
      // Fetched here rather than accepted in the body for the same reason the
      // build path does it: a request body is logged and retried, a secret set
      // should be neither.
      //
      // An unreachable control plane, or one answering a body the schema refuses,
      // is reported as an apply result rather than allowed to become a 500. The
      // route's contract is 200 or 409 with a structured result, and the cloud page
      // reads `error` to name which deployment failed.
      let resolved: Awaited<ReturnType<typeof controlPlane.env>>;
      try {
        resolved = await controlPlane.env(deploymentId);
      } catch (error) {
        return {
          recreated: false,
          containerId: null,
          healthy: false,
          rolledBack: false,
          error: `Could not resolve the environment: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      return applyDeploymentEnv({
        request: body.request,
        port,
        network: config.dockerNetwork,
        env: resolved.env,
        exec,
        healthPollMs: config.healthPollMs,
        note: (message) =>
          logger.info("env apply", { deploymentId, detail: message }),
      });
    }),
  recover: (body) =>
    withHostMutation(`recovery:${body.request.deploymentId}`, async () => {
      const deploymentId = body.request.deploymentId;
      const log = await logs.open(deploymentId);
      ports.reserve(body.port, deploymentId);
      try {
        const pulled = await exec({
          command: ["docker", "pull", body.imageReference],
          signal: new AbortController().signal,
          timeoutMs: 10 * 60_000,
        });
        if (pulled.exitCode !== 0) {
          throw new Error("digest-only recovery image pull failed");
        }
        const resolved = await controlPlane.env(deploymentId);
        assertRecoveryEnvironmentHmac(
          resolved.environmentHmacSha256,
          body.expectedEnvironmentHmacSha256,
        );
        const builder: ResolvedBuilder =
          body.request.build.builder === "nixpacks" ? "nixpacks" : "dockerfile";
        const outcome = await runDeployment({
          request: body.request,
          builder,
          imageTag: body.imageReference,
          port: body.port,
          log,
          signal: new AbortController().signal,
          exec,
          routes: caddy,
          network: config.dockerNetwork,
          env: resolved.env,
          healthPollMs: config.healthPollMs,
        });
        return {
          restored: true,
          containerId: outcome.containerId,
          port: outcome.port,
          imageReference: body.imageReference,
          environmentHmacSha256: resolved.environmentHmacSha256,
          error: null,
        };
      } catch (error) {
        ports.releaseOwner(deploymentId);
        return {
          restored: false,
          containerId: null,
          port: null,
          imageReference: body.imageReference,
          environmentHmacSha256: null,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await logs.close(deploymentId).catch(() => {});
      }
    }),
  publishRecovery: (body) =>
    withHostMutation(
      `publish-recovery:${body.request.deploymentId}`,
      async () => {
        const log = await logs.open(body.request.deploymentId);
        try {
          const published = await publishRecoveryImage({
            exec,
            log,
            request: body.request,
            localImage: body.localImage,
            registryPrefix: config.recoveryRegistryPrefix,
            signal: new AbortController().signal,
          });
          return { reference: published.reference, digest: published.digest };
        } finally {
          await logs.close(body.request.deploymentId).catch(() => {});
        }
      },
    ),
  rehost: (deploymentId, hostnames, options) =>
    withHostMutation(`rehost:${deploymentId}`, () =>
      caddy.rehost(deploymentId, hostnames, options),
    ),
  collectGarbage: (request) =>
    withHostMutation("garbage-collection", () =>
      runGarbageCollection(request, {
        exec,
        buildRoot: config.buildRoot,
        logRoot: config.logRoot,
        accessLogRoot: config.accessLogRoot,
        cacheRoot: config.cacheRoot,
        dockerDataRoot: config.dockerDataRoot,
        buildDataRoot: config.buildRoot,
        buildxBuilder: config.buildxBuilder,
        acquireBuilderMaintenance: () => queue.tryAcquireBuildMaintenance(),
      }),
    ),
});

// Caddy opens the access-log files but will not create the directory holding
// them, and a logger it cannot open makes Caddy reject the *entire* config — so
// without this directory the next publish installs no servers at all. The
// router's own fallback catches that and republishes without logging, which keeps
// routing up; this is what stops it needing to. Before `caddy.restore()` below,
// which is the first publish of the process.
//
// `forge-agent-install` also creates it as root, so this is the second line of
// defence rather than the only one.
await mkdir(config.accessLogRoot, { recursive: true, mode: 0o750 }).catch(
  (error: unknown) => {
    logger.error("could not create the access log directory", {
      path: config.accessLogRoot,
      error: error instanceof Error ? error.message : String(error),
    });
  },
);

// Before the queue starts claiming: a build that finishes first would publish
// its route into a table that has not read the persisted one yet, and the
// resulting /load would drop every other live deployment.
// This only reads the persisted route authority and republishes it to Caddy;
// it does not change the state archived by DR. It also has to complete while a
// release workflow still holds the mutation fence and waits for /healthz.
const restored = await caddy.restore().catch((error: unknown) => {
  logger.error("could not restore the Caddy config", {
    error: error instanceof Error ? error.message : String(error),
  });
  return 0;
});
if (restored > 0) logger.info("restored routes", { count: restored });

queue.start();

const server = Bun.serve({
  fetch: app.fetch,
  hostname: config.bindAddress,
  port: config.port,
  // Build logs stream for as long as a build runs; the default idle timeout
  // would cut them off mid-build.
  idleTimeout: 0,
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await queue.stop();
  await server.stop(true);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

logger.info("agent listening", {
  address: `${server.hostname}:${server.port}`,
  capacity: config.maxConcurrentBuilds,
  controlPlane: config.controlPlaneUrl,
});
