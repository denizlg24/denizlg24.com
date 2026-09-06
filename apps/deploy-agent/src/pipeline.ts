import type {
  AgentDeploymentRequest,
  DeployModuleGraph,
  DeploymentStatusUpdate,
} from "@repo/schemas/cloud";

import { imageTagFor, runBuild } from "./build";
import type { BuildLogStore } from "./build-log";
import type { Exec } from "./exec";
import { resolveCheckoutModuleGraph } from "./module-graph";
import type { PortAllocator } from "./ports";
import type { DeploymentRunner } from "./queue";
import type { PublishedRecoveryImage } from "./recovery-image";
import { publishRecoveryImage } from "./recovery-image";
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
  recoveryRegistryPrefix?: string;
  recoveryImagePublisher?: (input: {
    exec: Exec;
    log: Awaited<ReturnType<BuildLogStore["open"]>>;
    request: AgentDeploymentRequest;
    localImage: string;
    registryPrefix: string;
    signal: AbortSignal;
  }) => Promise<PublishedRecoveryImage>;
  acquireHostMutationLock?: (
    owner: string,
    signal: AbortSignal,
  ) => Promise<() => Promise<void>>;
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
    let releaseHostMutationLock: (() => Promise<void>) | null = null;
    // The happy path hands the lock back early, before the recovery push; the
    // `finally` is the net for every other exit. Clearing the handle first is
    // what keeps those from both firing.
    const releaseHostMutationLockOnce = async () => {
      const release = releaseHostMutationLock;
      releaseHostMutationLock = null;
      if (!release) return;
      await release().catch((error: unknown) =>
        log.note(`host mutation lock release failed: ${errorMessage(error)}`),
      );
    };

    try {
      // The image tag is reserved on the row before anything builds, and this
      // is load-bearing rather than tidy. Garbage collection protects an image
      // two ways: a running container references it, or a deployment row names
      // it in `imageTag`. Between the build finishing and `docker run` there is
      // neither — and that gap contains the wait for the host mutation lock,
      // which is unbounded. A GC pass landing in it reaps the image the
      // deployment is about to start, and the run fails with "Unable to find
      // image locally" for a tag that was built minutes earlier.
      //
      // `imageTagFor` is pure and is what `runBuild` tags with, so reserving it
      // here names the same image the build will produce.
      await context.report({
        status: "building",
        phase: "cloning",
        imageTag: imageTagFor(request),
      });
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

      releaseHostMutationLock =
        (await options.acquireHostMutationLock?.(
          `deployment:${request.deploymentId}`,
          context.signal,
        )) ?? null;

      port = await options.ports.allocate(request.deploymentId);
      // Repeated on every deploying report rather than written once: each is an
      // idempotent overwrite, and a control plane that missed one still ends up
      // holding the image tag and the port it needs to render the deployment.
      const built = {
        port,
        imageTag: build.imageTag,
        resolvedBuilder: build.builder,
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

      const serving: DeploymentStatusUpdate = {
        ...built,
        imageTag: build.imageTag,
        imageDigest: null,
        status: "ready",
        phase: "backing-up",
        port: outcome.port,
        containerId: outcome.containerId,
        error: null,
      };
      // Reported before the drain rather than after: the routes are published,
      // the site is already live on the new container, and ten seconds of
      // "deploying" on a deployment that is serving traffic reads as a stall.
      // The phase is what keeps the archive below legible instead of leaving
      // the row looking finished while minutes of push are still to come.
      await context.report(serving);

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

      // Everything that mutates the host is done. The push touches nothing on
      // this box, so holding the lock through it would serialise every other
      // deployment behind an upload to GHCR for no reason.
      await releaseHostMutationLockOnce();

      const recoveryImage = await (
        options.recoveryImagePublisher ?? publishRecoveryImage
      )({
        exec: options.exec,
        log,
        request,
        localImage: build.imageTag,
        registryPrefix:
          options.recoveryRegistryPrefix ?? "ghcr.io/denizlg24/forge-recovery",
        signal: context.signal,
      }).catch((error: unknown) => {
        // The recovery image is a disaster-recovery convenience. Failing to
        // archive a deployment that passed its health check and is serving
        // traffic is not a reason to fail the deploy — and it used to be, since
        // this ran inside the health `try` whose catch removes the container.
        log.note(`recovery image publish failed: ${errorMessage(error)}`);
        return null;
      });

      // The second write exists because the first could not carry a digest the
      // push had not produced yet. If the agent dies in between, the row stays
      // ready with no recovery reference — the same state a failed push leaves,
      // now without taking the deployment down with it.
      const ready: DeploymentStatusUpdate = {
        ...serving,
        imageTag: recoveryImage?.reference ?? build.imageTag,
        imageDigest: recoveryImage?.digest ?? null,
        phase: null,
      };
      // Non-fatal, unlike every other report in this function. The container is
      // serving and the routes are published; the catch below would release a
      // live container's port and mark a working deployment failed over a
      // status write. The queue writes this same update again when the runner
      // returns, so the digest is not lost either.
      await context
        .report(ready)
        .catch((error: unknown) =>
          log.note(`recovery reference not recorded: ${errorMessage(error)}`),
        );

      return ready;
    } catch (error) {
      log.note(`deployment failed: ${errorMessage(error)}`);
      // Only on failure. A ready deployment's container is holding this port,
      // and handing it to the next build would collide at `docker run`.
      if (port !== null) options.ports.release(port);
      throw error;
    } finally {
      await releaseHostMutationLockOnce();
      await options.logs.close(request.deploymentId).catch(() => {});
    }
  };
}
