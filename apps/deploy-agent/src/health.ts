import { statfs } from "node:fs/promises";

import {
  type AgentHealth,
  type AgentQueueSnapshot,
  DISK_DEGRADED_PERCENT,
  DISK_UNAVAILABLE_PERCENT,
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

export interface HealthServiceOptions {
  docker: DockerClient;
  dockerDataRoot: string;
  version: string;
  queue: () => AgentQueueSnapshot;
  statfsImplementation?: StatfsLike;
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
    const [docker, disk] = await Promise.all([
      this.#checkDocker(),
      this.#checkDisk(),
    ]);

    let status: AgentHealth["status"] = "ok";
    if (!docker.reachable || disk.error !== null) {
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
      queue: this.#options.queue(),
    };
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
