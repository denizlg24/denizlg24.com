import { readdir, readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import type { DiskInfo, DiskKind, OpsOverview } from "@repo/schemas/cloud";

export interface CpuCounters {
  idle: number;
  total: number;
  cores: number;
}

export interface NetworkCounters {
  interface: string;
  rxBytes: number;
  txBytes: number;
}

export interface DiskDevice {
  device: string;
  kind: DiskKind;
}

export function parseCpuStat(input: string): CpuCounters {
  const lines = input.split(/\r?\n/);
  const aggregate = lines.find((line) => line.startsWith("cpu "));
  if (!aggregate) {
    throw new Error("/proc/stat does not contain aggregate CPU counters");
  }
  const values = aggregate.trim().split(/\s+/).slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("/proc/stat contains invalid CPU counters");
  }
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    idle,
    total,
    cores: lines.filter((line) => /^cpu\d+\s/.test(line)).length,
  };
}

export function parseMeminfo(input: string): {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
} {
  const values = new Map<string, number>();
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
    if (match?.[1] && match[2]) {
      values.set(match[1], Number(match[2]) * 1_024);
    }
  }
  const totalBytes = values.get("MemTotal") ?? 0;
  const availableBytes =
    values.get("MemAvailable") ??
    (values.get("MemFree") ?? 0) +
      (values.get("Buffers") ?? 0) +
      (values.get("Cached") ?? 0);
  if (totalBytes <= 0) {
    throw new Error("/proc/meminfo does not contain MemTotal");
  }
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usagePercent: (usedBytes / totalBytes) * 100,
  };
}

export function parseLoadAverage(input: string): {
  load1: number;
  load5: number;
  load15: number;
} {
  const parts = input.trim().split(/\s+/, 3);
  const load1 = Number(parts[0]);
  const load5 = Number(parts[1]);
  const load15 = Number(parts[2]);
  if (
    !Number.isFinite(load1) ||
    !Number.isFinite(load5) ||
    !Number.isFinite(load15)
  ) {
    throw new Error("/proc/loadavg contains invalid values");
  }
  return { load1, load5, load15 };
}

export function parseProcNetDev(input: string): NetworkCounters[] {
  return input
    .split(/\r?\n/)
    .slice(2)
    .flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator < 0) return [];
      const interfaceName = line.slice(0, separator).trim();
      const values = line
        .slice(separator + 1)
        .trim()
        .split(/\s+/)
        .map(Number);
      const rxBytes = values[0];
      const txBytes = values[8];
      if (
        !interfaceName ||
        rxBytes === undefined ||
        txBytes === undefined ||
        !Number.isFinite(rxBytes) ||
        !Number.isFinite(txBytes)
      ) {
        return [];
      }
      return [{ interface: interfaceName, rxBytes, txBytes }];
    });
}

/**
 * Kernel sectors are always 512 bytes in /proc/diskstats, regardless of the
 * device's physical sector size.
 */
const DISKSTAT_SECTOR_BYTES = 512;

export interface DiskCounters {
  /** Kernel device name, e.g. `nvme0n1p1` — no `/dev/` prefix. */
  device: string;
  readsCompleted: number;
  sectorsRead: number;
  writesCompleted: number;
  sectorsWritten: number;
  /** Cumulative milliseconds spent with I/O in flight. */
  ioMs: number;
}

/**
 * Fields are documented in the kernel's Documentation/admin-guide/iostats.rst:
 * after `major minor name` come reads-completed, reads-merged, sectors-read,
 * ms-reading, writes-completed, writes-merged, sectors-written, ms-writing,
 * ios-in-progress, ms-doing-io, weighted-ms. Partitions carry the same first
 * eleven fields as whole disks on modern kernels, which is what makes tracking
 * `/dev/nvme0n1p1` rather than `/dev/nvme0n1` work.
 */
export function parseDiskstats(input: string): Map<string, DiskCounters> {
  const result = new Map<string, DiskCounters>();
  for (const line of input.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 14) continue;
    const device = columns[2];
    const values = columns.slice(3).map(Number);
    const [readsCompleted, , sectorsRead, , writesCompleted, , sectorsWritten] =
      values;
    const ioMs = values[9];
    if (
      !device ||
      readsCompleted === undefined ||
      sectorsRead === undefined ||
      writesCompleted === undefined ||
      sectorsWritten === undefined ||
      ioMs === undefined ||
      ![
        readsCompleted,
        sectorsRead,
        writesCompleted,
        sectorsWritten,
        ioMs,
      ].every(Number.isFinite)
    ) {
      continue;
    }
    result.set(device, {
      device,
      readsCompleted,
      sectorsRead,
      writesCompleted,
      sectorsWritten,
      ioMs,
    });
  }
  return result;
}

