import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentApplyEnvRequest,
  AgentGcRequest,
  AgentHealth,
} from "@repo/schemas/cloud";

import { BuildLogStore } from "./build-log";
import type { CaddyRouteEntry } from "./caddy";
import { ForgeContainerNotFoundError } from "./docker";
import { deploymentRequest } from "./fixtures";
import type { HealthService } from "./health";
import { DeploymentQueue } from "./queue";
import { createAgentApp } from "./routes";
import type { ApplyEnvResult } from "./run";
import type { ForgeTelemetry } from "./telemetry";

const TOKEN = "t".repeat(32);
const AUTH = { authorization: `Bearer ${TOKEN}` };

function healthStub(status: AgentHealth["status"]): HealthService {
  return {
    check: async (): Promise<AgentHealth> => ({
      status,
      version: "test",
      uptimeSeconds: 1,
      docker: {
        reachable: status !== "unavailable",
        version: "27.1.1",
        containersRunning: 0,
        error: null,
      },
      disk: {
        path: "/var/lib/docker",
        totalBytes: 100,
        freeBytes: 50,
        usedPercent: 50,
        error: null,
      },
      queue: { running: 0, capacity: 1, deploymentIds: [] },
    }),
  } as unknown as HealthService;
}

function telemetryStub(status: AgentHealth["status"]): ForgeTelemetry {
  return {
    snapshot: async () => ({
      timestamp: "2026-08-09T12:00:00.000Z",
      health: await healthStub(status).check(),
      containers: [],
      images: [],
    }),
    logs: async () =>
      (async function* () {
        yield "2026-08-09T12:00:00Z ready";
      })(),
  } as unknown as ForgeTelemetry;
}

function app(
  options: {
    status?: AgentHealth["status"];
    logRoot?: string;
    telemetry?: ForgeTelemetry;
    applyEnvResult?: ApplyEnvResult;
  } = {},
) {
  const queue = new DeploymentQueue({
    capacity: 1,
    pollIntervalMs: 1_000,
    heartbeatIntervalMs: 10_000,
    claim: async () => null,
    report: async () => {},
    runner: () => new Promise(() => {}),
  });
  const logs = new BuildLogStore({
    root: options.logRoot ?? join(tmpdir(), "forge-agent-absent"),
  });
  const torndown: string[] = [];
  const restarted: string[] = [];
  const rehosted: {
    deploymentId: string;
    hostnames: string[];
    redirects: { hostname: string; to: string }[];
  }[] = [];
  const collected: AgentGcRequest[] = [];
  const envApplied: AgentApplyEnvRequest[] = [];
  const routes: CaddyRouteEntry[] = [
    {
      deploymentId: "dep-1",
      projectSlug: "app",
      hostnames: ["app.denizlg24.com"],
      upstream: "127.0.0.1:24817",
    },
  ];
  return {
    queue,
    logs,
    routes,
    torndown,
    restarted,
    rehosted,
    collected,
    envApplied,
    instance: createAgentApp({
      token: TOKEN,
      health: healthStub(options.status ?? "ok"),
      telemetry: options.telemetry ?? telemetryStub(options.status ?? "ok"),
      queue,
      logs,
      routes: () => routes,
      teardown: async (deploymentId) => {
        torndown.push(deploymentId);
        return { containerRemoved: true, imageRemoved: null };
      },
      restart: async (deploymentId) => {
        restarted.push(deploymentId);
        return { restarted: true, healthy: true, error: null };
      },
      applyEnv: async (request) => {
        envApplied.push(request);
        return (
          options.applyEnvResult ?? {
            recreated: true,
            containerId: "container-new",
            healthy: true,
            rolledBack: false,
            error: null,
          }
        );
      },
      rehost: async (deploymentId, hostnames, routeOptions) => {
        if (!routes.some((route) => route.deploymentId === deploymentId)) {
          return false;
        }
        rehosted.push({
          deploymentId,
          hostnames,
          redirects: routeOptions.redirects ?? [],
        });
        return true;
      },
      collectGarbage: async (request) => {
        collected.push(request);
        return {
          dryRun: request.dryRun,
          imagesRemoved: [],
          containersRemoved: [],
          buildsRemoved: [],
          logsRemoved: [],
          cacheDirsRemoved: [],
          builderCacheReclaimedBytes: null,
          disk: {
            path: "/var/lib/docker",
            totalBytes: 100,
            freeBytes: 50,
            usedPercent: 50,
            error: null,
          },
          failures: [],
        };
      },
    }),
  };
}

