import { readdir, readFile, readlink } from "node:fs/promises";
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

/**
 * A disk to sample, named by whichever identity the host was configured with.
 *
 * `uuid` is the filesystem UUID and is the identity that survives a reboot;
 * `device` is a fixed kernel path for hosts not yet migrated. Exactly one is
 * set. Kernel names are assigned in probe order, so the 1 TB HDD in this rack
 * has answered to `sda1`, then `sdc1` when a second disk joined the pool, then
 * `sda1` again after a reboot — each rename silently retired its metric series
 * and reported the disk offline until the config caught up.
 */
export type DiskDevice = { kind: DiskKind } & (
  | { uuid: string; device?: undefined }
  | { device: string; uuid?: undefined }
);

/** A disk resolved to the kernel name it currently answers to. */
export interface ResolvedDisk {
  kind: DiskKind;
  uuid?: string;
  device: string;
}

/**
 * Maps filesystem UUID to current kernel device path from the `by-uuid`
 * symlink farm.
 *
 * The link text is what matters, never the target: the container mounts the
 * directory read-only and has no block devices of its own, so `../../sda1`
 * resolves to nothing inside it. Reading the name is enough, and it keeps the
 * container from needing device access it should not have.
 */
export function parseDiskUuidLinks(
  entries: ReadonlyArray<{ uuid: string; target: string }>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const { uuid, target } of entries) {
    const name = target.split("/").pop();
    if (!uuid || !name) continue;
    result.set(uuid.toLowerCase(), `/dev/${name}`);
  }
  return result;
}

/**
 * A configured disk paired with the kernel name it currently holds.
 *
 * A UUID with no link is a disk that is genuinely absent — unplugged, or its
 * enclosure lost power. It still has to appear in the output, because a disk
 * that vanishes from the list reads as "nothing wrong" rather than "offline",
 * so it keeps its identity and resolves to an empty device that matches no `df`
 * row and no diskstats entry.
 */
export function resolveDisks(
  devices: readonly DiskDevice[],
  uuidLinks: ReadonlyMap<string, string>,
): ResolvedDisk[] {
  return devices.map((disk) =>
    disk.uuid !== undefined
      ? {
          kind: disk.kind,
          uuid: disk.uuid,
          device: uuidLinks.get(disk.uuid.toLowerCase()) ?? "",
        }
      : { kind: disk.kind, device: disk.device },
  );
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

function meminfoValues(input: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
    if (match?.[1] && match[2]) {
      values.set(match[1], Number(match[2]) * 1_024);
    }
  }
  return values;
}

export function parseMeminfo(input: string): {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
} {
  const values = meminfoValues(input);
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

export interface SwapCounters {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  cachedBytes: number;
  usagePercent: number;
}

/**
 * A host with swap disabled reports SwapTotal 0, which is a valid reading and
 * not an error — it yields zeroes rather than throwing the way MemTotal does.
 */
export function parseSwapInfo(input: string): SwapCounters {
  const values = meminfoValues(input);
  const totalBytes = values.get("SwapTotal") ?? 0;
  const freeBytes = values.get("SwapFree") ?? 0;
  const cachedBytes = values.get("SwapCached") ?? 0;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    cachedBytes,
    usagePercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
  };
}

/**
 * `pswpin`/`pswpout` are cumulative *pages*, so they are differenced between
 * samples and scaled by the page size. They matter more than swap occupancy:
 * a full-but-idle swap file is harmless, while sustained paging is the thing
 * that makes every request slow.
 */
export const PAGE_SIZE_BYTES = 4_096;

export interface SwapActivityCounters {
  pagesIn: number;
  pagesOut: number;
}

export function parseVmstat(input: string): SwapActivityCounters {
  let pagesIn = 0;
  let pagesOut = 0;
  for (const line of input.split(/\r?\n/)) {
    const [key, raw] = line.trim().split(/\s+/, 2);
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (key === "pswpin") pagesIn = value;
    else if (key === "pswpout") pagesOut = value;
  }
  return { pagesIn, pagesOut };
}

export interface FileDescriptorCounters {
  allocated: number;
  max: number;
  usagePercent: number;
}

/** `/proc/sys/fs/file-nr` is three fields: allocated, free (always 0 since 2.6), max. */
export function parseFileNr(input: string): FileDescriptorCounters {
  const [allocatedRaw, , maxRaw] = input.trim().split(/\s+/);
  const allocated = Number(allocatedRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(allocated) || !Number.isFinite(max)) {
    throw new Error("/proc/sys/fs/file-nr contains invalid counters");
  }
  return {
    allocated,
    max,
    usagePercent: max > 0 ? (allocated / max) * 100 : 0,
  };
}

