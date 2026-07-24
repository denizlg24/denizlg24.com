import { readdir, readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import type { DiskInfo, OpsOverview } from "@repo/schemas/cloud";

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
          .filter(
            (entry) =>
              entry.isDirectory() && entry.name.startsWith("thermal_zone"),
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
  if (exitCode !== 0) {
    throw new Error(`df failed (${exitCode}): ${stderr.slice(-2_000)}`);
  }
  return stdout;
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
  device: string,
  values:
    | { totalBytes: number; usedBytes: number; availableBytes: number }
    | undefined,
): DiskInfo {
  if (!values) {
    return {
      device,
      totalBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
      usagePercent: 0,
      online: false,
    };
  }
  return {
    device,
    ...values,
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

  constructor(
    private readonly devices: readonly string[],
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
    const [cpuResult, memoryResult, loadResult, networkResult, dfResult, temp] =
      await Promise.all([
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

    return {
      cpu: {
        usagePercent:
          cpuDelta > 0 ? ((cpuDelta - idleDelta) / cpuDelta) * 100 : 0,
        cores: cpuResult.cores,
        ...loadResult,
        temperatureCelsius: temp,
      },
      memory: memoryResult,
      disks: this.devices.map((device) =>
        diskInfo(device, dfResult.get(device)),
      ),
      network,
    };
  }
}
