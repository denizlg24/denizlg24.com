import { readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";

import type { ForgeProcess, ForgeSystemInfo } from "@repo/schemas/cloud";

export interface SystemReaderOptions {
  readFile?: (path: string) => Promise<string>;
  readDir?: (path: string) => Promise<string[]>;
  hostname?: () => string;
  now?: () => Date;
}

async function readTrimmed(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

async function optional(
  read: (path: string) => Promise<string>,
  path: string,
): Promise<string | null> {
  try {
    const value = await read(path);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** `PRETTY_NAME="Ubuntu 24.04.1 LTS"` out of `/etc/os-release`. */
export function parseOsRelease(input: string): string | null {
  const match = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(input);
  return match?.[1] ?? null;
}

/** The first `model name` in `/proc/cpuinfo`; every core repeats it. */
export function parseCpuModel(input: string): string | null {
  const match = /^model name\s*:\s*(.+)$/m.exec(input);
  return match?.[1]?.trim() ?? null;
}

/**
 * What the box is and how long it has been up.
 *
 * Read once per sample rather than cached, because the cheap fields are the ones
 * that move — process and thread counts — and the static ones are four small
 * reads out of the page cache. Every one of them is optional: DMI is absent in a
 * container, `/etc/os-release` is absent on a minimal image, and a snapshot
 * missing the model name is still a useful snapshot.
 */
export async function readSystemInfo(
  options: SystemReaderOptions = {},
): Promise<ForgeSystemInfo> {
  const read = options.readFile ?? readTrimmed;
  const readEntries = options.readDir ?? ((path) => readdir(path));
  const now = options.now?.() ?? new Date();

  const [kernel, osRelease, model, cpuinfo, uptime, loadavg] =
    await Promise.all([
      optional(read, "/proc/sys/kernel/osrelease"),
      optional(read, "/etc/os-release"),
      optional(read, "/sys/class/dmi/id/product_name"),
      optional(read, "/proc/cpuinfo"),
      optional(read, "/proc/uptime"),
      optional(read, "/proc/loadavg"),
    ]);

  const uptimeSeconds = uptime === null ? null : Number(uptime.split(/\s+/)[0]);
  // `/proc/loadavg`'s fourth field is `running/total`, which is the thread
  // count — cheaper than counting `/proc/*/task` and exactly as accurate.
  const threads = loadavg
    ? Number(loadavg.trim().split(/\s+/)[3]?.split("/")[1] ?? "")
    : Number.NaN;

  const processes = await readEntries("/proc")
    .then((entries) => entries.filter((entry) => /^\d+$/.test(entry)).length)
    .catch(() => null);

  return {
    hostname: (options.hostname ?? hostname)(),
    kernel,
    osRelease: osRelease === null ? null : parseOsRelease(osRelease),
    model,
    cpuModel: cpuinfo === null ? null : parseCpuModel(cpuinfo),
    bootedAt:
      uptimeSeconds !== null && Number.isFinite(uptimeSeconds)
        ? new Date(now.getTime() - uptimeSeconds * 1_000).toISOString()
        : null,
    processes,
    threads: Number.isFinite(threads) ? threads : null,
  };
}

/**
 * A `/proc/<pid>/stat` line.
 *
 * `comm` is parenthesised and may itself contain spaces and parentheses — a
 * process can call itself `((a b)`. Splitting the line on whitespace is the
 * classic way to misparse this, so the field is cut on the *last* `)` and the
 * numeric fields are indexed from there.
 */
export interface ProcessStat {
  pid: number;
  command: string;
  state: string;
  utime: number;
  stime: number;
  threads: number;
}

export function parseProcessStat(input: string): ProcessStat | null {
  const open = input.indexOf("(");
  const close = input.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(input.slice(0, open).trim());
  const command = input.slice(open + 1, close);
  const fields = input
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  const state = fields[0] ?? "";
  // Field indices are the man-page positions minus the three consumed above.
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  const threads = Number(fields[17]);
  if (
    !Number.isFinite(pid) ||
    !Number.isFinite(utime) ||
    !Number.isFinite(stime)
  )
    return null;
  return {
    pid,
    command,
    state,
    utime,
    stime,
    threads: Number.isFinite(threads) ? threads : 0,
  };
}

export interface ProcessCounters {
  pid: number;
  command: string;
  state: string;
  jiffies: number;
  threads: number;
  residentBytes: number;
}

const PAGE_BYTES = 4_096;
/** `USER_HZ`, which is 100 on every Linux target this runs on. */
export const CLOCK_TICKS_PER_SECOND = 100;

/**
 * Every process, with the counters a CPU share is derived from.
 *
 * Reading a few hundred `/proc/<pid>` entries is the most expensive thing in a
 * sample, so both files per process are read in one pass and anything that
 * vanishes mid-walk is skipped rather than retried — a process exiting while
 * `/proc` is being read is the normal case, not an error.
 */
export async function readProcessCounters(
  options: SystemReaderOptions = {},
): Promise<ProcessCounters[]> {
  const read = options.readFile ?? readTrimmed;
  const readEntries = options.readDir ?? ((path) => readdir(path));
  const pids = await readEntries("/proc")
    .then((entries) => entries.filter((entry) => /^\d+$/.test(entry)))
    .catch(() => [] as string[]);

  const rows = await Promise.all(
    pids.map(async (pid) => {
      const stat = await optional(read, `/proc/${pid}/stat`);
      if (stat === null) return null;
      const parsed = parseProcessStat(stat);
      if (!parsed) return null;
      // `statm`'s second field is resident pages. Cheaper than `status`, which
      // is forty lines of text per process.
      const statm = await optional(read, `/proc/${pid}/statm`);
      const resident = statm ? Number(statm.split(/\s+/)[1]) : Number.NaN;
      return {
        pid: parsed.pid,
        command: parsed.command,
        state: parsed.state,
        jiffies: parsed.utime + parsed.stime,
        threads: parsed.threads,
        residentBytes: Number.isFinite(resident) ? resident * PAGE_BYTES : 0,
      };
    }),
  );

  return rows.filter((row): row is ProcessCounters => row !== null);
}

/**
 * The processes worth showing, given the previous sample's counters.
 *
 * CPU is a delta over the interval, not the since-boot average `ps` prints —
 * a daemon that pegged a core for an hour at boot would otherwise sit at the top
 * of this list forever while the box is idle. A process with no previous sample
 * (just started) reports 0 rather than its whole lifetime's usage compressed
 * into one interval.
 */
export function topProcesses(
  current: readonly ProcessCounters[],
  previous: ReadonlyMap<number, number>,
  elapsedSeconds: number,
  limit: number,
): ForgeProcess[] {
  const scored = current.map((process) => {
    const before = previous.get(process.pid);
    const deltaJiffies =
      before === undefined ? 0 : Math.max(process.jiffies - before, 0);
    const cpuPercent =
      elapsedSeconds > 0
        ? (deltaJiffies / CLOCK_TICKS_PER_SECOND / elapsedSeconds) * 100
        : 0;
    return {
      pid: process.pid,
      command: process.command,
      cpuPercent,
      residentBytes: process.residentBytes,
      threads: process.threads,
      state: process.state,
    };
  });

  // Ranked on CPU with memory as the tiebreak, then the memory leaders folded
  // in: the two questions "what is burning the box" and "what is holding it"
  // rarely have the same answer, and a list answering only the first is the one
  // that misses a leak.
  const byCpu = [...scored]
    .sort(
      (a, b) =>
        b.cpuPercent - a.cpuPercent || b.residentBytes - a.residentBytes,
    )
    .slice(0, limit);
  const seen = new Set(byCpu.map((process) => process.pid));
  const byMemory = [...scored]
    .sort((a, b) => b.residentBytes - a.residentBytes)
    .filter((process) => !seen.has(process.pid))
    .slice(0, limit);

  return [...byCpu, ...byMemory];
}
