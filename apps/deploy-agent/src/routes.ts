import { agentDeploymentRequestSchema } from "@repo/schemas/cloud";
import { Hono } from "hono";

import { requireAgentToken } from "./auth";
import type { HealthService } from "./health";
import { type DeploymentQueue, QueueAtCapacityError } from "./queue";

export interface AgentRouteOptions {
  token: string;
  health: HealthService;
  queue: DeploymentQueue;
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
