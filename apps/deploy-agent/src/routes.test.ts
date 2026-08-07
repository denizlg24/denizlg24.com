import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHealth } from "@repo/schemas/cloud";

import { BuildLogStore } from "./build-log";
import type { CaddyRouteEntry } from "./caddy";
import { deploymentRequest } from "./fixtures";
import type { HealthService } from "./health";
import { DeploymentQueue } from "./queue";
import { createAgentApp } from "./routes";

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

function app(
  options: { status?: AgentHealth["status"]; logRoot?: string } = {},
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
    instance: createAgentApp({
      token: TOKEN,
      health: healthStub(options.status ?? "ok"),
      queue,
      logs,
      routes: () => routes,
      teardown: async (deploymentId) => {
        torndown.push(deploymentId);
        return { containerRemoved: true, imageRemoved: null };
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
