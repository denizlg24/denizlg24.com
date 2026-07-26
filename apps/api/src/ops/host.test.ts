import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
  diskActivityBetween,
  diskstatsKey,
  HostCollector,
  hasDeviceRows,
  parseCpuStat,
  parseDf,
  parseDiskstats,
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

  it("parses /proc/diskstats, including partition rows", async () => {
    const stats = parseDiskstats(await fixture("diskstats.txt"));
    expect(stats.get("nvme0n1p1")).toEqual({
      device: "nvme0n1p1",
      readsCompleted: 799_000,
      sectorsRead: 63_900_000,
      writesCompleted: 399_000,
      sectorsWritten: 31_900_000,
      ioMs: 119_000,
    });
    // Whole disk and its partition are tracked separately; the devices env
    // names partitions, so the partition row is the one that matters.
    expect(stats.get("nvme0n1")?.sectorsRead).toBe(64_000_000);
    // Every well-formed row is kept — the collector selects the configured
    // devices, so filtering ramdisks here would just be a second policy.
    expect(stats.get("ram0")?.sectorsRead).toBe(0);
  });

  it("skips rows that are too short to carry counters", () => {
    expect(parseDiskstats("").size).toBe(0);
    expect(parseDiskstats("   8       0 sda 500 10 4000\n").size).toBe(0);
    expect(parseDiskstats("garbage line without numbers\n").size).toBe(0);
  });

  it("maps /dev paths to diskstats device names", () => {
    expect(diskstatsKey("/dev/nvme0n1p1")).toBe("nvme0n1p1");
    expect(diskstatsKey("/dev/mmcblk0p2")).toBe("mmcblk0p2");
    expect(diskstatsKey("nvme0n1p1")).toBe("nvme0n1p1");
  });

  it("derives disk rates from counter deltas, with 512-byte sectors", () => {
    const previous = {
      device: "nvme0n1p1",
      readsCompleted: 1_000,
      sectorsRead: 2_000,
      writesCompleted: 500,
      sectorsWritten: 1_000,
      ioMs: 5_000,
    };
    const current = {
      device: "nvme0n1p1",
      readsCompleted: 1_100,
      sectorsRead: 4_000,
      writesCompleted: 600,
      sectorsWritten: 3_000,
      ioMs: 10_000,
    };

    expect(diskActivityBetween(previous, current, 10)).toEqual({
      readBytesPerSecond: (2_000 * 512) / 10,
      writeBytesPerSecond: (2_000 * 512) / 10,
      readOpsPerSecond: 10,
      writeOpsPerSecond: 10,
      utilizationPercent: 50,
    });
  });

  it("clamps utilization and floors counter wraparound at zero", () => {
    const base = {
      device: "sda",
      readsCompleted: 0,
      sectorsRead: 0,
      writesCompleted: 0,
      sectorsWritten: 0,
      ioMs: 0,
    };
    // Parallel NVMe queues can accumulate more busy-ms than wall time.
    const busy = { ...base, ioMs: 20_000 };
    expect(diskActivityBetween(base, busy, 10).utilizationPercent).toBe(100);

    // A device reset makes the new counters smaller than the old ones; a
    // negative rate would render as a downward spike.
    const reset = { ...base, sectorsRead: 100, ioMs: 100 };
    expect(diskActivityBetween(reset, base, 10).readBytesPerSecond).toBe(0);
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
    const collector = new HostCollector(
      [
        { device: "/dev/online", kind: "ssd" },
        { device: "/dev/missing", kind: "hdd" },
      ],
      {
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
      },
    );

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
      expect.objectContaining({
        device: "/dev/online",
        kind: "ssd",
        online: true,
      }),
    );
    expect(second.disks).toContainEqual({
      device: "/dev/missing",
      kind: "hdd",
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
              isSymbolicLink: () => false,
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

  // Real sysfs exposes thermal_zone* as symlinks into /sys/devices, so a
  // directory-only filter finds no sensors and the dashboard shows no
  // temperature at all.
  it("reads zones exposed as symlinks", async () => {
    const temperature = await readCpuTemperature(
      {
        readdir: async () => [
          {
            name: "thermal_zone0",
            isDirectory: () => false,
            isSymbolicLink: () => true,
          },
        ],
        readFile: async () => "40800\n",
      },
      ["/host/sys/class/thermal"],
    );
    expect(temperature).toBe(40.8);
  });

  it("ignores entries that are neither directories nor symlinks", async () => {
    const temperature = await readCpuTemperature(
      {
        readdir: async () => [
          {
            name: "thermal_zone0",
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ],
        readFile: async () => "40800\n",
      },
      ["/host/sys/class/thermal"],
    );
    expect(temperature).toBeNull();
  });
});

describe("df partial-failure tolerance", () => {
  // Mounting the host root exposes paths the unprivileged container user cannot
  // stat, so df exits 1 on a healthy Pi while still reporting every filesystem.
  // Discarding that output marked every disk offline in production.
  it("still finds device rows when df also printed permission errors", () => {
    const output = [
      "Filesystem           1024-blocks    Used Available Capacity Mounted on",
      "/dev/mmcblk0p2          60789696 12624592  45640772      22% /host-control",
      "/dev/nvme0n1p1         983378332 40032656 893319132       4% /data/ssd",
    ].join("\n");
    expect(hasDeviceRows(output)).toBe(true);
    expect(parseDf(output).get("/dev/nvme0n1p1")?.totalBytes).toBe(
      983378332 * 1024,
    );
  });

  it("reports no usable rows when df produced only a header", () => {
    expect(
      hasDeviceRows(
        "Filesystem 1024-blocks Used Available Capacity Mounted on",
      ),
    ).toBe(false);
    expect(hasDeviceRows("")).toBe(false);
  });
});
