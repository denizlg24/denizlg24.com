import { agentConfigFromEnv } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { DockerClient } from "./docker";
import { HealthService } from "./health";
import {
  DeploymentQueue,
  type DeploymentRunner,
  type QueueLogger,
} from "./queue";
import { createAgentApp } from "./routes";

const VERSION = process.env.APP_VERSION ?? "dev";

const logger: QueueLogger = {
  info: (message, fields) =>
    console.log(JSON.stringify({ level: "info", message, ...fields })),
  error: (message, fields) =>
    console.error(JSON.stringify({ level: "error", message, ...fields })),
};

/**
 * Day 3 replaces this with the clone → build → run → health-gate pipeline. It
 * fails loudly rather than reporting success, because a queue that silently
 * marks everything ready is worse than one that does nothing.
 */
const pipelineUnavailable: DeploymentRunner = async () => {
  throw new Error("Build pipeline is not implemented yet");
};

const config = agentConfigFromEnv();

const docker = new DockerClient({ socketPath: config.dockerSocket });
const controlPlane = new ControlPlaneClient({
  baseUrl: config.controlPlaneUrl,
  token: config.token,
});

const queue = new DeploymentQueue({
  capacity: config.maxConcurrentBuilds,
  pollIntervalMs: config.claimPollMs,
  heartbeatIntervalMs: config.heartbeatMs,
  claim: () => controlPlane.claim(),
  report: (deploymentId, update) => controlPlane.report(deploymentId, update),
  runner: pipelineUnavailable,
  logger,
});

const health = new HealthService({
  docker,
  dockerDataRoot: config.dockerDataRoot,
  version: VERSION,
  queue: () => queue.snapshot(),
});

const app = createAgentApp({ token: config.token, health, queue });

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