/** The `Max open files` row of `/proc/self/limits`; `unlimited` reads as null. */
export function parseOpenFileLimit(input: string): number | null {
  for (const line of input.split(/\r?\n/)) {
    if (!line.startsWith("Max open files")) continue;
    const soft = line.slice("Max open files".length).trim().split(/\s+/)[0];
    if (soft === "unlimited") return null;
    const value = Number(soft);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export interface SocketCounters {
  established: number;
  inbound: number;
  outbound: number;
  listening: number;
  timeWait: number;
  topInboundPorts: { port: number; count: number }[];
}

/** Hex state codes from `net/tcp_states.h`. */
const TCP_ESTABLISHED = "01";
const TCP_TIME_WAIT = "06";
const TCP_LISTEN = "0A";

interface RawSocket {
  localPort: number;
  state: string;
}

/**
 * Columns are `sl local_address rem_address st ...` with addresses as
 * `HEXADDR:HEXPORT`. Works unchanged for tcp6, whose only difference is a
 * longer address half.
 */
export function parseProcNetTcp(input: string): RawSocket[] {
  const sockets: RawSocket[] = [];
  for (const line of input.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4) continue;
    const local = columns[1];
    const state = columns[3];
    if (!local || !state) continue;
    const portHex = local.split(":")[1];
    if (!portHex) continue;
    const localPort = Number.parseInt(portHex, 16);
    if (!Number.isFinite(localPort)) continue;
    sockets.push({ localPort, state: state.toUpperCase() });
  }
  return sockets;
}

const TOP_INBOUND_PORTS = 5;

/**
 * An ESTABLISHED socket whose local port is one the host also listens on was
 * opened by somebody else; anything else is a connection this host dialled out.
 * Ephemeral ports never appear in the LISTEN set, which is what makes the
 * split hold without tracking who called connect().
 */
export function classifySockets(sockets: readonly RawSocket[]): SocketCounters {
  const listeningPorts = new Set(
    sockets
      .filter((socket) => socket.state === TCP_LISTEN)
      .map((socket) => socket.localPort),
  );
  const inboundByPort = new Map<number, number>();
  let established = 0;
  let inbound = 0;
  let outbound = 0;
  let timeWait = 0;

  for (const socket of sockets) {
    if (socket.state === TCP_TIME_WAIT) {
      timeWait += 1;
      continue;
    }
    if (socket.state !== TCP_ESTABLISHED) continue;
    established += 1;
    if (listeningPorts.has(socket.localPort)) {
      inbound += 1;
      inboundByPort.set(
        socket.localPort,
        (inboundByPort.get(socket.localPort) ?? 0) + 1,
      );
    } else {
      outbound += 1;
    }
  }

  return {
    established,
    inbound,
    outbound,
    listening: listeningPorts.size,
    timeWait,
    topInboundPorts: [...inboundByPort.entries()]
      .map(([port, count]) => ({ port, count }))
      .sort((a, b) => b.count - a.count || a.port - b.port)
      .slice(0, TOP_INBOUND_PORTS),
  };
}

export interface SockstatCounters {
  orphan: number;
  tcpMemoryBytes: number;
}

/** The `TCP: inuse N orphan N tw N alloc N mem N` line; `mem` counts pages. */
export function parseSockstat(input: string): SockstatCounters {
  for (const line of input.split(/\r?\n/)) {
    if (!line.startsWith("TCP:")) continue;
    const fields = line.slice(4).trim().split(/\s+/);
    const values = new Map<string, number>();
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const key = fields[index];
      const value = Number(fields[index + 1]);
      if (key && Number.isFinite(value)) values.set(key, value);
    }
    return {
      orphan: values.get("orphan") ?? 0,
      tcpMemoryBytes: (values.get("mem") ?? 0) * PAGE_SIZE_BYTES,
    };
  }
  return { orphan: 0, tcpMemoryBytes: 0 };
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

/**
 * The host's `by-uuid` symlinks, read through the container's bind of them.
 *
 * Falls back to the container's own `/dev` so a host that runs the API outside
 * Docker still resolves; an unreadable directory yields an empty map, which
 * reports every UUID-configured disk offline rather than throwing away the
 * whole sample.
 */
async function readDiskUuidLinks(): Promise<
  Array<{ uuid: string; target: string }>
> {
  for (const root of ["/host/dev/disk/by-uuid", "/dev/disk/by-uuid"]) {
    try {
      const names = await readdir(root);
      return await Promise.all(
        names.map(async (uuid) => ({
          uuid,
          target: await readlink(`${root}/${uuid}`).catch(() => ""),
        })),
      );
    } catch {
      // Try the container-local fallback, then give up.
    }
  }
  return [];
}

/**
 * The container's own `/proc/self`, never the `/host/proc` mount: `self`
 * resolves against the reading process's PID namespace, so under the host mount
 * it would name a different process — or nothing at all.
 */
async function countProcessFds(): Promise<number | null> {
  try {
    return (await readdir("/proc/self/fd")).length;
  } catch {
    return null;
  }
}

async function readProcessLimits(): Promise<string> {
  return readFile("/proc/self/limits", "utf8");
}

export interface HostCollectorDependencies {
  now(): number;
  readDf(): Promise<string>;
  readProc(path: string): Promise<string>;
  readTemperature(): Promise<number | null>;
  countProcessFds(): Promise<number | null>;
  readProcessLimits(): Promise<string>;
  readDiskUuidLinks(): Promise<Array<{ uuid: string; target: string }>>;
}

const defaultHostCollectorDependencies: HostCollectorDependencies = {
  now: Date.now,
  readDf,
  readProc: readHostProc,
  readTemperature: readCpuTemperature,
  countProcessFds,
  readProcessLimits,
  readDiskUuidLinks,
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
  disk: ResolvedDisk,
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
  private previousSwapActivity: SwapActivityCounters | null = null;
  private previousSwapActivityAt: number | null = null;

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
    Pick<
      OpsOverview,
      | "cpu"
      | "memory"
      | "swap"
      | "fileDescriptors"
      | "connections"
      | "disks"
      | "network"
    >
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
      swapResult,
      swapActivityResult,
      fileNrResult,
      processFdResult,
      processLimitResult,
      socketResult,
      sockstatResult,
      uuidLinksResult,
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
      this.dependencies
        .readProc("meminfo")
        .then(parseSwapInfo)
        .catch(() => null),
      this.dependencies
        .readProc("vmstat")
        .then(parseVmstat)
        .catch(() => null),
      this.dependencies
        .readProc("sys/fs/file-nr")
        .then(parseFileNr)
        .catch(() => null),
      this.dependencies.countProcessFds().catch(() => null),
      this.dependencies
        .readProcessLimits()
        .then(parseOpenFileLimit)
        .catch(() => null),
      // tcp6 is absent on an IPv6-disabled kernel, so the pair is summed
      // independently rather than failing together.
      Promise.all([
        this.dependencies
          .readProc("net/tcp")
          .then(parseProcNetTcp)
          .catch(() => []),
        this.dependencies
          .readProc("net/tcp6")
          .then(parseProcNetTcp)
          .catch(() => []),
      ]).then(([v4, v6]) => classifySockets([...v4, ...v6])),
      this.dependencies
        .readProc("net/sockstat")
        .then(parseSockstat)
        .catch(() => ({ orphan: 0, tcpMemoryBytes: 0 })),
      this.dependencies
        .readDiskUuidLinks()
        .then(parseDiskUuidLinks)
        .catch(() => new Map<string, string>()),
    ]);
    // Resolved every sample, not once at startup: a disk that is replugged or
    // renamed while the process lives has to be followed, and that is the whole
    // point of configuring it by UUID.
    const disks = resolveDisks(this.devices, uuidLinksResult);

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
    for (const disk of disks) {
      if (!disk.device) continue;
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

    const swapElapsedSeconds =
      this.previousSwapActivityAt !== null
        ? Math.max((now - this.previousSwapActivityAt) / 1_000, 0.001)
        : null;
    const swapRates =
      swapActivityResult && this.previousSwapActivity && swapElapsedSeconds
        ? {
            inBytesPerSecond:
              (Math.max(
                0,
                swapActivityResult.pagesIn - this.previousSwapActivity.pagesIn,
              ) *
                PAGE_SIZE_BYTES) /
              swapElapsedSeconds,
            outBytesPerSecond:
              (Math.max(
                0,
                swapActivityResult.pagesOut -
                  this.previousSwapActivity.pagesOut,
              ) *
                PAGE_SIZE_BYTES) /
              swapElapsedSeconds,
          }
        : {};
    if (swapActivityResult) {
      this.previousSwapActivity = swapActivityResult;
      this.previousSwapActivityAt = now;
    }

    const processLimit = processLimitResult;
    const processOpen = processFdResult;

    return {
      cpu: {
        usagePercent:
          cpuDelta > 0 ? ((cpuDelta - idleDelta) / cpuDelta) * 100 : 0,
        cores: cpuResult.cores,
        ...loadResult,
        temperatureCelsius: temp,
      },
      memory: memoryResult,
      swap: {
        ...(swapResult ?? {
          totalBytes: 0,
          usedBytes: 0,
          freeBytes: 0,
          cachedBytes: 0,
          usagePercent: 0,
        }),
        ...swapRates,
      },
      fileDescriptors: {
        ...(fileNrResult ?? { allocated: 0, max: 0, usagePercent: 0 }),
        processOpen,
        processLimit,
        processUsagePercent:
          processOpen !== null && processLimit !== null && processLimit > 0
            ? (processOpen / processLimit) * 100
            : null,
      },
      connections: {
        ...socketResult,
        ...sockstatResult,
      },
      disks: disks.map((disk) =>
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
