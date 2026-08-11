import { readdir, readFile, statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";

import type {
  ForgeDiskIo,
  ForgeFilesystem,
  ForgeHostSnapshot,
  ForgeNetworkInterface,
  ForgeSensor,
} from "@repo/schemas/cloud";

import {
  type CpuCounters,
  type CpuStat,
  type DiskCounters,
  diskSectorsToBytes,
  type NetCounters,
  parseDiskstats,
  parseLoadAverage,
  parseMeminfo,
  parseMounts,
  parseNetDev,
  parsePressure,
  parseStat,
} from "./proc";
import { type EnergyCounter, readEnergyCounters, readSensors } from "./sensors";
import {
  type ProcessCounters,
  readProcessCounters,
  readSystemInfo,
  topProcesses,
} from "./system";

export {
  type CpuCounters,
  parseCpuStat,
  parseDiskstats,
  parseLoadAverage,
  parseMeminfo,
  parseMounts,
  parseNetDev,
  parsePressure,
  parseStat,
} from "./proc";
export { readEnergyCounters, readSensors } from "./sensors";
export {
  parseCpuModel,
  parseOsRelease,
  parseProcessStat,
  readSystemInfo,
  topProcesses,
} from "./system";

/** How many processes to report per ranking. Two rankings, so up to twice this. */
const TOP_PROCESSES = 8;

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

/**
 * The hottest thermal zone, kept as the headline CPU temperature.
 *
 * hwmon reports far more than this and is where the detail now lives, but the
 * tile, the alert rules and the `cpu.temperature` series were all written
 * against one number, and a box with no hwmon modules loaded still has thermal
 * zones.
 */
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

/**
 * Per-core clock speeds.
 *
 * `scaling_cur_freq` is what the governor has the core set to right now, in kHz.
 * Absent inside a VM and on kernels without cpufreq, in which case the cores are
 * still reported — with no clock.
 */
async function readCoreFrequencies(
  cores: readonly number[],
): Promise<Map<number, number>> {
  const frequencies = new Map<number, number>();
  await Promise.all(
    cores.map(async (core) => {
      try {
        const raw = await readFile(
          `/sys/devices/system/cpu/cpu${core}/cpufreq/scaling_cur_freq`,
          "utf8",
        );
        const khz = Number(raw.trim());
        if (Number.isFinite(khz)) frequencies.set(core, khz / 1_000);
      } catch {
        // No cpufreq for this core. Reported without a clock.
      }
    }),
  );
  return frequencies;
}

/** Negotiated link speed in Mbit/s. Errors for a down or virtual interface. */
async function readLinkSpeed(name: string): Promise<number | null> {
  try {
    const raw = await readFile(`/sys/class/net/${name}/speed`, "utf8");
    const speed = Number(raw.trim());
    // The kernel reports -1 for "unknown", which is not a speed.
    return Number.isFinite(speed) && speed > 0 ? speed : null;
  } catch {
    return null;
  }
}

export interface HostCollectorOptions {
  readProc?: (path: string) => Promise<string>;
  readTemperature?: () => Promise<number | null>;
  totalMemory?: () => number;
  freeMemory?: () => number;
  /** Injected in tests; production reads the real clock. */
  now?: () => number;
}

interface Previous<T> {
  at: number;
  values: T;
}

/**
 * Stateful host sampler.
 *
 * Almost everything Linux publishes is a counter since boot, so almost
 * everything here is a delta between two samples — CPU shares, disk throughput,
 * network throughput, interrupt rates, package power. The first `collect()`
 * after start therefore reports rates of zero for those, which is the honest
 * answer: there is no interval to have measured them over yet.
 *
 * Each family is collected independently and each failure is contained to its
 * own field. A missing `/proc/pressure` (kernel built without PSI), an absent
 * `/sys/class/hwmon` (nothing loaded), an unreadable `/proc/<pid>` (the process
 * exited mid-walk) all produce an empty section rather than an empty snapshot.
 */
export class HostCollector {
  readonly #readProc: (path: string) => Promise<string>;
  readonly #readTemperature: () => Promise<number | null>;
  readonly #totalMemory: () => number;
  readonly #freeMemory: () => number;
  readonly #now: () => number;
  #previousCpu: CpuStat | null = null;
  #previousCpuAt = 0;
  #previousDisks: Previous<Map<string, DiskCounters>> | null = null;
  #previousNetwork: Previous<Map<string, NetCounters>> | null = null;
  #previousEnergy: Previous<Map<string, number>> | null = null;
  #previousProcesses: Previous<Map<number, number>> | null = null;
  #collecting: Promise<ForgeHostSnapshot> | null = null;

  constructor(options: HostCollectorOptions = {}) {
    this.#readProc =
      options.readProc ?? ((path) => readFile(`/proc/${path}`, "utf8"));
    this.#readTemperature = options.readTemperature ?? readCpuTemperature;
    this.#totalMemory = options.totalMemory ?? totalmem;
    this.#freeMemory = options.freeMemory ?? freemem;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Serialised, because every rate here is a delta against the previous sample
   * and the previous sample is instance state. Two overlapping calls would each
   * read the counters, then each overwrite `#previousCpu` and friends — the
   * second one's deltas measured against the first one's read, which is a
   * fraction of the real interval and a rate several times too high.
   */
  collect(): Promise<ForgeHostSnapshot> {
    if (this.#collecting) return this.#collecting;
    const running = this.#collect().finally(() => {
      this.#collecting = null;
    });
    this.#collecting = running;
    return running;
  }

  async #collect(): Promise<ForgeHostSnapshot> {
    const at = this.#now();
    const [cpuStat, memory, load, temperatureCelsius] = await Promise.all([
      this.#readProc("stat")
        .then(parseStat)
        .catch(
          (): CpuStat => ({
            aggregate: fallbackCpuCounters(),
            cores: new Map(),
            contextSwitches: null,
            interrupts: null,
            forks: null,
            running: null,
            blocked: null,
          }),
        ),
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
            freeBytes: availableBytes,
            cachedBytes: null,
            buffersBytes: null,
            dirtyBytes: null,
            slabBytes: null,
            swapTotalBytes: null,
            swapUsedBytes: null,
            swapUsagePercent: null,
          };
        }),
      this.#readProc("loadavg")
        .then(parseLoadAverage)
        .catch(() => ({ load1: 0, load5: 0, load15: 0 })),
      this.#readTemperature(),
    ]);

    const cpu = this.#cpu(cpuStat, at);
    const perCore = await this.#perCore(cpuStat);
    this.#previousCpu = cpuStat;
    this.#previousCpuAt = at;

    const [
      sensors,
      power,
      disks,
      filesystems,
      network,
      pressure,
      processes,
      system,
    ] = await Promise.all([
      readSensors().catch((): ForgeSensor[] => []),
      this.#power(at),
      this.#disks(at),
      this.#filesystems(),
      this.#network(at),
      this.#pressure(),
      this.#processes(at),
      readSystemInfo().catch(() => null),
    ]);

    return {
      cpu: { ...cpu, ...load, temperatureCelsius, perCore },
      memory,
      sensors,
      power,
      disks,
      filesystems,
      network,
      pressure,
      processes,
      system,
    };
  }

  #cpu(stat: CpuStat, at: number) {
    const previous = this.#previousCpu;
    const totalDelta = previous
      ? stat.aggregate.total - previous.aggregate.total
      : stat.aggregate.total;
    const idleDelta = previous
      ? stat.aggregate.idle - previous.aggregate.idle
      : stat.aggregate.idle;
    const usagePercent =
      totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
    const elapsedSeconds = previous ? (at - this.#previousCpuAt) / 1_000 : 0;

    const rate = (current: number | null, before: number | null) =>
      current === null || before === null || elapsedSeconds <= 0
        ? null
        : Math.max(current - before, 0) / elapsedSeconds;

    return {
      usagePercent: Math.min(Math.max(usagePercent, 0), 100),
      cores: stat.aggregate.cores,
      contextSwitchesPerSecond: rate(
        stat.contextSwitches,
        previous?.contextSwitches ?? null,
      ),
      interruptsPerSecond: rate(stat.interrupts, previous?.interrupts ?? null),
      forksPerSecond: rate(stat.forks, previous?.forks ?? null),
      running: stat.running,
      blocked: stat.blocked,
    };
  }

  async #perCore(stat: CpuStat) {
    const cores = [...stat.cores.keys()].sort((a, b) => a - b);
    if (cores.length === 0) return [];
    const frequencies = await readCoreFrequencies(cores);
    const previous = this.#previousCpu;
    return cores.map((core) => {
      const current = stat.cores.get(core);
      const before = previous?.cores.get(core);
      const totalDelta = current ? current.total - (before?.total ?? 0) : 0;
      const idleDelta = current ? current.idle - (before?.idle ?? 0) : 0;
      const usagePercent =
        before && totalDelta > 0
          ? ((totalDelta - idleDelta) / totalDelta) * 100
          : 0;
      return {
        core,
        usagePercent: Math.min(Math.max(usagePercent, 0), 100),
        mhz: frequencies.get(core) ?? null,
      };
    });
  }

  async #disks(at: number): Promise<ForgeDiskIo[]> {
    const rows = await this.#readProc("diskstats")
      .then(parseDiskstats)
      .catch((): DiskCounters[] => []);
    const current = new Map(rows.map((row) => [row.device, row]));
    const previous = this.#previousDisks;
    this.#previousDisks = { at, values: current };
    if (!previous) return [];
    const elapsedSeconds = (at - previous.at) / 1_000;
    if (elapsedSeconds <= 0) return [];

    const result: ForgeDiskIo[] = [];
    for (const [device, row] of current) {
      const before = previous.values.get(device);
      // A device that appeared since the last sample has no interval to
      // measure over; it gets one, next time.
      if (!before) continue;
      const delta = (now: number, then: number) => Math.max(now - then, 0);
      const ioMillis = delta(row.ioMillis, before.ioMillis);
      result.push({
        device,
        readBytesPerSecond:
          diskSectorsToBytes(delta(row.sectorsRead, before.sectorsRead)) /
          elapsedSeconds,
        writeBytesPerSecond:
          diskSectorsToBytes(delta(row.sectorsWritten, before.sectorsWritten)) /
          elapsedSeconds,
        readsPerSecond:
          delta(row.readsCompleted, before.readsCompleted) / elapsedSeconds,
        writesPerSecond:
          delta(row.writesCompleted, before.writesCompleted) / elapsedSeconds,
        // Can exceed 100 on a multi-queue device, where several requests are in
        // flight at once — clamped, because a "percent of wall time" above 100
        // reads as a bug rather than as parallelism.
        utilizationPercent: Math.min(
          (ioMillis / (elapsedSeconds * 1_000)) * 100,
          100,
        ),
        queueLength:
          delta(row.weightedIoMillis, before.weightedIoMillis) /
          (elapsedSeconds * 1_000),
      });
    }
    return result.sort((a, b) => a.device.localeCompare(b.device));
  }

  async #network(at: number): Promise<ForgeNetworkInterface[]> {
    const rows = await this.#readProc("net/dev")
      .then(parseNetDev)
      .catch((): NetCounters[] => []);
    const current = new Map(rows.map((row) => [row.name, row]));
    const previous = this.#previousNetwork;
    this.#previousNetwork = { at, values: current };
    if (!previous) return [];
    const elapsedSeconds = (at - previous.at) / 1_000;
    if (elapsedSeconds <= 0) return [];

    const result = await Promise.all(
      [...current.entries()].map(async ([name, row]) => {
        const before = previous.values.get(name);
        if (!before) return null;
        const delta = (now: number, then: number) => Math.max(now - then, 0);
        return {
          name,
          rxBytesPerSecond: delta(row.rxBytes, before.rxBytes) / elapsedSeconds,
          txBytesPerSecond: delta(row.txBytes, before.txBytes) / elapsedSeconds,
          rxPacketsPerSecond:
            delta(row.rxPackets, before.rxPackets) / elapsedSeconds,
          txPacketsPerSecond:
            delta(row.txPackets, before.txPackets) / elapsedSeconds,
          errorsPerSecond:
            (delta(row.rxErrors, before.rxErrors) +
              delta(row.txErrors, before.txErrors)) /
            elapsedSeconds,
          dropsPerSecond:
            (delta(row.rxDropped, before.rxDropped) +
              delta(row.txDropped, before.txDropped)) /
            elapsedSeconds,
          speedMbit: await readLinkSpeed(name),
        };
      }),
    );
    return result
      .filter((row): row is ForgeNetworkInterface => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async #power(at: number) {
    const counters = await readEnergyCounters().catch(
      (): EnergyCounter[] => [],
    );
    const current = new Map(
      counters.map((counter) => [counter.zone, counter.microjoules]),
    );
    const previous = this.#previousEnergy;
    this.#previousEnergy = { at, values: current };
    if (!previous) return [];
    const elapsedSeconds = (at - previous.at) / 1_000;
    if (elapsedSeconds <= 0) return [];

    const result: { zone: string; watts: number }[] = [];
    for (const [zone, microjoules] of current) {
      const before = previous.values.get(zone);
      // A decrease is the counter wrapping at `max_energy_range_uj`, not
      // negative power. The interval is dropped rather than guessed at: RAPL
      // wraps roughly hourly at idle, so one missing point beats an invented one.
      if (before === undefined || microjoules < before) continue;
      result.push({
        zone,
        watts: (microjoules - before) / 1_000_000 / elapsedSeconds,
      });
    }
    return result.sort((a, b) => a.zone.localeCompare(b.zone));
  }

  async #pressure() {
    const [cpu, memory, io] = await Promise.all([
      this.#readProc("pressure/cpu")
        .then(parsePressure)
        .catch(() => null),
      this.#readProc("pressure/memory")
        .then(parsePressure)
        .catch(() => null),
      this.#readProc("pressure/io")
        .then(parsePressure)
        .catch(() => null),
    ]);
    // A kernel built without PSI has none of the three. Reporting an object of
    // nulls would draw three empty charts; reporting nothing hides the section.
    if (!cpu && !memory && !io) return null;
    return { cpu, memory, io };
  }

  async #filesystems(): Promise<ForgeFilesystem[]> {
    const mounts = await this.#readProc("mounts")
      .then(parseMounts)
      .catch(() => []);
    const rows = await Promise.all(
      mounts.map(async (entry) => {
        try {
          const stats = await statfs(entry.mount);
          const blockSize = Number(stats.bsize);
          const totalBytes = Number(stats.blocks) * blockSize;
          // `bavail` excludes the root reserve, so this is the space a
          // deployment can actually use — `bfree` would over-report by 5%.
          const freeBytes = Number(stats.bavail) * blockSize;
          const usedBytes = Math.max(totalBytes - freeBytes, 0);
          if (totalBytes <= 0) return null;
          return {
            mount: entry.mount,
            device: entry.device,
            fstype: entry.fstype,
            totalBytes,
            usedBytes,
            freeBytes,
            usagePercent: (usedBytes / totalBytes) * 100,
          };
        } catch {
          return null;
        }
      }),
    );
    return rows
      .filter((row): row is ForgeFilesystem => row !== null)
      .sort((a, b) => a.mount.localeCompare(b.mount));
  }

  async #processes(at: number) {
    const counters = await readProcessCounters().catch(
      (): ProcessCounters[] => [],
    );
    const current = new Map(
      counters.map((process) => [process.pid, process.jiffies]),
    );
    const previous = this.#previousProcesses;
    this.#previousProcesses = { at, values: current };
    if (!previous) return [];
    const elapsedSeconds = (at - previous.at) / 1_000;
    if (elapsedSeconds <= 0) return [];
    return topProcesses(
      counters,
      previous.values,
      elapsedSeconds,
      TOP_PROCESSES,
    );
  }
}
