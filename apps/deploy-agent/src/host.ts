import { readdir, readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";

import type { ForgeHostSnapshot } from "@repo/schemas/cloud";

export interface CpuCounters {
  idle: number;
  total: number;
  cores: number;
}

export function parseCpuStat(input: string): CpuCounters {
  const lines = input.split(/\r?\n/);
  const aggregate = lines.find((line) => line.startsWith("cpu "));
  if (!aggregate) throw new Error("/proc/stat has no aggregate CPU row");
  const values = aggregate.trim().split(/\s+/).slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("/proc/stat has invalid CPU counters");
  }
  return {
    idle: (values[3] ?? 0) + (values[4] ?? 0),
    total: values.reduce((sum, value) => sum + value, 0),
    cores: lines.filter((line) => /^cpu\d+\s/.test(line)).length,
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

function fallbackCpuCounters(): CpuCounters {
  const values = cpus();
  return values.reduce(
    (result, cpu) => ({
      idle: result.idle + cpu.times.idle,
      total:
        result.total +
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.idle +
        cpu.times.irq,
      cores: result.cores + 1,
    }),
    { idle: 0, total: 0, cores: 0 },
  );
}

async function readCpuTemperature(): Promise<number | null> {
  try {
    const root = "/sys/class/thermal";
    const entries = await readdir(root, { withFileTypes: true });
    const values = await Promise.all(
      entries
        .filter((entry) => entry.name.startsWith("thermal_zone"))
        .map(async (entry) =>
          Number((await readFile(`${root}/${entry.name}/temp`, "utf8")).trim()),
        ),
    );
    const temperatures = values
      .filter(Number.isFinite)
      .map((value) => value / 1_000);
    return temperatures.length > 0 ? Math.max(...temperatures) : null;
  } catch {
    return null;
  }
}

export interface HostCollectorOptions {
  readProc?: (path: string) => Promise<string>;
  readTemperature?: () => Promise<number | null>;
  totalMemory?: () => number;
  freeMemory?: () => number;
}

/** Stateful host sampler; CPU utilization is derived from counter deltas. */
export class HostCollector {
  readonly #readProc: (path: string) => Promise<string>;
  readonly #readTemperature: () => Promise<number | null>;
  readonly #totalMemory: () => number;
  readonly #freeMemory: () => number;
  #previousCpu: CpuCounters | null = null;

  constructor(options: HostCollectorOptions = {}) {
    this.#readProc =
      options.readProc ?? ((path) => readFile(`/proc/${path}`, "utf8"));
    this.#readTemperature = options.readTemperature ?? readCpuTemperature;
    this.#totalMemory = options.totalMemory ?? totalmem;
    this.#freeMemory = options.freeMemory ?? freemem;
  }

  async collect(): Promise<ForgeHostSnapshot> {
    const [cpu, memory, load, temperatureCelsius] = await Promise.all([
      this.#readProc("stat").then(parseCpuStat).catch(fallbackCpuCounters),
      this.#readProc("meminfo")
        .then(parseMeminfo)
        .catch(() => {
          const totalBytes = this.#totalMemory();
          const availableBytes = this.#freeMemory();
          const usedBytes = Math.max(totalBytes - availableBytes, 0);
          return {
            totalBytes,
            usedBytes,
            availableBytes,
            usagePercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
          };
        }),
      this.#readProc("loadavg")
        .then(parseLoadAverage)
        .catch(() => ({ load1: 0, load5: 0, load15: 0 })),
      this.#readTemperature(),
    ]);
    const totalDelta = this.#previousCpu
      ? cpu.total - this.#previousCpu.total
      : cpu.total;
    const idleDelta = this.#previousCpu
      ? cpu.idle - this.#previousCpu.idle
      : cpu.idle;
    this.#previousCpu = cpu;
    const usagePercent =
      totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
    return {
      cpu: {
        usagePercent: Math.min(Math.max(usagePercent, 0), 100),
        cores: cpu.cores,
        ...load,
        temperatureCelsius,
      },
      memory,
    };
  }
}
