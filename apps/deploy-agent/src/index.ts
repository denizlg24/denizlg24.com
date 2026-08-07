import { BuildLogStore } from "./build-log";
import { agentConfigFromEnv } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { DockerClient } from "./docker";
import { spawnExec } from "./exec";
import { HealthService } from "./health";
import { createDeploymentRunner } from "./pipeline";
import { PortAllocator } from "./ports";
import { DeploymentQueue, type QueueLogger } from "./queue";
import { createAgentApp } from "./routes";
import { loopbackOnlyRouteManager } from "./run";

const VERSION = process.env.APP_VERSION ?? "dev";

const logger: QueueLogger = {
  info: (message, fields) =>
    console.log(JSON.stringify({ level: "info", message, ...fields })),
  error: (message, fields) =>
    console.error(JSON.stringify({ level: "error", message, ...fields })),
};

const config = agentConfigFromEnv();

const docker = new DockerClient({ socketPath: config.dockerSocket });
const controlPlane = new ControlPlaneClient({
  baseUrl: config.controlPlaneUrl,
  token: config.token,
});

const logs = new BuildLogStore({ root: config.logRoot });
const ports = new PortAllocator();

const queue = new DeploymentQueue({
  capacity: config.maxConcurrentBuilds,
  pollIntervalMs: config.claimPollMs,
  heartbeatIntervalMs: config.heartbeatMs,
  claim: () => controlPlane.claim(),
  report: (deploymentId, update) => controlPlane.report(deploymentId, update),
  runner: createDeploymentRunner({
    exec: spawnExec,
    logs,
    ports,
    // Day 4 swaps this for the Caddy admin-API client. Until then a deployment
    // is reachable on its loopback port only, which the build log records.
    routes: loopbackOnlyRouteManager(),
    buildRoot: config.buildRoot,
    envRoot: config.runEnvRoot,
    network: config.dockerNetwork,
    buildMemoryLimit: `${config.buildMemoryLimitMb}m`,
    drainMs: config.drainMs,
    healthPollMs: config.healthPollMs,
  }),
  logger,
});

const health = new HealthService({
  docker,
  dockerDataRoot: config.dockerDataRoot,
  version: VERSION,
  queue: () => queue.snapshot(),
});

const app = createAgentApp({ token: config.token, health, queue, logs });

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
