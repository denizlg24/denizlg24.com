import type { AgentGcReport, AgentGcRequest } from "@repo/schemas/cloud";
import {
  agentDeploymentRequestSchema,
  agentGcRequestSchema,
  agentPromoteRequestSchema,
} from "@repo/schemas/cloud";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { requireAgentToken } from "./auth";
import type { BuildLogStore } from "./build-log";
import type { CaddyRouteEntry } from "./caddy";
import type { HealthService } from "./health";
import { type DeploymentQueue, QueueAtCapacityError } from "./queue";
import type { RestartResult, TeardownResult } from "./run";
import type { ForgeTelemetry } from "./telemetry";

export interface AgentRouteOptions {
  token: string;
  health: HealthService;
  telemetry: ForgeTelemetry;
  queue: DeploymentQueue;
  logs: BuildLogStore;
  routes: () => CaddyRouteEntry[];
  teardown: (deploymentId: string) => Promise<TeardownResult>;
  restart: (deploymentId: string) => Promise<RestartResult>;
  rehost: (
    deploymentId: string,
    hostnames: string[],
    options: { redirects?: { hostname: string; to: string }[] },
  ) => Promise<boolean>;
  collectGarbage: (request: AgentGcRequest) => Promise<AgentGcReport>;
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

  /**
   * Teardown is idempotent and never 404s. It is called on a deployment that
   * failed before it ever had a container as readily as on a live one, and
   * making the caller distinguish those would only invite it to skip the call.
   */
  guarded.delete("/deployments/:id", async (context) => {
    const result = await options.teardown(context.req.param("id"));
    return context.json(result);
  });

  guarded.get("/routes", (context) =>
    context.json({ routes: options.routes() }),
  );

  guarded.get("/telemetry", async (context) =>
    context.json({ snapshot: await options.telemetry.snapshot() }),
  );

  guarded.get("/containers/:id/logs", async (context) => {
    const requestedTail = Number(context.req.query("tail") ?? 500);
    const tail = Number.isInteger(requestedTail) ? requestedTail : 500;
    let lines: AsyncGenerator<string>;
    try {
      lines = await options.telemetry.logs(context.req.param("id"), {
        tail,
        signal: context.req.raw.signal,
      });
    } catch {
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Forge container was not found",
          },
        },
        404,
      );
    }
    return streamSSE(context, async (stream) => {
      for await (const line of lines) {
        await stream.writeSSE({ event: "log", data: line });
      }
      if (!context.req.raw.signal.aborted) {
        await stream.writeSSE({ event: "end", data: "" });
      }
    });
  });

  guarded.post("/deployments/:id/restart", async (context) => {
    const result = await options.restart(context.req.param("id"));
    return context.json(result, result.restarted ? 200 : 409);
  });

  /**
   * The body is the complete hostname set, so this serves promote, rollback and
   * a mid-rename window where two names must answer at once. 409 rather than
   * 404 when the deployment has no route: it exists, it is simply not serving,
   * and the caller's next move is to redeploy rather than to stop asking.
   */
  guarded.post("/deployments/:id/promote", async (context) => {
    const parsed = agentPromoteRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Promote request failed validation",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const rehosted = await options.rehost(
      context.req.param("id"),
      parsed.data.hostnames,
      {
        redirects: parsed.data.redirects,
      },
    );
    if (!rehosted) {
      return context.json(
        {
          error: {
            code: "NOT_ROUTED",
            message: "Deployment has no live route to promote",
          },
        },
        409,
      );
    }
    return context.json({
      hostnames: parsed.data.hostnames,
      redirects: parsed.data.redirects,
    });
  });

  guarded.post("/gc", async (context) => {
    const parsed = agentGcRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "GC request failed validation",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    return context.json({ report: await options.collectGarbage(parsed.data) });
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
