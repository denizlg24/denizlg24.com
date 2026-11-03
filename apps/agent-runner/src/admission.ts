import { readFile, statfs } from "node:fs/promises";
import { z } from "zod";
import type { RunnerConfig } from "./config";
import type { FetchLike } from "./http";

/** MemAvailable in bytes, or null when the line is missing or unreadable. */
export function parseMemAvailable(meminfo: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s*kB$/m.exec(meminfo);
  if (!match?.[1]) return null;
  return Number(match[1]) * 1024;
}

const forgeHealthSchema = z.object({
  queue: z.object({
    running: z.number().int().min(0),
    building: z.number().int().min(0).optional(),
  }),
});

/**
 * Builds in flight on Forge. An older agent reports only `running`, which
 * over-counts (it includes post-build container starts) and so errs on the
 * side of waiting.
 */
export function parseForgeBuilding(body: unknown): number | null {
  const parsed = forgeHealthSchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.queue.building ?? parsed.data.queue.running;
}

export interface AdmissionSample {
  memAvailableBytes: number | null;
  forgeBuilding: number | null;
  freeDiskBytes: number | null;
  live: number;
  egressReady: boolean;
}

export interface AdmissionDecision {
  capacity: number;
  admissible: boolean;
  reasons: string[];
}

export interface AdmissionLimits {
  maxConcurrent: number;
  minMemAvailableBytes: number;
  minFreeDiskBytes: number;
}

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * Whether a new run may start now. An unknown reading counts against
 * admission: a run that pushes the box into swap costs more than one that
 * waits fifteen seconds.
 */
export function decideAdmission(
  sample: AdmissionSample,
  limits: AdmissionLimits,
): AdmissionDecision {
  const capacity = Math.max(0, limits.maxConcurrent - sample.live);
  const reasons: string[] = [];
  if (capacity === 0) reasons.push(`${sample.live} runs live`);
  if (sample.memAvailableBytes === null) {
    reasons.push("MemAvailable unreadable");
  } else if (sample.memAvailableBytes < limits.minMemAvailableBytes) {
    reasons.push(`MemAvailable ${gib(sample.memAvailableBytes)}`);
  }
  if (sample.forgeBuilding === null) {
    reasons.push("Forge agent health unreadable");
  } else if (sample.forgeBuilding > 0) {
    reasons.push(`${sample.forgeBuilding} Forge build(s) running`);
  }
  if (sample.freeDiskBytes === null) {
    reasons.push("free disk unreadable");
  } else if (sample.freeDiskBytes < limits.minFreeDiskBytes) {
    reasons.push(`free disk ${gib(sample.freeDiskBytes)}`);
  }
  if (!sample.egressReady) reasons.push("egress rules not verified");
  return { capacity, admissible: reasons.length === 0, reasons };
}

export interface AdmissionProbes {
  meminfo(): Promise<string>;
  forgeHealth(): Promise<unknown>;
  freeDiskBytes(): Promise<number>;
}

export function hostProbes(
  config: Pick<RunnerConfig, "forgeHealthUrl" | "root">,
  fetchImpl: FetchLike = fetch,
): AdmissionProbes {
  return {
    meminfo: () => readFile("/proc/meminfo", "utf8"),
    async forgeHealth() {
      const response = await fetchImpl(config.forgeHealthUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      // 503 is an agent that is up and cannot deploy; its queue still counts.
      return response.json();
    },
    freeDiskBytes: () => freeBytes(config.root),
  };
}

export async function freeBytes(path: string): Promise<number> {
  const stats = await statfs(path);
  return stats.bavail * stats.bsize;
}

export async function sampleAdmission(
  probes: AdmissionProbes,
  live: number,
  egressReady: boolean,
): Promise<AdmissionSample> {
  const [meminfo, health, disk] = await Promise.allSettled([
    probes.meminfo(),
    probes.forgeHealth(),
    probes.freeDiskBytes(),
  ]);
  return {
    memAvailableBytes:
      meminfo.status === "fulfilled" ? parseMemAvailable(meminfo.value) : null,
    forgeBuilding:
      health.status === "fulfilled" ? parseForgeBuilding(health.value) : null,
    freeDiskBytes: disk.status === "fulfilled" ? disk.value : null,
    live,
    egressReady,
  };
}
