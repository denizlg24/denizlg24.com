import { readFile, statfs } from "node:fs/promises";

import {
  type AgentHealth,
  type AgentMemoryHealth,
  type AgentQueueSnapshot,
  DISK_DEGRADED_PERCENT,
  DISK_UNAVAILABLE_PERCENT,
  MIN_MEMORY_MB,
} from "@repo/schemas/cloud";

import type { DockerClient } from "./docker";

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export type StatfsLike = (path: string) => Promise<{
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}>;

/**
 * Matches what `df` reports: capacity is measured against what an unprivileged
 * writer can actually use, so the reserved blocks root keeps are excluded from
 * the denominator. Reporting the raw block ratio instead understates usage by
 * roughly five percent and makes the alert fire late.
 */
export function diskUsageFrom(stats: {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}): DiskUsage {
  const used = stats.blocks - stats.bfree;
  const usable = used + stats.bavail;
  return {
    totalBytes: stats.blocks * stats.bsize,
    freeBytes: stats.bavail * stats.bsize,
    usedPercent: usable > 0 ? (used / usable) * 100 : 0,
  };
}

/**
 * `/proc/meminfo` reports kB. Only two lines matter: `MemTotal` is what the
 * budget is carved out of, and `MemAvailable` is what can actually be had right
 * now — `MemFree` excludes reclaimable page cache and reads as a host with no
 * memory on a box that is merely warm.
 */
export function parseMeminfo(
  contents: string,
): { totalMb: number; availableMb: number } | null {
  const read = (field: string): number | null => {
    const match = new RegExp(`^${field}:\\s+(\\d+) kB$`, "m").exec(contents);
    return match?.[1] ? Math.floor(Number(match[1]) / 1_024) : null;
  };
  const totalMb = read("MemTotal");
  const availableMb = read("MemAvailable");
  if (totalMb === null || availableMb === null) return null;
  return { totalMb, availableMb };
}

/**
 * What may be handed out, which is deliberately less than the host has.
 *
 * The build reserve is the term that is easy to leave out and the one that
 * causes the outage: a build is allowed several gigabytes it is not holding
 * yet, so budgeting against present usage schedules an app into exactly the
 * space the next build is about to take.
 */
export function allocatableMemoryMb(input: {
  totalMb: number;
  headroomMb: number;
  buildReserveMb: number;
}): number {
  return Math.max(input.totalMb - input.headroomMb - input.buildReserveMb, 0);
}

export interface HealthServiceOptions {
  docker: DockerClient;
  dockerDataRoot: string;
  version: string;
  queue: () => AgentQueueSnapshot;
  /** Kept for the OS, dockerd, this agent and Caddy. */
  memoryHeadroomMb: number;
  /** `buildMemoryLimitMb × maxConcurrentBuilds`. */
  buildReserveMb: number;
  statfsImplementation?: StatfsLike;
  readMeminfo?: () => Promise<string>;
  now?: () => number;
  startedAt?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The agent process being alive says nothing about whether it can deploy, and a
 * probe that reports otherwise is worse than none — it converts "every build
 * fails" into "everything is green". So the daemon is contacted and the disk is
 * stat'd on every call, and either failing is reported as `unavailable`.
 */
export class HealthService {
  readonly #options: HealthServiceOptions;
  readonly #startedAt: number;
  readonly #now: () => number;
  readonly #statfs: StatfsLike;

  constructor(options: HealthServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#startedAt = options.startedAt ?? this.#now();
    this.#statfs = options.statfsImplementation ?? (statfs as StatfsLike);
  }

  async check(): Promise<AgentHealth> {
    const [docker, disk, memory] = await Promise.all([
      this.#checkDocker(),
      this.#checkDisk(),
      this.#checkMemory(),
    ]);

    let status: AgentHealth["status"] = "ok";
    if (
      !docker.reachable ||
      disk.error !== null ||
      (memory.allocatableMb !== null && memory.allocatableMb < MIN_MEMORY_MB)
    ) {
      status = "unavailable";
    } else if (
      disk.usedPercent !== null &&
      disk.usedPercent >= DISK_UNAVAILABLE_PERCENT
    ) {
      status = "unavailable";
    } else if (
      disk.usedPercent !== null &&
      disk.usedPercent >= DISK_DEGRADED_PERCENT
    ) {
      status = "degraded";
    }

    return {
      status,
      version: this.#options.version,
      uptimeSeconds: Math.floor((this.#now() - this.#startedAt) / 1_000),
      docker,
      disk,
      memory,
      queue: this.#options.queue(),
    };
  }

  /**
   * An unreadable report never fails the health status. A host whose memory
   * cannot be read is not a host that cannot deploy — the control plane reads a
   * null budget as "unknown" and skips admission, which is the same behaviour as
   * before any of this existed.
   */
  async #checkMemory(): Promise<AgentMemoryHealth> {
    const headroomMb = this.#options.memoryHeadroomMb;
    const buildReserveMb = this.#options.buildReserveMb;
    try {
      const read =
        this.#options.readMeminfo ?? (() => readFile("/proc/meminfo", "utf8"));
      const parsed = parseMeminfo(await read());
      if (!parsed) throw new Error("Could not read MemTotal and MemAvailable");
      return {
        totalMb: parsed.totalMb,
        availableMb: parsed.availableMb,
        allocatableMb: allocatableMemoryMb({
          totalMb: parsed.totalMb,
          headroomMb,
          buildReserveMb,
        }),
        headroomMb,
        buildReserveMb,
        error: null,
      };
    } catch (error) {
      return {
        totalMb: null,
        availableMb: null,
        allocatableMb: null,
        headroomMb,
        buildReserveMb,
        error: errorMessage(error),
      };
    }
  }

  async #checkDocker(): Promise<AgentHealth["docker"]> {
    try {
      const ping = await this.#options.docker.ping();
      return {
        reachable: true,
        version: ping.version,
        containersRunning: ping.containersRunning,
        error: null,
      };
    } catch (error) {
      return {
        reachable: false,
        version: null,
        containersRunning: null,
        error: errorMessage(error),
      };
    }
  }

  async #checkDisk(): Promise<AgentHealth["disk"]> {
    const path = this.#options.dockerDataRoot;
    try {
      const usage = diskUsageFrom(await this.#statfs(path));
      return {
        path,
        totalBytes: usage.totalBytes,
        freeBytes: usage.freeBytes,
        usedPercent: Number(usage.usedPercent.toFixed(2)),
        error: null,
      };
    } catch (error) {
      return {
        path,
        totalBytes: null,
        freeBytes: null,
        usedPercent: null,
        error: errorMessage(error),
      };
    }
  }
}