/** `/dev/nvme0n1p1` -> `nvme0n1p1`, to match the diskstats device column. */
export function diskstatsKey(device: string): string {
  return device.replace(/^\/dev\//, "");
}

export interface DiskActivity {
  readBytesPerSecond: number;
  writeBytesPerSecond: number;
  readOpsPerSecond: number;
  writeOpsPerSecond: number;
  utilizationPercent: number;
}

export function diskActivityBetween(
  previous: DiskCounters,
  current: DiskCounters,
  elapsedSeconds: number,
): DiskActivity {
  const perSecond = (delta: number) => Math.max(0, delta) / elapsedSeconds;
  return {
    readBytesPerSecond:
      perSecond(current.sectorsRead - previous.sectorsRead) *
      DISKSTAT_SECTOR_BYTES,
    writeBytesPerSecond:
      perSecond(current.sectorsWritten - previous.sectorsWritten) *
      DISKSTAT_SECTOR_BYTES,
    readOpsPerSecond: perSecond(
      current.readsCompleted - previous.readsCompleted,
    ),
    writeOpsPerSecond: perSecond(
      current.writesCompleted - previous.writesCompleted,
    ),
    // Busy time over wall time. Queued parallel requests can push this past
    // 100% on NVMe, so it is clamped for display sanity.
    utilizationPercent: Math.min(
      100,
      (Math.max(0, current.ioMs - previous.ioMs) / (elapsedSeconds * 1_000)) *
        100,
    ),
  };
}

export function parseDf(
  input: string,
): Map<
  string,
  { totalBytes: number; usedBytes: number; availableBytes: number }
> {
  const result = new Map<
    string,
    { totalBytes: number; usedBytes: number; availableBytes: number }
  >();
  const lines = input.trim().split(/\r?\n/).slice(1);
  for (const line of lines) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 6) continue;
    const [device, blocks, used, available] = columns;
    const totalBlocks = Number(blocks);
    const usedBlocks = Number(used);
    const availableBlocks = Number(available);
    if (
      !device?.startsWith("/dev/") ||
      !Number.isFinite(totalBlocks) ||
      !Number.isFinite(usedBlocks) ||
      !Number.isFinite(availableBlocks)
    ) {
      continue;
    }
    result.set(device, {
      totalBytes: totalBlocks * 1_024,
      usedBytes: usedBlocks * 1_024,
      availableBytes: availableBlocks * 1_024,
    });
  }
  return result;
}

async function readHostProc(path: string): Promise<string> {
  try {
    return await readFile(`/host/proc/${path}`, "utf8");
  } catch {
    return readFile(`/proc/${path}`, "utf8");
  }
}

export interface ThermalEntry {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface TemperatureReader {
  readdir(root: string): Promise<readonly ThermalEntry[]>;
  readFile(path: string): Promise<string>;
}

const defaultTemperatureReader: TemperatureReader = {
  readdir: (root) => readdir(root, { withFileTypes: true }),
  readFile: (path) => readFile(path, "utf8"),
};

export async function readCpuTemperature(
  reader: TemperatureReader = defaultTemperatureReader,
  roots: readonly string[] = ["/host/sys/class/thermal", "/sys/class/thermal"],
): Promise<number | null> {
  for (const root of roots) {
    try {
      const entries = await reader.readdir(root);
      const temperatures = await Promise.all(
        entries
          // sysfs exposes thermal_zone* as symlinks into /sys/devices, so
          // isDirectory() is false for every one of them and filtering on it
          // alone finds no sensors at all.
          .filter(
            (entry) =>
              (entry.isDirectory() || entry.isSymbolicLink()) &&
              entry.name.startsWith("thermal_zone"),
          )
          .map(async (entry) => {
            const raw = await reader.readFile(`${root}/${entry.name}/temp`);
            const value = Number(raw.trim());
            return Number.isFinite(value) ? value / 1_000 : null;
          }),
      );
      const valid = temperatures.filter(
        (value): value is number => value !== null,
      );
      if (valid.length > 0) return Math.max(...valid);
    } catch {
      // Try the container-local sysfs fallback.
    }
  }
  return null;
}

async function readDf(): Promise<string> {
  if (process.platform === "win32") return "";
  const processHandle = Bun.spawn(["df", "-kP"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  // `df` exits non-zero when it cannot stat *any* mount point, even though it
  // still reports every filesystem it could read. Mounting the host root at
  // /host/rootfs exposes paths like /host/rootfs/run/docker/netns/* that the
  // unprivileged container user cannot stat, so a healthy Pi always exits 1.
  // Treating that as fatal loses every disk reading and reports all disks
  // offline, so only fail when nothing usable came back.
  if (exitCode !== 0 && !hasDeviceRows(stdout)) {
    throw new Error(`df failed (${exitCode}): ${stderr.slice(-2_000)}`);
  }
  return stdout;
}

export function hasDeviceRows(output: string): boolean {
  return output.split(/\r?\n/).some((line) => line.trim().startsWith("/dev/"));
}

export interface HostCollectorDependencies {
  now(): number;
  readDf(): Promise<string>;
  readProc(path: string): Promise<string>;
  readTemperature(): Promise<number | null>;
}

const defaultHostCollectorDependencies: HostCollectorDependencies = {
  now: Date.now,
  readDf,
  readProc: readHostProc,
  readTemperature: readCpuTemperature,
};

function fallbackCpuCounters(): CpuCounters {
  const cpuInfo = cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpuInfo) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total, cores: cpuInfo.length };
}

function diskInfo(
  disk: DiskDevice,
  values:
    | { totalBytes: number; usedBytes: number; availableBytes: number }
    | undefined,
  activity: DiskActivity | undefined,
): DiskInfo {
  if (!values) {
    return {
      ...disk,
      totalBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
      usagePercent: 0,
      online: false,
    };
  }
  return {
    ...disk,
    ...values,
    ...activity,
    usagePercent:
      values.totalBytes > 0 ? (values.usedBytes / values.totalBytes) * 100 : 0,
    online: true,
  };
}

export class HostCollector {
  private readonly dependencies: HostCollectorDependencies;
  private previousCpu: CpuCounters | null = null;
  private previousNetwork = new Map<string, NetworkCounters>();
  private previousNetworkAt: number | null = null;
  private previousDisk = new Map<string, DiskCounters>();
  private previousDiskAt: number | null = null;

