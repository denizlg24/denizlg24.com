import { describe, expect, it } from "bun:test";
import type { AgentHealth } from "@repo/schemas/cloud";

import type { DockerClient, ForgeDockerContainer } from "./docker";
import { hostSnapshot } from "./fixtures";
import type { HealthService } from "./health";
import { ForgeTelemetry } from "./telemetry";

const health: AgentHealth = {
  status: "ok",
  version: "test",
  uptimeSeconds: 1,
  docker: {
    reachable: true,
    version: "27",
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
};

function container(index: number): ForgeDockerContainer {
  return {
    id: `container-${index}`,
    name: `app-${index}`,
    image: "forge/app:latest",
    imageId: "image-1",
    state: "running",
    status: "Up",
    health: null,
    createdAt: "2026-08-09T12:00:00.000Z",
    deploymentId: `deployment-${index}`,
    targetId: "target-1",
    projectSlug: "app",
    kind: "production",
  };
}

const healthService = {
  check: async () => health,
} as unknown as HealthService;
const host = { collect: async () => hostSnapshot() };

describe("ForgeTelemetry", () => {
  it("bounds concurrent container stats calls", async () => {
    let active = 0;
    let peak = 0;
    const containers = Array.from({ length: 12 }, (_, index) =>
      container(index),
    );
    const docker = {
      listForgeContainers: async () => containers,
      listForgeImages: async () => [],
      forgeContainerStats: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return {
          cpuPercent: 0,
          memoryBytes: 0,
          memoryLimitBytes: 0,
          memoryPercent: 0,
          networkRxBytes: 0,
          networkTxBytes: 0,
          blockReadBytes: 0,
          blockWriteBytes: 0,
          pids: 0,
        };
      },
    } as unknown as DockerClient;

    const snapshot = await new ForgeTelemetry({
      docker,
      health: healthService,
      host,
    }).snapshot();
    expect(snapshot.containers).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("retains health when the Forge container list fails", async () => {
    const docker = {
      listForgeContainers: async () => {
        throw new Error("Docker list failed");
      },
    } as unknown as DockerClient;
    const snapshot = await new ForgeTelemetry({
      docker,
      health: healthService,
      host,
    }).snapshot();

    expect(snapshot.health).toEqual(health);
    expect(snapshot.host.cpu.usagePercent).toBe(10);
    expect(snapshot.containers).toEqual([]);
    expect(snapshot.images).toEqual([]);
  });

  describe("requestLogs", () => {
    const from = new Date("2026-08-09T12:00:10.000Z");
    const to = new Date("2026-08-09T12:00:20.000Z");

    function docker(
      window: () => Promise<{ stream: "stdout" | null; line: string }[]>,
    ) {
      return {
        listForgeContainers: async () => [container(1)],
        forgeContainerLogWindow: window,
      } as unknown as DockerClient;
    }

    // The daemon filters at one-second resolution, so the client rounds the
    // bounds outward to catch a request that started mid-second. That widening
    // is a way of asking, not part of the answer.
    it("drops lines the daemon's rounding pulled in from outside the window", async () => {
      const telemetry = new ForgeTelemetry({
        docker: docker(async () => [
          { stream: "stdout", line: "2026-08-09T12:00:09.100Z before" },
          { stream: "stdout", line: "2026-08-09T12:00:15.000Z inside" },
          { stream: "stdout", line: "2026-08-09T12:00:20.900Z after" },
          // Unstamped output is the whole point of an app that logs its own
          // format; it cannot be placed, so it cannot be excluded.
          { stream: "stdout", line: "no timestamp here" },
        ]),
        health: healthService,
        host,
      });

      const result = await telemetry.requestLogs("deployment-1", {
        from,
        to,
        requestId: null,
        limit: 100,
      });
      expect(result.lines.map((line) => line.message)).toEqual([
        "inside",
        "no timestamp here",
      ]);
    });

    // An empty window is what a request that wrote nothing looks like. A daemon
    // that will not answer must not be able to say the same thing.
    it("surfaces a Docker failure rather than reporting an empty window", async () => {
      const telemetry = new ForgeTelemetry({
        docker: docker(async () => {
          throw new Error("Docker /logs responded 500");
        }),
        health: healthService,
        host,
      });

      await expect(
        telemetry.requestLogs("deployment-1", {
          from,
          to,
          requestId: null,
          limit: 100,
        }),
      ).rejects.toThrow("Docker /logs responded 500");
    });
  });
});
