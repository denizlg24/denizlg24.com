import type {
  AgentApplyEnvRequest,
  AgentGcReport,
  AgentGcRequest,
} from "@repo/schemas/cloud";
import {
  agentApplyEnvRequestSchema,
  agentDeploymentRequestSchema,
  agentGcRequestSchema,
  agentPromoteRequestSchema,
} from "@repo/schemas/cloud";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { requireAgentToken } from "./auth";
import type { BuildLogStore } from "./build-log";
import type { CaddyRouteEntry } from "./caddy";
import { ForgeContainerNotFoundError } from "./docker";
import type { HealthService } from "./health";
import { type DeploymentQueue, QueueAtCapacityError } from "./queue";
import type { ApplyEnvResult, RestartResult, TeardownResult } from "./run";
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
  applyEnv: (request: AgentApplyEnvRequest) => Promise<ApplyEnvResult>;
  rehost: (
    deploymentId: string,
    hostnames: string[],
    options: { redirects?: { hostname: string; to: string }[] },
  ) => Promise<boolean>;
  collectGarbage: (request: AgentGcRequest) => Promise<AgentGcReport>;
}

const DEPLOYMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the bound the control plane's query schema enforces. */
const MAX_LOG_WINDOW_MS = 60 * 60 * 1_000;

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
    const controller = new AbortController();
    const requestSignal = context.req.raw.signal;
    const abort = () => controller.abort();
    if (requestSignal.aborted) abort();
    else requestSignal.addEventListener("abort", abort, { once: true });
    let lines: AsyncGenerator<string>;
    try {
      lines = await options.telemetry.logs(context.req.param("id"), {
        tail,
        signal: controller.signal,
      });
    } catch (error) {
      requestSignal.removeEventListener("abort", abort);
      if (!(error instanceof ForgeContainerNotFoundError)) {
        return context.json(
          {
            error: {
              code: "DOCKER_UNAVAILABLE",
              message: "Could not open the Forge container log stream",
            },
          },
          502,
        );
      }
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
      stream.onAbort(abort);
      try {
        for await (const line of lines) {
          await stream.writeSSE({ event: "log", data: line });
        }
        if (!controller.signal.aborted) {
          await stream.writeSSE({ event: "end", data: "" });
        }
      } finally {
        controller.abort();
        requestSignal.removeEventListener("abort", abort);
      }
    });
  });

  /**
   * The requests a deployment recently served, newest last.
   *
   * Keyed by deployment id rather than container id, because the access log
   * outlives the container: recreating one on an env change gives it a new id
   * while the traffic history is unchanged. Answers 200 with an empty list rather
   * than 404 when nothing has been logged — a deployment that has served no
   * requests is not a missing deployment, and the two are easy to confuse when
   * access logging has only just been turned on.
   */
  guarded.get("/deployments/:id/requests", async (context) => {
    const id = context.req.param("id");
    // This id becomes a path segment under the access-log root. Without the
    // check, `..%2F..%2Fvar%2Flog%2Fsyslog` reads any `.log` file on the host
    // once Hono has decoded it — the token bounds who can ask, not what they can
    // read. Every deployment id in this system is a uuid.
    if (!DEPLOYMENT_ID.test(id)) {
      return context.json(
        {
          error: {
            code: "INVALID_DEPLOYMENT_ID",
            message: "A deployment id must be a uuid",
          },
        },
        400,
      );
    }
    const limit = Number.parseInt(context.req.query("limit") ?? "200", 10);
    const minDuration = Number.parseFloat(
      context.req.query("minDurationMs") ?? "",
    );
    return context.json(
      await options.telemetry.requests(
        id,
        Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 2_000) : 200,
        {
          methods: context.req.queries("method") ?? [],
          statusClasses: context.req.queries("status") ?? [],
          search: context.req.query("search") ?? null,
          minDurationMs: Number.isFinite(minDuration) ? minDuration : null,
        },
      ),
    );
  });

  /**
   * The container output belonging to one request.
   *
   * Bounded by a time window on both ends rather than tailed, because this
   * answers a question about something that already happened. `requestId` is
   * what makes the answer exact; without it — or when the app never logged it —
   * the window is all there is, and the response says so.
   */
  guarded.get("/deployments/:id/request-logs", async (context) => {
    const id = context.req.param("id");
    if (!DEPLOYMENT_ID.test(id)) {
      return context.json(
        {
          error: {
            code: "INVALID_DEPLOYMENT_ID",
            message: "A deployment id must be a uuid",
          },
        },
        400,
      );
    }
    const from = new Date(context.req.query("from") ?? "");
    const to = new Date(context.req.query("to") ?? "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return context.json(
        {
          error: {
            code: "INVALID_WINDOW",
            message: "from and to must be timestamps",
          },
        },
        400,
      );
    }
    // A reversed window reads as "no logs" rather than as the mistake it is, and
    // an open-ended one asks the daemon for everything the container ever wrote
    // — the cost of which is set by the caller's arithmetic, not by this box.
    const span = to.getTime() - from.getTime();
    if (span < 0 || span > MAX_LOG_WINDOW_MS) {
      return context.json(
        {
          error: {
            code: "INVALID_WINDOW",
            message: `from must not be after to, and the window must be at most ${MAX_LOG_WINDOW_MS / 60_000} minutes`,
          },
        },
        400,
      );
    }
    const limit = Number.parseInt(context.req.query("limit") ?? "200", 10);
    try {
      return context.json(
        await options.telemetry.requestLogs(id, {
          from,
          to,
          requestId: context.req.query("requestId") ?? null,
          limit: Number.isInteger(limit)
            ? Math.min(Math.max(limit, 1), 1_000)
            : 200,
        }),
      );
    } catch {
      // A daemon that will not answer is reported as such. Returning an empty
      // window instead would tell the caller the request wrote no output.
      return context.json(
        {
          error: {
            code: "DOCKER_UNAVAILABLE",
            message: "Could not read the Forge container log window",
          },
        },
        502,
      );
    }
  });

  guarded.post("/deployments/:id/restart", async (context) => {
    const result = await options.restart(context.req.param("id"));
    return context.json(result, result.restarted ? 200 : 409);
  });

  /**
   * Recreates the container so a changed environment actually takes effect —
   * `docker restart` cannot, because env is fixed at create time. 409 rather
   * than 500 on failure: the deployment still exists and the previous container
   * has been put back, so the caller's move is to fix the variable and retry.
   */
  guarded.post("/deployments/:id/apply-env", async (context) => {
    const parsed = agentApplyEnvRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid environment apply request",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    if (parsed.data.request.deploymentId !== context.req.param("id")) {
      return context.json(
        {
          error: {
            code: "DEPLOYMENT_ID_MISMATCH",
            message: "The body names a different deployment than the path",
          },
        },
        400,
      );
    }
    const result = await options.applyEnv(parsed.data);
    return context.json(result, result.recreated ? 200 : 409);
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