describe("GET /healthz", () => {
  it("is reachable without a token", async () => {
    const response = await app().instance.request("/healthz");
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });

  it("answers 503 when the agent cannot deploy", async () => {
    const response = await app({ status: "unavailable" }).instance.request(
      "/healthz",
    );
    expect(response.status).toBe(503);
  });

  it("answers 200 while merely degraded", async () => {
    const response = await app({ status: "degraded" }).instance.request(
      "/healthz",
    );
    expect(response.status).toBe(200);
  });
});

describe("authentication", () => {
  it("guards every route except /healthz", async () => {
    const { instance } = app();
    for (const path of [
      "/deployments",
      "/routes",
      "/telemetry",
      "/containers/dep-1/logs",
      `/deployments/${crypto.randomUUID()}`,
      `/deployments/${crypto.randomUUID()}/logs`,
    ]) {
      expect((await instance.request(path)).status).toBe(401);
    }
  });
});

describe("POST /deployments", () => {
  it("accepts a valid request", async () => {
    const request = deploymentRequest();
    const response = await app().instance.request("/deployments", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(202);
    expect((await response.json()).deployment.deploymentId).toBe(
      request.deploymentId,
    );
  });

  it("rejects a malformed request with the failing issues", async () => {
    const response = await app().instance.request("/deployments", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ deploymentId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it("rejects a non-JSON body without throwing", async () => {
    const response = await app().instance.request("/deployments", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("answers 429 at capacity", async () => {
    const { instance } = app();
    const send = (body: unknown) =>
      instance.request("/deployments", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await send(deploymentRequest())).status).toBe(202);
    const second = await send(deploymentRequest());
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe("AT_CAPACITY");
  });
});

describe("GET /deployments/:id", () => {
  it("404s an unknown deployment", async () => {
    const response = await app().instance.request(
      `/deployments/${crypto.randomUUID()}`,
      { headers: AUTH },
    );
    expect(response.status).toBe(404);
  });

  it("returns a running deployment", async () => {
    const { queue, instance } = app();
    const request = deploymentRequest();
    queue.submit(request);

    const response = await instance.request(
      `/deployments/${request.deploymentId}`,
      { headers: AUTH },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).deployment.status).toBe("building");
  });
});

describe("GET /deployments/:id/logs", () => {
  it("404s a deployment with no log", async () => {
    const response = await app().instance.request(
      `/deployments/${crypto.randomUUID()}/logs`,
      { headers: AUTH },
    );
    expect(response.status).toBe(404);
  });

  it("replays a finished build's log as SSE", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-agent-routes-"));
    try {
      const { logs, instance } = app({ logRoot: root });
      const log = await logs.open("dep-1");
      log.write("step 1\nstep 2\n");
      await logs.close("dep-1");

      const response = await instance.request("/deployments/dep-1/logs", {
        headers: AUTH,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const body = await response.text();
      expect(body).toContain("data: step 1");
      expect(body).toContain("data: step 2");
      expect(body).toContain("event: end");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("GET /routes", () => {
  it("returns the live routing table", async () => {
    const response = await app().instance.request("/routes", { headers: AUTH });
    expect(response.status).toBe(200);
    expect((await response.json()).routes[0].hostnames).toEqual([
      "app.denizlg24.com",
    ]);
  });
});

describe("GET /telemetry", () => {
  it("returns a Forge-scoped snapshot", async () => {
    const response = await app().instance.request("/telemetry", {
      headers: AUTH,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot.containers).toEqual([]);
  });
});

describe("GET /containers/:id/logs", () => {
  it("streams runtime logs as SSE", async () => {
    const response = await app().instance.request("/containers/dep-1/logs", {
      headers: AUTH,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: log");
    expect(body).toContain("ready");
    expect(body).toContain("event: end");
  });

  it("forwards an integer tail and falls back to 500 for invalid input", async () => {
    const tails: number[] = [];
    const telemetry = {
      snapshot: async () => telemetryStub("ok").snapshot(),
      logs: async (_id: string, options: { tail?: number }) => {
        tails.push(options.tail ?? -1);
        return (async function* () {
          yield "ready";
        })();
      },
    } as unknown as ForgeTelemetry;
    for (const tail of ["42", "invalid"]) {
      const response = await app({ telemetry }).instance.request(
        `/containers/dep-1/logs?tail=${tail}`,
        { headers: AUTH },
      );
      await response.text();
    }
    expect(tails).toEqual([42, 500]);
  });

  it("distinguishes a missing container from a Docker fault", async () => {
    const telemetry = (error: Error) =>
      ({
        snapshot: async () => telemetryStub("ok").snapshot(),
        logs: async () => {
          throw error;
        },
      }) as unknown as ForgeTelemetry;
    const missing = await app({
      telemetry: telemetry(new ForgeContainerNotFoundError()),
    }).instance.request("/containers/missing/logs", { headers: AUTH });
    expect(missing.status).toBe(404);

    const unavailable = await app({
      telemetry: telemetry(new Error("Docker socket closed")),
    }).instance.request("/containers/dep-1/logs", { headers: AUTH });
    expect(unavailable.status).toBe(502);
  });
});

describe("DELETE /deployments/:id", () => {
  it("tears down without caring whether anything was there", async () => {
    const { instance, torndown } = app();
    const id = crypto.randomUUID();
    const response = await instance.request(`/deployments/${id}`, {
      method: "DELETE",
      headers: AUTH,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      containerRemoved: true,
      imageRemoved: null,
    });
    expect(torndown).toEqual([id]);
  });
});

describe("POST /deployments/:id/cancel", () => {
  it("cancels a running deployment", async () => {
    const { queue, instance } = app();
    const request = deploymentRequest();
    queue.submit(request);

    const response = await instance.request(
      `/deployments/${request.deploymentId}/cancel`,
      { method: "POST", headers: AUTH },
    );

    expect(response.status).toBe(202);
  });

  it("409s a deployment that is not running", async () => {
    const response = await app().instance.request(
      `/deployments/${crypto.randomUUID()}/cancel`,
      { method: "POST", headers: AUTH },
    );
    expect(response.status).toBe(409);
  });
});

describe("POST /deployments/:id/restart", () => {
  it("restarts without rebuilding", async () => {
    const { instance, restarted } = app();
    const response = await instance.request("/deployments/dep-1/restart", {
      method: "POST",
      headers: AUTH,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      restarted: true,
      healthy: true,
      error: null,
    });
    expect(restarted).toEqual(["dep-1"]);
  });
});

describe("POST /deployments/:id/apply-env", () => {
  const request = deploymentRequest();
  const body = JSON.stringify({
    request,
    imageTag: "forge/app:abc1234-dep",
    port: 24_817,
  });

  it("recreates the container and reports the new id", async () => {
    const { instance, envApplied } = app();
    const response = await instance.request(
      `/deployments/${request.deploymentId}/apply-env`,
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      recreated: true,
      containerId: "container-new",
      healthy: true,
    });
    expect(envApplied).toHaveLength(1);
    expect(envApplied[0]?.request.deploymentId).toBe(request.deploymentId);
  });

  it("refuses a body whose deployment id is not the one in the path", async () => {
    const { instance, envApplied } = app();
    const response = await instance.request(
      `/deployments/${crypto.randomUUID()}/apply-env`,
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body,
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "DEPLOYMENT_ID_MISMATCH" },
    });
    expect(envApplied).toHaveLength(0);
  });

  // The cloud page reads the status to decide whether to report a per-deployment
  // failure, so a regression that always answered 200 has to fail here.
  it("answers 409 when the apply did not recreate the container", async () => {
    const { instance } = app({
      applyEnvResult: {
        recreated: false,
        containerId: null,
        healthy: false,
        rolledBack: true,
        error: "health check failed. The previous container was restored.",
      },
    });
    const response = await instance.request(
      `/deployments/${request.deploymentId}/apply-env`,
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body,
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      recreated: false,
      rolledBack: true,
    });
  });

  // The id becomes a path segment under the access-log root.
  it("refuses a non-uuid deployment id on the requests route", async () => {
    const { instance } = app();
    const response = await instance.request(
      `/deployments/${encodeURIComponent("../../etc/passwd")}/requests`,
      { headers: AUTH },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_DEPLOYMENT_ID" },
    });
  });

  it("refuses a malformed body", async () => {
    const { instance, envApplied } = app();
    const response = await instance.request(
      `/deployments/${request.deploymentId}/apply-env`,
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ imageTag: "forge/app:1" }),
      },
    );

    expect(response.status).toBe(400);
    expect(envApplied).toHaveLength(0);
  });
});

describe("POST /deployments/:id/promote", () => {
  it("replaces the hostname set of a live route", async () => {
    const { instance, rehosted } = app();
    const response = await instance.request("/deployments/dep-1/promote", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        hostnames: ["app.denizlg24.com", "clientsite.com"],
        redirects: [{ hostname: "www.clientsite.com", to: "clientsite.com" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(rehosted).toEqual([
      {
        deploymentId: "dep-1",
        hostnames: ["app.denizlg24.com", "clientsite.com"],
        redirects: [{ hostname: "www.clientsite.com", to: "clientsite.com" }],
      },
    ]);
  });

  it("accepts the previous control plane's canonical redirect payload", async () => {
    const { instance, rehosted } = app();
    const response = await instance.request("/deployments/dep-1/promote", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        hostnames: ["app.denizlg24.com", "clientsite.com"],
        redirectHostnames: ["www.clientsite.com"],
        canonical: "clientsite.com",
      }),
    });

    expect(response.status).toBe(200);
    expect(rehosted[0]?.redirects).toEqual([
      { hostname: "www.clientsite.com", to: "clientsite.com" },
    ]);
  });

  it("409s a deployment that is not routed", async () => {
    const response = await app().instance.request(
      "/deployments/dep-missing/promote",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ hostnames: ["app.denizlg24.com"] }),
      },
    );
    expect(response.status).toBe(409);
  });

  it("rejects an empty hostname set", async () => {
    const response = await app().instance.request(
      "/deployments/dep-1/promote",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ hostnames: [] }),
      },
    );
    expect(response.status).toBe(400);
  });

  it("rejects a redirect to a domain the deployment does not serve", async () => {
    const response = await app().instance.request(
      "/deployments/dep-1/promote",
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          hostnames: ["app.denizlg24.com"],
          redirects: [
            { hostname: "www.clientsite.com", to: "unrelated.example" },
          ],
        }),
      },
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /gc", () => {
  it("passes the keep set through and reports", async () => {
    const { instance, collected } = app();
    const keep = crypto.randomUUID();
    const response = await instance.request("/gc", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        keepDeploymentIds: [keep],
        keepImageTags: ["forge/app:abc1234-0000"],
      }),
    });

    expect(response.status).toBe(200);
    expect(collected[0]?.keepDeploymentIds).toEqual([keep]);
    expect(collected[0]?.logRetentionDays).toBe(30);
    expect((await response.json()).report.failures).toEqual([]);
  });
});
