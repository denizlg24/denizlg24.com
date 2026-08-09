import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Database, MetricSampleInput } from "@repo/cloud-core";
import type { ForgeAgentSnapshot } from "@repo/schemas/cloud";

import type { DeployAgentProxy } from "../deploy/proxy";
import { ForgeAgentUnavailableError, ForgeMonitor } from "./monitor";

function snapshot(networkBytes: number): ForgeAgentSnapshot {
  return {
    timestamp: "2026-08-09T12:00:00.000Z",
    health: {
      status: "ok",
      version: "test",
      uptimeSeconds: 1,
      docker: {
        reachable: true,
        version: "27",
        containersRunning: 1,
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
    },
    host: {
      cpu: {
        usagePercent: 25,
        cores: 4,
        load1: 0.5,
        load5: 0.25,
        load15: 0.1,
        temperatureCelsius: 42,
      },
      memory: {
        totalBytes: 100,
        usedBytes: 50,
        availableBytes: 50,
        usagePercent: 50,
      },
    },
    containers: [
      {
        id: "container-1",
        name: "app",
        image: "forge/app:latest",
        imageId: "image-1",
        state: "running",
        status: "Up",
        health: "healthy",
        createdAt: "2026-08-09T12:00:00.000Z",
        deploymentId: "deployment-1",
        targetId: "target-1",
        projectSlug: "app",
        kind: "production",
        metrics: {
          cpuPercent: 1,
          memoryBytes: 2,
          memoryLimitBytes: 4,
          memoryPercent: 50,
          networkRxBytes: networkBytes,
          networkTxBytes: networkBytes * 2,
          blockReadBytes: 0,
          blockWriteBytes: 0,
          pids: 1,
        },
      },
    ],
    images: [],
  };
}

function agent(next: () => ForgeAgentSnapshot) {
  return {
    json: mock(async () => ({
      status: 200,
      body: { snapshot: next() },
    })),
  } as unknown as DeployAgentProxy;
}

function metricsDb(batches: MetricSampleInput[][], error?: Error): Database {
  return {
    insert: () => ({
      values: (rows: MetricSampleInput[]) => {
        batches.push(rows);
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              if (error) throw error;
              return rows.map((row) => ({ ts: row.ts }));
            },
          }),
        };
      },
    }),
  } as unknown as Database;
}

afterEach(() => {
  mock.restore();
});

describe("ForgeMonitor", () => {
  test("reports a missing deploy agent as service unavailable", () => {
    const monitor = new ForgeMonitor({
      db: metricsDb([]),
      deployAgent: null,
    });

    for (const call of [
      () => monitor.runtimeLogs("container-1"),
      () => monitor.restartDeployment("deployment-1"),
    ]) {
      expect(call).toThrow(ForgeAgentUnavailableError);
      try {
        call();
      } catch (error) {
        expect((error as ForgeAgentUnavailableError).status).toBe(503);
        expect((error as ForgeAgentUnavailableError).code).toBe(
          "FORGE_AGENT_UNAVAILABLE",
        );
      }
    }
  });

  test("keeps a collected overview when metric persistence fails", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    const deployAgent = agent(() => snapshot(100));
    const monitor = new ForgeMonitor({
      db: metricsDb([], new Error("database unavailable")),
      deployAgent,
      now: () => new Date("2026-08-09T12:00:00.000Z"),
    });

    const first = await monitor.overview();
    const second = await monitor.overview();

    expect(first.agent?.containers).toHaveLength(1);
    expect(second).toBe(first);
    expect(deployAgent.json).toHaveBeenCalledTimes(1);
  });

  test("stores Docker network counters as per-second rates", async () => {
    const batches: MetricSampleInput[][] = [];
    let bytes = 100;
    let now = new Date("2026-08-09T12:00:00.000Z");
    const monitor = new ForgeMonitor({
      db: metricsDb(batches),
      deployAgent: agent(() => snapshot(bytes)),
      now: () => now,
    });

    await monitor.sample();
    bytes = 160;
    now = new Date("2026-08-09T12:00:30.000Z");
    await monitor.sample();

    const second = batches[1] ?? [];
    expect(
      second.find((row) => row.key.endsWith("network.rx_bytes_per_second")),
    ).toMatchObject({ value: 2, intervalSeconds: 30 });
    expect(
      second.find((row) => row.key.endsWith("network.tx_bytes_per_second")),
    ).toMatchObject({ value: 4, intervalSeconds: 30 });
    expect(second.some((row) => row.key.endsWith("network.rx_bytes"))).toBe(
      false,
    );
  });
});
