import { describe, expect, it } from "bun:test";

import {
  diskSectorsToBytes,
  parseDiskstats,
  parseMeminfo,
  parseMounts,
  parseNetDev,
  parsePressure,
  parseStat,
} from "./proc";

describe("parseStat", () => {
  it("reads the aggregate, every core, and the scalar counters", () => {
    const stat = parseStat(
      [
        "cpu  100 0 50 850 0 0 0 0 0 0",
        "cpu0 50 0 25 425 0 0 0 0 0 0",
        "cpu1 50 0 25 425 0 0 0 0 0 0",
        "intr 12345 1 2 3",
        "ctxt 98765",
        "processes 4321",
        "procs_running 3",
        "procs_blocked 1",
      ].join("\n"),
    );
    expect(stat.aggregate).toEqual({ idle: 850, total: 1_000, cores: 2 });
    expect(stat.cores.get(1)).toEqual({ idle: 425, total: 500 });
    // `intr` is a total followed by a per-IRQ breakdown; only the total is
    // meaningful on its own.
    expect(stat.interrupts).toBe(12_345);
    expect(stat.contextSwitches).toBe(98_765);
    expect(stat.forks).toBe(4_321);
    expect(stat.running).toBe(3);
    expect(stat.blocked).toBe(1);
  });

  // iowait belongs to idle: a core blocked on a disk is not doing work, and
  // counting it as busy makes an IO-bound box look CPU-bound.
  it("counts iowait as idle", () => {
    const stat = parseStat(
      "cpu  10 0 10 60 20 0 0 0\ncpu0 10 0 10 60 20 0 0 0",
    );
    expect(stat.aggregate.idle).toBe(80);
  });

  it("reports the counters as absent rather than zero when the kernel omits them", () => {
    const stat = parseStat("cpu  1 0 1 1\ncpu0 1 0 1 1");
    expect(stat.contextSwitches).toBeNull();
    expect(stat.running).toBeNull();
  });
});

describe("parseMeminfo", () => {
  it("reads swap and the page cache alongside the totals", () => {
    const memory = parseMeminfo(
      [
        "MemTotal:       1000 kB",
        "MemFree:         100 kB",
        "MemAvailable:    250 kB",
        "Buffers:          50 kB",
        "Cached:          300 kB",
        "SwapTotal:       500 kB",
        "SwapFree:        400 kB",
        "Dirty:            10 kB",
        "Slab:             60 kB",
      ].join("\n"),
    );
    expect(memory.usagePercent).toBe(75);
    expect(memory.cachedBytes).toBe(300 * 1_024);
    expect(memory.swapUsedBytes).toBe(100 * 1_024);
    expect(memory.swapUsagePercent).toBe(20);
  });

  // A percentage of nothing is not 100%. A box with swap off has no reading,
  // and reporting one puts a permanent full bar on the page.
  it("reports no swap usage when swap is off", () => {
    const memory = parseMeminfo(
      "MemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB",
    );
    expect(memory.swapUsagePercent).toBeNull();
  });
});

describe("parseDiskstats", () => {
  const line = (name: string) =>
    `   8       0 ${name} 100 0 2000 10 50 0 4000 20 0 30 40`;

  it("keeps whole devices and drops partitions and loops", () => {
    const rows = parseDiskstats(
      [
        line("sda"),
        line("sda1"),
        line("nvme0n1"),
        line("nvme0n1p3"),
        line("loop0"),
        line("dm-0"),
      ].join("\n"),
    );
    // A partition's counters are already inside its parent's, so listing both
    // double-counts every write.
    expect(rows.map((row) => row.device)).toEqual(["sda", "nvme0n1", "dm-0"]);
  });

  it("reads sectors as 512-byte units regardless of the device's own", () => {
    const [row] = parseDiskstats(line("sda"));
    expect(diskSectorsToBytes(row!.sectorsRead)).toBe(2_000 * 512);
    expect(row!.ioMillis).toBe(30);
  });
});

describe("parseNetDev", () => {
  it("reads both directions and skips loopback", () => {
    const rows = parseNetDev(
      [
        "Inter-|   Receive                                                |  Transmit",
        " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
        "    lo: 1 2 0 0 0 0 0 0 1 2 0 0 0 0 0 0",
        "  eth0: 1000 10 1 2 0 0 0 0 2000 20 3 4 0 0 0 0",
      ].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "eth0",
      rxBytes: 1_000,
      rxErrors: 1,
      rxDropped: 2,
      txBytes: 2_000,
      txErrors: 3,
      txDropped: 4,
    });
  });
});

describe("parsePressure", () => {
  it("reads both stall classes", () => {
    const pressure = parsePressure(
      "some avg10=1.50 avg60=0.75 avg300=0.10 total=123\nfull avg10=0.50 avg60=0.25 avg300=0.05 total=45",
    );
    expect(pressure?.some).toEqual({ avg10: 1.5, avg60: 0.75, avg300: 0.1 });
    expect(pressure?.full?.avg10).toBe(0.5);
  });

  // `full` is absent for CPU on most kernels — every task stalled on CPU is not
  // a state the scheduler can be in — so it is null, not zero.
  it("reports a missing full class as absent", () => {
    const pressure = parsePressure(
      "some avg10=0.00 avg60=0.00 avg300=0.00 total=0",
    );
    expect(pressure?.full).toBeNull();
  });

  it("returns nothing for a kernel built without PSI", () => {
    expect(parsePressure("")).toBeNull();
  });
});

describe("parseMounts", () => {
  it("keeps real filesystems and drops kernel bookkeeping", () => {
    const mounts = parseMounts(
      [
        "sysfs /sys sysfs rw 0 0",
        "proc /proc proc rw 0 0",
        "cgroup2 /sys/fs/cgroup cgroup2 rw 0 0",
        "/dev/nvme0n1p2 / ext4 rw 0 0",
        "/dev/sda1 /mnt/storage xfs rw 0 0",
      ].join("\n"),
    );
    expect(mounts.map((mount) => mount.mount)).toEqual(["/", "/mnt/storage"]);
  });

  // A bind mount lists the same device twice; counting its capacity twice
  // would report a box with more disk than it has.
  it("reports a device once however many times it is mounted", () => {
    const mounts = parseMounts(
      "/dev/sda1 /mnt/storage xfs rw 0 0\n/dev/sda1 /srv/forge xfs rw 0 0",
    );
    expect(mounts).toHaveLength(1);
  });

  it("decodes the octal escapes /proc/mounts uses for spaces", () => {
    const [mount] = parseMounts("/dev/sdb1 /mnt/my\\040disk ext4 rw 0 0");
    expect(mount?.mount).toBe("/mnt/my disk");
  });
});
