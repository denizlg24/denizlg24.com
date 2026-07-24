import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
  parseCpuStat,
  parseDf,
  parseLoadAverage,
  parseMeminfo,
  parseProcNetDev,
} from "./host";

async function fixture(name: string): Promise<string> {
  return Bun.file(join(import.meta.dir, "fixtures", name)).text();
}

describe("host metric parsers", () => {
  it("parses aggregate CPU and core counters", async () => {
    expect(parseCpuStat(await fixture("proc-stat.txt"))).toEqual({
      idle: 410,
      total: 570,
      cores: 2,
    });
  });

  it("uses MemAvailable for memory usage", async () => {
    const memory = parseMeminfo(await fixture("meminfo.txt"));
    expect(memory.totalBytes).toBe(1_024_000_000);
    expect(memory.availableBytes).toBe(256_000_000);
    expect(memory.usagePercent).toBe(75);
  });

  it("parses load averages and network counters", async () => {
    expect(parseLoadAverage("0.25 0.50 0.75 1/100 42")).toEqual({
      load1: 0.25,
      load5: 0.5,
      load15: 0.75,
    });
    expect(parseProcNetDev(await fixture("net-dev.txt"))).toContainEqual({
      interface: "eth0",
      rxBytes: 123_456,
      txBytes: 654_321,
    });
  });

  it("parses GNU and BusyBox portable df output", async () => {
    const gnu = parseDf(await fixture("df-gnu.txt"));
    const busybox = parseDf(await fixture("df-busybox.txt"));
    expect(gnu.get("/dev/nvme0n1p1")).toEqual({
      totalBytes: 10_240_000_000,
      usedBytes: 4_096_000_000,
      availableBytes: 6_144_000_000,
    });
    expect(busybox.get("/dev/mmcblk0p2")?.usedBytes).toBe(6_144_000_000);
  });
});
