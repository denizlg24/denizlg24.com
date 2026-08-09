import { describe, expect, it } from "bun:test";

import type { DockerClient } from "./docker";
import {
  allocatableMemoryMb,
  diskUsageFrom,
  HealthService,
  parseMeminfo,
  type StatfsLike,
} from "./health";

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

const MEMINFO = [
  "MemTotal:        8192000 kB",
  "MemAvailable:    4096000 kB",
].join("\n");

function service(
  overrides: {
    docker?: DockerClient;
    statfsImplementation?: StatfsLike;
    readMeminfo?: () => Promise<string>;
  } = {},
) {
  return new HealthService({
    docker: overrides.docker ?? OK_DOCKER,
    dockerDataRoot: "/var/lib/docker",
    version: "test",
    queue: () => ({ running: 0, capacity: 1, deploymentIds: [] }),
    memoryHeadroomMb: 1_024,
    buildReserveMb: 2_048,
    statfsImplementation: overrides.statfsImplementation ?? HEALTHY_DISK,
    readMeminfo: overrides.readMeminfo ?? (async () => MEMINFO),
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

describe("parseMeminfo", () => {
  it("reads MemTotal and MemAvailable in MB", () => {
    const parsed = parseMeminfo(
      [
        "MemTotal:        8192000 kB",
        "MemFree:          512000 kB",
        "MemAvailable:    4096000 kB",
        "Buffers:          128000 kB",
      ].join("\n"),
    );

    expect(parsed).toEqual({ totalMb: 8_000, availableMb: 4_000 });
  });

  it("returns null when the fields are absent", () => {
    // Reported as unknown rather than as a host with no memory, which would
    // refuse every deploy.
    expect(parseMeminfo("MemFree: 512000 kB")).toBeNull();
  });
});

describe("allocatableMemoryMb", () => {
  it("subtracts the headroom and the whole build reserve", () => {
    // The build reserve is the term that causes the outage when it is left
    // out: a build takes gigabytes it is not holding yet.
    expect(
      allocatableMemoryMb({
        totalMb: 8_000,
        headroomMb: 1_024,
        buildReserveMb: 6_144,
      }),
    ).toBe(832);
  });

  it("never goes negative", () => {
    expect(
      allocatableMemoryMb({
        totalMb: 1_000,
        headroomMb: 1_024,
        buildReserveMb: 6_144,
      }),
    ).toBe(0);
  });
});

describe("HealthService memory", () => {
  it("reports the host budget", async () => {
    const health = await service().check();

    expect(health.memory?.totalMb).toBe(8_000);
    expect(health.memory?.allocatableMb).toBe(8_000 - 1_024 - 2_048);
  });

  it("does not fail the status when memory cannot be read", async () => {
    // A host whose memory is unreadable can still deploy; the control plane
    // reads a null budget as unknown and skips admission.
    const health = await service({
      readMeminfo: async () => {
        throw new Error("no /proc");
      },
    }).check();

    expect(health.status).toBe("ok");
    expect(health.memory?.allocatableMb).toBeNull();
    expect(health.memory?.error).toBe("no /proc");
  });

  it("is unavailable when the host cannot fit even the smallest target", async () => {
    const health = await service({
      readMeminfo: async () =>
        ["MemTotal: 3072000 kB", "MemAvailable: 2048000 kB"].join("\n"),
    }).check();

    expect(health.memory?.allocatableMb).toBe(0);
    expect(health.status).toBe("unavailable");
  });
});