  constructor(
    private readonly devices: readonly DiskDevice[],
    dependencies: Partial<HostCollectorDependencies> = {},
  ) {
    this.dependencies = {
      ...defaultHostCollectorDependencies,
      ...dependencies,
    };
  }

  async collect(): Promise<
    Pick<OpsOverview, "cpu" | "memory" | "disks" | "network">
  > {
    const now = this.dependencies.now();
    const [
      cpuResult,
      memoryResult,
      loadResult,
      networkResult,
      dfResult,
      diskstatsResult,
      temp,
    ] = await Promise.all([
      this.dependencies
        .readProc("stat")
        .then(parseCpuStat)
        .catch(() => fallbackCpuCounters()),
      this.dependencies
        .readProc("meminfo")
        .then(parseMeminfo)
        .catch(() => {
          const totalBytes = totalmem();
          const availableBytes = freemem();
          const usedBytes = totalBytes - availableBytes;
          return {
            totalBytes,
            availableBytes,
            usedBytes,
            usagePercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
          };
        }),
      this.dependencies
        .readProc("loadavg")
        .then(parseLoadAverage)
        .catch(() => ({ load1: 0, load5: 0, load15: 0 })),
      this.dependencies
        .readProc("net/dev")
        .then(parseProcNetDev)
        .catch(() => []),
      this.dependencies
        .readDf()
        .then(parseDf)
        .catch(() => new Map()),
      this.dependencies
        .readProc("diskstats")
        .then(parseDiskstats)
        .catch(() => new Map<string, DiskCounters>()),
      this.dependencies.readTemperature(),
    ]);

    const cpuDelta = this.previousCpu
      ? cpuResult.total - this.previousCpu.total
      : cpuResult.total;
    const idleDelta = this.previousCpu
      ? cpuResult.idle - this.previousCpu.idle
      : cpuResult.idle;
    this.previousCpu = cpuResult;

    const elapsedSeconds = this.previousNetworkAt
      ? Math.max((now - this.previousNetworkAt) / 1_000, 0.001)
      : null;
    const network = networkResult.map((current) => {
      const previous = this.previousNetwork.get(current.interface);
      return {
        interface: current.interface,
        rxBytesPerSecond:
          previous && elapsedSeconds
            ? Math.max(0, current.rxBytes - previous.rxBytes) / elapsedSeconds
            : 0,
        txBytesPerSecond:
          previous && elapsedSeconds
            ? Math.max(0, current.txBytes - previous.txBytes) / elapsedSeconds
            : 0,
      };
    });
    this.previousNetwork = new Map(
      networkResult.map((value) => [value.interface, value]),
    );
    this.previousNetworkAt = now;

    // The first sample after a restart has no baseline, so rates are reported
    // as absent rather than as a spike derived from boot-time totals.
    const diskElapsedSeconds = this.previousDiskAt
      ? Math.max((now - this.previousDiskAt) / 1_000, 0.001)
      : null;
    const diskActivity = new Map<string, DiskActivity>();
    for (const disk of this.devices) {
      const key = diskstatsKey(disk.device);
      const current = diskstatsResult.get(key);
      const previous = this.previousDisk.get(key);
      if (!current || !previous || diskElapsedSeconds === null) continue;
      diskActivity.set(
        disk.device,
        diskActivityBetween(previous, current, diskElapsedSeconds),
      );
    }
    this.previousDisk = diskstatsResult;
    this.previousDiskAt = now;

    return {
      cpu: {
        usagePercent:
          cpuDelta > 0 ? ((cpuDelta - idleDelta) / cpuDelta) * 100 : 0,
        cores: cpuResult.cores,
        ...loadResult,
        temperatureCelsius: temp,
      },
      memory: memoryResult,
      disks: this.devices.map((disk) =>
        diskInfo(
          disk,
          dfResult.get(disk.device),
          diskActivity.get(disk.device),
        ),
      ),
      network,
    };
  }
}
