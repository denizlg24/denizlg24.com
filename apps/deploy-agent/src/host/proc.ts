import type {
  ForgeHostSnapshot,
  ForgePressure,
  ForgePressureResource,
} from "@repo/schemas/cloud";

export interface CpuCounters {
  idle: number;
  total: number;
  cores: number;
}

/** Per-core counters alongside the aggregate, keyed by core index. */
export interface CpuStat {
  aggregate: CpuCounters;
  cores: Map<number, { idle: number; total: number }>;
  contextSwitches: number | null;
  interrupts: number | null;
  forks: number | null;
  running: number | null;
  blocked: number | null;
}

function sumCounters(values: number[]): { idle: number; total: number } {
  return {
    // idle + iowait. A core waiting on a disk is not doing work, and counting
    // iowait as busy makes a box blocked on IO look CPU-bound.
    idle: (values[3] ?? 0) + (values[4] ?? 0),
    total: values.reduce((sum, value) => sum + value, 0),
  };
}

export function parseCpuStat(input: string): CpuCounters {
  const parsed = parseStat(input);
  return parsed.aggregate;
}

/**
 * `/proc/stat` in full: the aggregate line, every per-core line, and the
 * scalar counters below them.
 *
 * The scalars are monotonic since boot, so what the caller does with them is
 * differentiate — the raw numbers are meaningless on their own and enormous
 * enough to lose precision if charted.
 */
export function parseStat(input: string): CpuStat {
  const lines = input.split(/\r?\n/);
  const aggregateLine = lines.find((line) => line.startsWith("cpu "));
  if (!aggregateLine) throw new Error("/proc/stat has no aggregate CPU row");
  const values = aggregateLine.trim().split(/\s+/).slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("/proc/stat has invalid CPU counters");
  }

  const cores = new Map<number, { idle: number; total: number }>();
  const scalars = new Map<string, number>();
  for (const line of lines) {
    const core = /^cpu(\d+)\s/.exec(line);
    if (core?.[1]) {
      const numbers = line.trim().split(/\s+/).slice(1).map(Number);
      if (numbers.every(Number.isFinite)) {
        cores.set(Number(core[1]), sumCounters(numbers));
      }
      continue;
    }
    const scalar =
      /^(ctxt|intr|processes|procs_running|procs_blocked)\s+(\d+)/.exec(line);
    if (scalar?.[1] && scalar[2]) scalars.set(scalar[1], Number(scalar[2]));
  }

  return {
    aggregate: { ...sumCounters(values), cores: cores.size },
    cores,
    contextSwitches: scalars.get("ctxt") ?? null,
    // `intr` is a total followed by a per-IRQ breakdown; only the total is
    // matched above, which is the only part worth charting.
    interrupts: scalars.get("intr") ?? null,
    forks: scalars.get("processes") ?? null,
    running: scalars.get("procs_running") ?? null,
    blocked: scalars.get("procs_blocked") ?? null,
  };
}

export function parseMeminfo(input: string): ForgeHostSnapshot["memory"] {
  const values = new Map<string, number>();
  for (const line of input.split(/\r?\n/)) {
    const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB$/.exec(line);
    if (match?.[1] && match[2]) values.set(match[1], Number(match[2]) * 1_024);
  }
  const totalBytes = values.get("MemTotal") ?? 0;
  if (totalBytes <= 0) throw new Error("/proc/meminfo has no MemTotal");
  const availableBytes =
    values.get("MemAvailable") ??
    (values.get("MemFree") ?? 0) +
      (values.get("Buffers") ?? 0) +
      (values.get("Cached") ?? 0);
  const usedBytes = Math.max(totalBytes - availableBytes, 0);
  const swapTotalBytes = values.get("SwapTotal") ?? null;
  const swapFreeBytes = values.get("SwapFree") ?? null;
  const swapUsedBytes =
    swapTotalBytes !== null && swapFreeBytes !== null
      ? Math.max(swapTotalBytes - swapFreeBytes, 0)
      : null;

  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usagePercent: (usedBytes / totalBytes) * 100,
    freeBytes: values.get("MemFree") ?? null,
    cachedBytes: values.get("Cached") ?? null,
    buffersBytes: values.get("Buffers") ?? null,
    dirtyBytes: values.get("Dirty") ?? null,
    slabBytes: values.get("Slab") ?? null,
    swapTotalBytes,
    swapUsedBytes,
    // A box with swap off reports SwapTotal 0, and a percentage of nothing is
    // not 100% — it is the absence of a reading.
    swapUsagePercent:
      swapTotalBytes !== null && swapTotalBytes > 0 && swapUsedBytes !== null
        ? (swapUsedBytes / swapTotalBytes) * 100
        : null,
  };
}

export function parseLoadAverage(input: string): {
  load1: number;
  load5: number;
  load15: number;
} {
  const [load1, load5, load15] = input
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map(Number);
  if (![load1, load5, load15].every(Number.isFinite)) {
    throw new Error("/proc/loadavg has invalid values");
  }
  return { load1: load1!, load5: load5!, load15: load15! };
}

export interface DiskCounters {
  device: string;
  readsCompleted: number;
  sectorsRead: number;
  writesCompleted: number;
  sectorsWritten: number;
  /** Milliseconds spent with IO in flight; the basis for utilization. */
  ioMillis: number;
  weightedIoMillis: number;
}

