import { BuildLogStore } from "./build-log";
import { CaddyRouter } from "./caddy";
import { agentConfigFromEnv } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { DockerClient } from "./docker";
import { type Exec, spawnExec } from "./exec";
import { runGarbageCollection } from "./gc";
import { HealthService } from "./health";
import { createDeploymentRunner } from "./pipeline";
import { PortAllocator } from "./ports";
import { DeploymentQueue, type QueueLogger } from "./queue";
import { createAgentApp } from "./routes";
import { restartDeployment, teardownDeployment } from "./run";

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
const caddy = new CaddyRouter({
  statePath: config.caddyStatePath,
  adminUrl: config.caddyAdminUrl,
  listen: config.caddyListen,
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
    envRoot: config.runEnvRoot,
    network: config.dockerNetwork,
    buildMemoryLimit: `${config.buildMemoryLimitMb}m`,
    drainMs: config.drainMs,
    healthPollMs: config.healthPollMs,
    secrets: async (request, signal) => {
      const resolved = await controlPlane.env(request.deploymentId, signal);
      return { cloneToken: resolved.cloneToken, env: resolved.env };
    },
  }),
  logger,
});

const health = new HealthService({
  docker,
  dockerDataRoot: config.dockerDataRoot,
  version: VERSION,
  queue: () => queue.snapshot(),
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
  queue,
  logs,
  routes: () => caddy.routes(),
  teardown: (deploymentId) =>
    teardownDeployment({ deploymentId, exec, routes: caddy, ports }),
  restart: (deploymentId) =>
    restartDeployment({
      deploymentId,
      exec,
      port: routedPort(deploymentId),
      healthPollMs: config.healthPollMs,
    }),
  rehost: (deploymentId, hostnames) => caddy.rehost(deploymentId, hostnames),
  collectGarbage: (request) =>
    runGarbageCollection(request, {
      exec,
      buildRoot: config.buildRoot,
      logRoot: config.logRoot,
      cacheRoot: config.cacheRoot,
      dockerDataRoot: config.dockerDataRoot,
    }),
});

// Before the queue starts claiming: a build that finishes first would publish
// its route into a table that has not read the persisted one yet, and the
// resulting /load would drop every other live deployment.
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
