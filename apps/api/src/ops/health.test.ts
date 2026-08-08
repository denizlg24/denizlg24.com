import { describe, expect, it } from "bun:test";

import { interpretForgeHealth } from "./health";

const healthy = {
  status: "ok",
  version: "1.0.0",
  uptimeSeconds: 120,
  docker: {
    reachable: true,
    version: "27.3.1",
    containersRunning: 3,
    error: null,
  },
  disk: {
    path: "/var/lib/forge",
    totalBytes: 1_000,
    freeBytes: 800,
    usedPercent: 20,
    error: null,
  },
  queue: { running: 1, capacity: 2, deploymentIds: [] },
};

describe("interpretForgeHealth", () => {
  it("reports ok with the queue depth", () => {
    expect(interpretForgeHealth(200, healthy, 4)).toEqual({
      status: "ok",
      latencyMs: 4,
      message: "1/2 building",
    });
  });

  it("treats the agent's own unavailable as down even on a 200", () => {
    // The case a liveness probe gets wrong: the process is up and answering,
    // and every build it accepts will fail.
    const check = interpretForgeHealth(
      200,
      {
        ...healthy,
        status: "unavailable",
        docker: {
          reachable: false,
          version: null,
          containersRunning: 0,
          error: "connect ENOENT /var/run/docker.sock",
        },
      },
      7,
    );
    expect(check.status).toBe("down");
    expect(check.message).toBe("connect ENOENT /var/run/docker.sock");
  });

  it("keeps reading the status when a neighbouring field drifts", () => {
    // The regression this shape exists to prevent: validating the whole body
    // would drop `status` because `docker` changed, and report a box that
    // cannot build as healthy.
    const check = interpretForgeHealth(
      200,
      { ...healthy, status: "unavailable", docker: "unreachable" },
      5,
    );
    expect(check.status).toBe("down");
  });

  it("falls back to the HTTP status when the body says nothing", () => {
    expect(interpretForgeHealth(503, null, 1)).toEqual({
      status: "down",
      latencyMs: 1,
      message: "HTTP 503",
    });
  });

  it("carries the disk pressure into a degraded message", () => {
    const check = interpretForgeHealth(
      200,
      {
        ...healthy,
        status: "degraded",
        disk: { ...healthy.disk, usedPercent: 91.25 },
      },
      2,
    );
    expect(check.status).toBe("degraded");
    expect(check.message).toBe("disk at 91.3%, 1/2 building");
  });

  it("stays reachable when the body cannot be read", () => {
    // An agent one version ahead must not read as an outage.
    expect(interpretForgeHealth(200, { shape: "unknown" }, 3)).toEqual({
      status: "ok",
      latencyMs: 3,
      message: null,
    });
  });
});