/**
 * Devices that are views of another device rather than hardware.
 *
 * `loop` is a mounted file, `ram` is a ramdisk, and a partition's counters are
 * already inside its parent's — charting all three triple-counts the same
 * writes. Device mapper and MD arrays are kept: those genuinely are where the
 * IO lands on a box using LVM or RAID.
 */
function isVirtualDevice(device: string): boolean {
  return (
    device.startsWith("loop") ||
    device.startsWith("ram") ||
    device.startsWith("zram") ||
    device.startsWith("sr") ||
    // `sda1`, `nvme0n1p2` — a partition of a disk already listed.
    /^(sd[a-z]+|vd[a-z]+|hd[a-z]+)\d+$/.test(device) ||
    /^nvme\d+n\d+p\d+$/.test(device) ||
    /^mmcblk\d+p\d+$/.test(device)
  );
}

/** A sector is 512 bytes in `/proc/diskstats` regardless of the device's own. */
const SECTOR_BYTES = 512;

export function parseDiskstats(input: string): DiskCounters[] {
  const rows: DiskCounters[] = [];
  for (const line of input.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    // major minor name, then at least the first eleven stat fields.
    if (fields.length < 14) continue;
    const device = fields[2];
    if (!device || isVirtualDevice(device)) continue;
    const numbers = fields.slice(3).map(Number);
    if (numbers.slice(0, 11).some((value) => !Number.isFinite(value))) continue;
    rows.push({
      device,
      readsCompleted: numbers[0] ?? 0,
      sectorsRead: numbers[2] ?? 0,
      writesCompleted: numbers[4] ?? 0,
      sectorsWritten: numbers[6] ?? 0,
      ioMillis: numbers[9] ?? 0,
      weightedIoMillis: numbers[10] ?? 0,
    });
  }
  return rows;
}

export function diskSectorsToBytes(sectors: number): number {
  return sectors * SECTOR_BYTES;
}

export interface NetCounters {
  name: string;
  rxBytes: number;
  rxPackets: number;
  rxErrors: number;
  rxDropped: number;
  txBytes: number;
  txPackets: number;
  txErrors: number;
  txDropped: number;
}

export function parseNetDev(input: string): NetCounters[] {
  const rows: NetCounters[] = [];
  for (const line of input.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    if (name.length === 0 || name === "lo") continue;
    const numbers = line
      .slice(separator + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    if (numbers.length < 16 || numbers.some((value) => !Number.isFinite(value)))
      continue;
    rows.push({
      name,
      rxBytes: numbers[0] ?? 0,
      rxPackets: numbers[1] ?? 0,
      rxErrors: numbers[2] ?? 0,
      rxDropped: numbers[3] ?? 0,
      txBytes: numbers[8] ?? 0,
      txPackets: numbers[9] ?? 0,
      txErrors: numbers[10] ?? 0,
      txDropped: numbers[11] ?? 0,
    });
  }
  return rows;
}

/**
 * One `/proc/pressure/*` file.
 *
 * `full` is absent for CPU on most kernels — every task being stalled on CPU is
 * not a state the scheduler can be in — so it is nullable rather than zeroed.
 */
export function parsePressure(input: string): ForgePressure["cpu"] {
  const read = (prefix: string) => {
    const line = input
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${prefix} `));
    if (!line) return null;
    const values = new Map<string, number>();
    for (const pair of line.trim().split(/\s+/).slice(1)) {
      const [key, value] = pair.split("=");
      if (key && value !== undefined) values.set(key, Number(value));
    }
    const avg10 = values.get("avg10");
    const avg60 = values.get("avg60");
    const avg300 = values.get("avg300");
    if (![avg10, avg60, avg300].every(Number.isFinite)) return null;
    return { avg10: avg10!, avg60: avg60!, avg300: avg300! };
  };
  const some = read("some");
  if (!some) return null;
  const result: ForgePressureResource = { some, full: read("full") };
  return result;
}

export interface MountEntry {
  device: string;
  mount: string;
  fstype: string;
}

/**
 * Real filesystems only.
 *
 * `/proc/mounts` lists sixty-odd entries on a modern box, nearly all of them
 * kernel bookkeeping (cgroup, sysfs, tracefs) or a bind mount showing the same
 * device again. What is wanted is "the disks, and how full they are", so the
 * filter is by filesystem type and each device is reported once.
 */
const REAL_FSTYPES = new Set([
  "ext2",
  "ext3",
  "ext4",
  "xfs",
  "btrfs",
  "zfs",
  "f2fs",
  "jfs",
  "reiserfs",
  "vfat",
  "exfat",
  "ntfs",
  "ntfs3",
]);

export function parseMounts(input: string): MountEntry[] {
  const seen = new Set<string>();
  const rows: MountEntry[] = [];
  for (const line of input.split(/\r?\n/)) {
    const [device, rawMount, fstype] = line.split(/\s+/);
    if (!device || !rawMount || !fstype) continue;
    if (!REAL_FSTYPES.has(fstype)) continue;
    if (seen.has(device)) continue;
    seen.add(device);
    // `/proc/mounts` octal-escapes spaces and tabs in the mount point.
    const mount = rawMount
      .replaceAll("\\040", " ")
      .replaceAll("\\011", "\t")
      .replaceAll("\\134", "\\");
    rows.push({ device, mount, fstype });
  }
  return rows;
}
