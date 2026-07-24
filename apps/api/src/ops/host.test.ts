import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
  HostCollector,
  parseCpuStat,
  parseDf,
  parseLoadAverage,
  parseMeminfo,
  parseProcNetDev,
  readCpuTemperature,
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

  it("collects stateful CPU and network deltas and offline disks", async () => {
    const procInputs = new Map<string, string[]>([
      [
        "stat",
        [
          "cpu 60 0 0 40 0 0 0 0\ncpu0 60 0 0 40 0 0 0 0\n",
          "cpu 140 0 0 60 0 0 0 0\ncpu0 140 0 0 60 0 0 0 0\n",
        ],
      ],
      [
        "meminfo",
        [
          "MemTotal: 1000 kB\nMemAvailable: 250 kB\n",
          "MemTotal: 1000 kB\nMemAvailable: 250 kB\n",
        ],
      ],
      ["loadavg", ["0.1 0.2 0.3 1/10 1", "0.4 0.5 0.6 1/10 2"]],
      [
        "net/dev",
        [
          "Inter-| Receive | Transmit\n face |bytes |bytes\neth0: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0\n",
          "Inter-| Receive | Transmit\n face |bytes |bytes\neth0: 300 0 0 0 0 0 0 0 500 0 0 0 0 0 0 0\n",
        ],
      ],
    ]);
    const times = [1_000, 2_000];
    const collector = new HostCollector(["/dev/online", "/dev/missing"], {
      now: () => times.shift() ?? 2_000,
      readProc: async (path) => {
        const value = procInputs.get(path)?.shift();
        if (!value) throw new Error(`Missing mocked ${path}`);
        return value;
      },
      readDf: async () =>
        "Filesystem 1024-blocks Used Available Capacity Mounted on\n" +
        "/dev/online 1000 400 600 40% /data\n",
      readTemperature: async () => 42,
    });

    const first = await collector.collect();
    const second = await collector.collect();

    expect(first.cpu.usagePercent).toBe(60);
    expect(first.network[0]).toEqual({
      interface: "eth0",
      rxBytesPerSecond: 0,
      txBytesPerSecond: 0,
    });
    expect(second.cpu.usagePercent).toBe(80);
    expect(second.network[0]).toEqual({
      interface: "eth0",
      rxBytesPerSecond: 200,
      txBytesPerSecond: 300,
    });
    expect(second.cpu.temperatureCelsius).toBe(42);
    expect(second.disks).toContainEqual(
      expect.objectContaining({ device: "/dev/online", online: true }),
    );
    expect(second.disks).toContainEqual({
      device: "/dev/missing",
      totalBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
      usagePercent: 0,
      online: false,
    });
  });

  it("falls back to the container sysfs temperature root", async () => {
    const roots: string[] = [];
    const temperature = await readCpuTemperature(
      {
        readdir: async (root) => {
          roots.push(root);
          if (root === "/host/sys") throw new Error("host sysfs unavailable");
          return [
            {
              name: "thermal_zone0",
              isDirectory: () => true,
            },
          ];
        },
        readFile: async (path) => {
          expect(path).toBe("/sys/thermal_zone0/temp");
          return "42500\n";
        },
      },
      ["/host/sys", "/sys"],
    );

    expect(roots).toEqual(["/host/sys", "/sys"]);
    expect(temperature).toBe(42.5);
  });
});
