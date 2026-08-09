import { describe, expect, it } from "bun:test";
import type { AgentHealth } from "@repo/schemas/cloud";

import type { DockerClient, ForgeDockerContainer } from "./docker";
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
const host = {
  collect: async () => ({
    cpu: {
      usagePercent: 10,
      cores: 4,
      load1: 0.1,
      load5: 0.2,
      load15: 0.3,
      temperatureCelsius: 42,
    },
    memory: {
      totalBytes: 100,
      usedBytes: 50,
      availableBytes: 50,
      usagePercent: 50,
    },
  }),
};

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
});
