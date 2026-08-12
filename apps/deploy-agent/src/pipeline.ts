import type {
  AgentDeploymentRequest,
  DeployModuleGraph,
  DeploymentStatusUpdate,
} from "@repo/schemas/cloud";

import { runBuild } from "./build";
import type { BuildLogStore } from "./build-log";
import type { Exec } from "./exec";
import { resolveCheckoutModuleGraph } from "./module-graph";
import type { PortAllocator } from "./ports";
import type { DeploymentRunner } from "./queue";
import {
  type HealthProbe,
  type RouteManager,
  reapSuperseded,
  runDeployment,
} from "./run";

/**
 * Everything the control plane resolves and the request deliberately does not
 * carry: a queued row that outlives its build cannot leak a credential, and
 * neither can a log line that echoes the request. `noSecrets` stays for tests
 * and for running the pipeline against no control plane at all.
 */
export interface DeploymentSecrets {
  cloneToken: string | null;
  /** One map, applied to the build and to the container alike. */
  env: Record<string, string>;
}

export type SecretsProvider = (
  request: AgentDeploymentRequest,
  signal: AbortSignal,
) => Promise<DeploymentSecrets>;

export const noSecrets: SecretsProvider = async () => ({
  cloneToken: null,
  env: {},
});

/**
 * Where the import graph resolved from the checkout goes. Optional because the
 * pipeline runs against no control plane in tests, and because nothing about a
 * deployment depends on it: it only decides whether a *later* push builds.
 */
export type ModuleGraphReporter = (
  request: AgentDeploymentRequest,
  graph: DeployModuleGraph,
) => Promise<void>;

export interface PipelineOptions {
  exec: Exec;
  logs: BuildLogStore;
  ports: PortAllocator;
  routes: RouteManager;
  buildRoot: string;
  cacheRoot?: string | null;
  buildxBuilder?: string;
  buildkitEndpoint?: string | null;
  serializeBunInstalls?: boolean;
  scopeInstallCopy?: boolean;
  network: string;
  buildMemoryLimit: string;
  drainMs: number;
  healthPollMs?: number;
  secrets?: SecretsProvider;
  moduleGraph?: ModuleGraphReporter;
  healthProbe?: HealthProbe;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDeploymentRunner(
  options: PipelineOptions,
): DeploymentRunner {
  const secrets = options.secrets ?? noSecrets;

  return async (request, context) => {
    const log = await options.logs.open(request.deploymentId);
    let port: number | null = null;

    try {
      await context.report({ status: "building", phase: "cloning" });
      const resolved = await secrets(request, context.signal);

      const build = await runBuild({
        request,
        log,
        signal: context.signal,
        exec: options.exec,
        buildRoot: options.buildRoot,
        cacheRoot: options.cacheRoot,
        buildxBuilder: options.buildxBuilder,
        buildkitEndpoint: options.buildkitEndpoint,
        serializeBunInstalls: options.serializeBunInstalls,
        scopeInstallCopy: options.scopeInstallCopy,
        buildMemoryLimit: options.buildMemoryLimit,
        cloneToken: resolved.cloneToken,
        env: resolved.env,
        onPhase: (phase) => context.report({ status: "building", phase }),
        onCheckout: options.moduleGraph
          ? async (source) => {
              const graph = await resolveCheckoutModuleGraph({
                source,
                rootDirectory: request.build.rootDirectory ?? "",
                sha: request.repository.sha,
                log,
              });
              if (graph) await options.moduleGraph?.(request, graph);
            }
          : undefined,
        now: options.now,
      });

      // The image exists; nothing below this line touches the build disk or the
      // builder. Handing the slot back here is what lets the next build start
      // while this one starts a container and waits for it to answer.
      context.releaseBuildSlot();

      port = await options.ports.allocate(request.deploymentId);
      // Repeated on every deploying report rather than written once: each is an
      // idempotent overwrite, and a control plane that missed one still ends up
      // holding the image tag and the port it needs to render the deployment.
      const built = {
        port,
        imageTag: build.imageTag,
        imageSizeBytes: build.imageSizeBytes,
        buildDurationMs: build.buildDurationMs,
      };
      const outcome = await runDeployment({
        request,
        builder: build.builder,
        imageTag: build.imageTag,
        port,
        log,
        signal: context.signal,
        exec: options.exec,
        routes: options.routes,
        network: options.network,
        env: resolved.env,
        healthProbe: options.healthProbe,
        healthPollMs: options.healthPollMs,
        sleep: options.sleep,
        now: options.now,
        onPhase: (phase) =>
          context.report({ status: "deploying", phase, ...built }),
      });

      const ready: DeploymentStatusUpdate = {
        ...built,
        status: "ready",
        phase: null,
        port: outcome.port,
        containerId: outcome.containerId,
        error: null,
      };
      // Reported before the drain rather than after: the site is already live
      // on the new container, and ten seconds of "deploying" on a deployment
      // that is serving traffic reads as a stall. The queue writes this same
      // update again when the runner returns, which costs one idempotent write
      // and refreshes the heartbeat.
      await context.report(ready);

      const reaped = await reapSuperseded({
        exec: options.exec,
        log,
        targetId: request.targetId,
        kind: request.kind,
        keepDeploymentId: request.deploymentId,
        drainMs: options.drainMs,
        sleep: options.sleep,
      });
      for (const entry of reaped)
        options.ports.releaseOwner(entry.deploymentId);

      return ready;
    } catch (error) {
      log.note(`deployment failed: ${errorMessage(error)}`);
      // Only on failure. A ready deployment's container is holding this port,
      // and handing it to the next build would collide at `docker run`.
      if (port !== null) options.ports.release(port);
      throw error;
    } finally {
      await options.logs.close(request.deploymentId).catch(() => {});
    }
  };
}
