import { readdir, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";

import type { AgentGcReport, AgentGcRequest } from "@repo/schemas/cloud";

import type { Exec } from "./exec";
import { diskUsageFrom, type StatfsLike } from "./health";

export interface GcOptions {
  exec: Exec;
  buildRoot: string;
  logRoot: string;
  cacheRoot: string;
  dockerDataRoot: string;
  /** Orphaned checkouts from a crashed build. Anything younger may be live. */
  buildMaxAgeMs?: number;
  now?: () => number;
  statfsImplementation?: StatfsLike;
  signal?: AbortSignal;
}

const DEFAULT_BUILD_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const IMAGE_REFERENCE = "forge/*";

type Failures = AgentGcReport["failures"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A moving tag is not a stale tag. `forge/<slug>:latest` is what every next
 * build passes to `--cache-from`, so reaping it looks tidy and costs a cold
 * build on every project it touched.
 */
export function isCacheTag(tag: string): boolean {
  return tag.endsWith(":latest");
}

export function selectImagesToRemove(
  present: readonly string[],
  keep: Iterable<string>,
): string[] {
  const kept = new Set(keep);
  return present.filter(
    (tag) =>
      tag.length > 0 &&
      !tag.includes("<none>") &&
      !isCacheTag(tag) &&
      !kept.has(tag),
  );
}

/**
 * Bytes on disk, not the apparent size — close enough for a cap whose only job
 * is to stop `--cache-to mode=max` growing until it eats the image store.
 */
export async function directorySizeBytes(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stats = await stat(join(entry.parentPath, entry.name)).catch(
      () => null,
    );
    if (stats) total += stats.size;
  }
  return total;
}

function parseReclaimedBytes(output: string): number | null {
  const match = /Total reclaimed space:\s*([\d.]+)\s*([KMGT]?i?B)/i.exec(
    output,
  );
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const units: Record<string, number> = {
    b: 1,
    kb: 1_000,
    kib: 1_024,
    mb: 1_000_000,
    mib: 1_048_576,
    gb: 1_000_000_000,
    gib: 1_073_741_824,
    tb: 1_000_000_000_000,
    tib: 1_099_511_627_776,
  };
  const unit = units[(match[2] ?? "B").toLowerCase()] ?? 1;
  return Math.round(value * unit);
}

async function listEntriesOlderThan(
  root: string,
  cutoff: number,
): Promise<string[]> {
  const names = await readdir(root).catch(() => []);
  const stale: string[] = [];
  for (const name of names) {
    const stats = await stat(join(root, name)).catch(() => null);
    if (stats && stats.mtimeMs < cutoff) stale.push(name);
  }
  return stale;
}

/**
 * Everything here is best-effort by construction. The sweep exists to keep a
 * 140 GB disk from filling, and one image another container still references —
 * or one directory a build is mid-write on — is a line in the report, never a
 * reason to abandon the rest of the pass.
 */
export async function runGarbageCollection(
  request: AgentGcRequest,
  options: GcOptions,
): Promise<AgentGcReport> {
  const now = options.now ?? Date.now;
  const { exec, signal } = options;
  const failures: Failures = [];
  const report: AgentGcReport = {
    dryRun: request.dryRun,
    imagesRemoved: [],
    containersRemoved: [],
    buildsRemoved: [],
    logsRemoved: [],
    cacheDirsRemoved: [],
    builderCacheReclaimedBytes: null,
    disk: {
      path: options.dockerDataRoot,
      totalBytes: null,
      freeBytes: null,
      usedPercent: null,
      error: null,
    },
    failures,
  };

  const keepDeployments = new Set(request.keepDeploymentIds);
  const inUseImages = new Set(request.keepImageTags);

  // Containers first: an image cannot be removed while something references it,
  // so reaping in the other order turns every removable image into a failure.
  const listed = await exec({
    command: [
      "docker",
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      "label=forge.deployment",
      "--format",
      '{{.ID}}\t{{.Label "forge.deployment"}}\t{{.Image}}',
    ],
    signal,
    timeoutMs: 60_000,
  });
  if (listed.exitCode !== 0) {
    failures.push({
      step: "containers",
      subject: "docker ps",
      error: listed.stderr.trim() || `exit ${listed.exitCode}`,
    });
  }

  for (const line of listed.stdout.split("\n")) {
    const [containerId = "", deploymentId = "", image = ""] = line
      .trim()
      .split("\t");
    if (containerId.length === 0) continue;
    if (keepDeployments.has(deploymentId)) {
      if (image.length > 0) inUseImages.add(image);
      continue;
    }
    if (request.dryRun) {
      report.containersRemoved.push(containerId);
      continue;
    }
    const removed = await exec({
      command: ["docker", "rm", "--force", "--volumes", containerId],
      signal,
      timeoutMs: 120_000,
    });
    if (removed.exitCode === 0) {
      report.containersRemoved.push(containerId);
    } else {
      // Still in use is the common case, and it means the container outlived
      // our view of it — keep its image so the image pass does not fail too.
      if (image.length > 0) inUseImages.add(image);
      failures.push({
        step: "containers",
        subject: containerId.slice(0, 12),
        error: removed.stderr.trim() || `exit ${removed.exitCode}`,
      });
    }
  }

  const images = await exec({
    command: [
      "docker",
      "images",
      "--filter",
      `reference=${IMAGE_REFERENCE}`,
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ],
    signal,
    timeoutMs: 60_000,
  });
  if (images.exitCode !== 0) {
    failures.push({
      step: "images",
      subject: "docker images",
      error: images.stderr.trim() || `exit ${images.exitCode}`,
    });
  }

  for (const tag of selectImagesToRemove(
    images.stdout.split("\n").map((line) => line.trim()),
    inUseImages,
  )) {
    if (request.dryRun) {
      report.imagesRemoved.push(tag);
      continue;
    }
    const removed = await exec({
      command: ["docker", "rmi", tag],
      signal,
      timeoutMs: 180_000,
    });
    if (removed.exitCode === 0) report.imagesRemoved.push(tag);
    else {
      failures.push({
        step: "images",
        subject: tag,
        error: removed.stderr.trim() || `exit ${removed.exitCode}`,
      });
    }
  }

  const buildCutoff =
    now() - (options.buildMaxAgeMs ?? DEFAULT_BUILD_MAX_AGE_MS);
  for (const name of await listEntriesOlderThan(
    options.buildRoot,
    buildCutoff,
  )) {
    if (keepDeployments.has(name)) continue;
    if (request.dryRun) {
      report.buildsRemoved.push(name);
      continue;
    }
    try {
      await rm(join(options.buildRoot, name), { recursive: true, force: true });
      report.buildsRemoved.push(name);
    } catch (error) {
      failures.push({
        step: "builds",
        subject: name,
        error: errorMessage(error),
      });
    }
  }

  const logCutoff = now() - request.logRetentionDays * DAY_MS;
  for (const name of await listEntriesOlderThan(options.logRoot, logCutoff)) {
    if (request.dryRun) {
      report.logsRemoved.push(name);
      continue;
    }
    try {
      await rm(join(options.logRoot, name), { recursive: true, force: true });
      report.logsRemoved.push(name);
    } catch (error) {
      failures.push({
        step: "logs",
        subject: name,
        error: errorMessage(error),
      });
    }
  }

  // A deleted cache costs one slow build and nothing else, which is what makes
  // capping it safe to do bluntly.
  const cacheCutoff = now() - request.buildCacheMaxAgeDays * DAY_MS;
  const cacheLimitBytes = request.buildCacheMaxMb * 1_048_576;
  for (const name of await readdir(options.cacheRoot).catch(() => [])) {
    const path = join(options.cacheRoot, name);
    const stats = await stat(path).catch(() => null);
    if (!stats?.isDirectory()) continue;
    const size = await directorySizeBytes(path);
    const expired = stats.mtimeMs < cacheCutoff;
    const oversized = cacheLimitBytes > 0 && size > cacheLimitBytes;
    if (!expired && !oversized) continue;
    if (request.dryRun) {
      report.cacheDirsRemoved.push(name);
      continue;
    }
    try {
      await rm(path, { recursive: true, force: true });
      report.cacheDirsRemoved.push(name);
    } catch (error) {
      failures.push({
        step: "cache",
        subject: name,
        error: errorMessage(error),
      });
    }
  }

  if (!request.dryRun) {
    const pruned = await exec({
      command: [
        "docker",
        "builder",
        "prune",
        "--filter",
        `until=${request.builderPruneHours}h`,
        "--force",
      ],
      signal,
      timeoutMs: 600_000,
    });
    if (pruned.exitCode === 0) {
      report.builderCacheReclaimedBytes = parseReclaimedBytes(pruned.stdout);
    } else {
      failures.push({
        step: "builder-cache",
        subject: "docker builder prune",
        error: pruned.stderr.trim() || `exit ${pruned.exitCode}`,
      });
    }
  }

  const statfsImplementation =
    options.statfsImplementation ?? (statfs as StatfsLike);
  try {
    const usage = diskUsageFrom(
      await statfsImplementation(options.dockerDataRoot),
    );
    report.disk = {
      path: options.dockerDataRoot,
      totalBytes: usage.totalBytes,
      freeBytes: usage.freeBytes,
      usedPercent: Number(usage.usedPercent.toFixed(2)),
      error: null,
    };
  } catch (error) {
    report.disk = { ...report.disk, error: errorMessage(error) };
  }

  return report;
}
