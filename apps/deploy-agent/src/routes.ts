import { agentDeploymentRequestSchema } from "@repo/schemas/cloud";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { requireAgentToken } from "./auth";
import type { BuildLogStore } from "./build-log";
import type { HealthService } from "./health";
import { type DeploymentQueue, QueueAtCapacityError } from "./queue";

export interface AgentRouteOptions {
  token: string;
  health: HealthService;
  queue: DeploymentQueue;
  logs: BuildLogStore;
}

export function createAgentApp(options: AgentRouteOptions): Hono {
  const app = new Hono();

  /**
   * Deliberately unauthenticated. The listener is already unreachable off the
   * tailnet, this exposes no deployment detail beyond a count, and gating it
   * would mean systemd probes and a local `curl` need a secret to ask whether
   * the process is alive.
   */
  app.get("/healthz", async (context) => {
    const health = await options.health.check();
    return context.json(health, health.status === "unavailable" ? 503 : 200);
  });

  const guarded = new Hono();
  guarded.use("*", requireAgentToken(options.token));

  guarded.get("/deployments", (context) =>
    context.json({ deployments: options.queue.list() }),
  );

  guarded.post("/deployments", async (context) => {
    const parsed = agentDeploymentRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Deployment request failed validation",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    try {
      return context.json(
        { deployment: options.queue.submit(parsed.data) },
        202,
      );
    } catch (error) {
      if (error instanceof QueueAtCapacityError) {
        return context.json(
          { error: { code: "AT_CAPACITY", message: error.message } },
          429,
        );
      }
      throw error;
    }
  });

  guarded.get("/deployments/:id", (context) => {
    const deployment = options.queue.get(context.req.param("id"));
    if (!deployment) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Unknown deployment" } },
        404,
      );
    }
    return context.json({ deployment });
  });

  /**
   * Replays from the first line before tailing, so watching a build never
   * requires having been connected when it started — and a finished build is
   * served from its file, which is the only view that exists after a restart.
   */
  guarded.get("/deployments/:id/logs", async (context) => {
    const deploymentId = context.req.param("id");
    if (!(await options.logs.has(deploymentId))) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "No build log" } },
        404,
      );
    }
    return streamSSE(context, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      for await (const line of options.logs.stream(
        deploymentId,
        controller.signal,
      )) {
        await stream.writeSSE({ data: line });
      }
      if (!controller.signal.aborted) {
        await stream.writeSSE({ event: "end", data: "" });
      }
    });
  });

  guarded.post("/deployments/:id/cancel", (context) => {
    const cancelled = options.queue.cancel(context.req.param("id"));
    if (!cancelled) {
      return context.json(
        {
          error: {
            code: "NOT_RUNNING",
            message: "Deployment is not currently running",
          },
        },
        409,
      );
    }
    return context.json({ status: "cancelling" }, 202);
  });

  app.route("/", guarded);

  app.notFound((context) =>
    context.json(
      { error: { code: "NOT_FOUND", message: "Unknown route" } },
      404,
    ),
  );

  return app;
}
