import { describe, expect, it } from "bun:test";

import type { DockerClient } from "./docker";
import { diskUsageFrom, HealthService, type StatfsLike } from "./health";

const HEALTHY_DISK: StatfsLike = async () => ({
  bsize: 4_096,
  blocks: 1_000_000,
  bfree: 800_000,
  bavail: 800_000,
});

function dockerStub(
  ping: () => Promise<{
    version: string;
    containersRunning: number;
  }>,
): DockerClient {
  return { ping } as unknown as DockerClient;
}

const OK_DOCKER = dockerStub(async () => ({
  version: "27.1.1",
  containersRunning: 3,
}));

function service(
  overrides: { docker?: DockerClient; statfsImplementation?: StatfsLike } = {},
) {
  return new HealthService({
    docker: overrides.docker ?? OK_DOCKER,
    dockerDataRoot: "/var/lib/docker",
    version: "test",
    queue: () => ({ running: 0, capacity: 1, deploymentIds: [] }),
    statfsImplementation: overrides.statfsImplementation ?? HEALTHY_DISK,
    now: () => 10_000,
    startedAt: 0,
  });
}

describe("diskUsageFrom", () => {
  it("measures usage the way df does, against usable blocks", () => {
    // 1000 blocks, 200 free to root, 100 available to everyone else. df counts
    // 800 used out of 900 usable, not out of 1000.
    const usage = diskUsageFrom({
      bsize: 1_024,
      blocks: 1_000,
      bfree: 200,
      bavail: 100,
    });
    expect(usage.totalBytes).toBe(1_024_000);
    expect(usage.freeBytes).toBe(102_400);
    expect(usage.usedPercent).toBeCloseTo(88.89, 1);
  });

  it("does not divide by zero on an empty filesystem", () => {
    expect(
      diskUsageFrom({ bsize: 4_096, blocks: 0, bfree: 0, bavail: 0 })
        .usedPercent,
    ).toBe(0);
  });
});

describe("HealthService", () => {
  it("reports ok when docker answers and the disk has room", async () => {
    const health = await service().check();
    expect(health.status).toBe("ok");
    expect(health.docker.reachable).toBe(true);
    expect(health.docker.version).toBe("27.1.1");
    expect(health.uptimeSeconds).toBe(10);
  });

  it("reports unavailable when docker is unreachable", async () => {
    const health = await service({
      docker: dockerStub(async () => {
        throw new Error("connect ENOENT /var/run/docker.sock");
      }),
    }).check();
    expect(health.status).toBe("unavailable");
    expect(health.docker.reachable).toBe(false);
    expect(health.docker.error).toContain("ENOENT");
  });

  it("reports unavailable when the disk cannot be stat'd", async () => {
    const health = await service({
      statfsImplementation: async () => {
        throw new Error("ENOENT");
      },
    }).check();
    expect(health.status).toBe("unavailable");
    expect(health.disk.error).toContain("ENOENT");
  });

  it("degrades before it fails as the disk fills", async () => {
    const at =
      (usedFraction: number): StatfsLike =>
      async () => ({
        bsize: 4_096,
        blocks: 1_000_000,
        bfree: 1_000_000 * (1 - usedFraction),
        bavail: 1_000_000 * (1 - usedFraction),
      });
    expect(
      (await service({ statfsImplementation: at(0.9) }).check()).status,
    ).toBe("degraded");
    expect(
      (await service({ statfsImplementation: at(0.98) }).check()).status,
    ).toBe("unavailable");
  });
});
