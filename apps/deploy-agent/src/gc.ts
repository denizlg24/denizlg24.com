import { readdir, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";

import type { AgentGcReport, AgentGcRequest } from "@repo/schemas/cloud";

import type { Exec } from "./exec";
import { diskUsageFrom, type StatfsLike } from "./health";

export interface GcOptions {
  exec: Exec;
  buildRoot: string;
  logRoot: string;
  /** Optional so a host with no access logging configured still collects. */
  accessLogRoot?: string;
  cacheRoot: string;
  dockerDataRoot: string;
  buildDataRoot?: string;
  buildxBuilder?: string | null;
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
 * An untagged image still referenced by any container must survive.
 *
 * `keep` here is image *ids*, and it has to cover every container on the host,
 * not just the Forge-labelled ones. Two things made the old version report
 * failures on every pass:
 *
 * `docker ps --format '{{.Image}}'` prints the reference the container was
 * created from, which is a moving tag. A rebuild moves `forge/<slug>:latest`
 * onto the new image and leaves the old one untagged — the container is still
 * running on it, but the in-use set holds the tag, and the tag now resolves
 * elsewhere. The id never appears, so the pass tries to reap an image in use.
 *
 * And the dangling listing is host-wide while the tagged pass is scoped to
 * `reference=forge/*`. Every non-Forge container on the box — the cloud API,
 * Meilisearch, anything pulled by digest — pins an image this pass can see and
 * the Forge-labelled listing cannot.
 *
 * Both are the same conflict Docker refuses with `image is being used by
 * running container`, which is why it read as a failure rather than as data.
 */
export function selectDanglingToRemove(
  present: readonly string[],
  keep: Iterable<string>,
): string[] {
  const kept = new Set(keep);
  return present.filter((id) => id.length > 0 && !kept.has(id));
}

/**
 * The image id every container on the host is actually running.
 *
 * `docker ps` cannot report it — its `{{.Image}}` is the create-time reference,
 * not the resolved id — so the ids come from `docker inspect`, which returns
 * `.Image` as the `sha256:…` the container is pinned to. Unfiltered by label on
 * purpose: this set exists to protect images from a host-wide dangling sweep.
 *
 * Best-effort. A failure here means the sweep proceeds with a smaller keep set
 * and Docker refuses the individual removals, which is the behaviour this
 * replaces — never a reason to abandon the pass.
 */
export async function inUseImageIds(
  exec: Exec,
  signal?: AbortSignal,
): Promise<string[]> {
  const listed = await exec({
    command: ["docker", "ps", "--quiet", "--all", "--no-trunc"],
    signal,
    timeoutMs: 60_000,
  });
  const ids = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (listed.exitCode !== 0 || ids.length === 0) return [];

  const inspected = await exec({
    command: ["docker", "inspect", "--format", "{{.Image}}", ...ids],
    signal,
    timeoutMs: 60_000,
  });
  // Partial output is still useful: `docker inspect` prints what it resolved and
  // exits non-zero for the ids that vanished mid-call.
  return inspected.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("sha256:"));
}

/**
 * Docker's refusal to delete an image something is running.
 *
 * A skip, not a failure: it is the daemon telling us the keep set was
 * incomplete — a container started between the listing and the removal, or one
 * whose id `inUseImageIds` could not resolve. The disk is not reclaimed either
 * way, but nothing is wrong, and reporting it as a failure trains the reader to
 * ignore a list that also carries real errors.
 */
export function isImageInUseConflict(stderr: string): boolean {
  return /image is being used by|imag(e|es) is referenced in/i.test(stderr);
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

/**
 * `docker builder prune` reaches the daemon's embedded BuildKit and nothing
 * else; a `docker-container` or `remote` builder keeps its cache in its own
 * daemon, which is why `docker system df` cannot see it either. Both need
 * sweeping, and the named one first so a failure there still leaves the
 * runtime disk swept.
 *
 * `--all` is not optional here. Without it a prune only reaps *dangling*
 * records — ones no image or cache manifest still reaches — and on a worker
 * that keeps its state across builds almost every record is reachable from the
 * last build of some project. That is why every hourly pass reported exactly
 * 0 bytes reclaimed while the cache grew past 300 GB.
 *
 * What keeps `--all` from being destructive is the `until` filter the caller
 * appends: records touched inside the window survive regardless, so this
 * removes cache nothing has needed for days, not the cache that makes the next
 * build fast.
 */
export function builderPruneCommands(
  buildxBuilder: string | null | undefined,
): string[][] {
  const daemon = ["docker", "builder", "prune", "--all"];
  if (!buildxBuilder) return [daemon];
  return [
    ["docker", "buildx", "prune", "--builder", buildxBuilder, "--all"],
    daemon,
  ];
}

function parseReclaimedBytes(output: string): number | null {
  const match =
    /(?:Total reclaimed space|Total):\s*([\d.]+)\s*([KMGT]?i?B)/i.exec(output);
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
  const buildDataRoot = options.buildDataRoot ?? options.buildRoot;
  const failures: Failures = [];
  const report: AgentGcReport = {
    dryRun: request.dryRun,
    imagesRemoved: [],
    imagesSkipped: [],
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
    buildDisk: {
      path: buildDataRoot,
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
    if (removed.exitCode === 0) {
      report.imagesRemoved.push(tag);
      continue;
    }
    const stderr = removed.stderr.trim();
    if (isImageInUseConflict(stderr)) {
      report.imagesSkipped.push(tag);
      continue;
    }
    failures.push({
      step: "images",
      subject: tag,
      error: stderr || `exit ${removed.exitCode}`,
    });
  }

  // A rebuild moves `forge/<slug>:latest` off the previous image and leaves it
  // untagged holding a full layer set. `reference=forge/*` cannot see an
  // untagged image at all, so the pass above never reaches these and they
  // accumulate one per build per project until the disk fills.
  const dangling = await exec({
    command: [
      "docker",
      "images",
      "--no-trunc",
      "--filter",
      "dangling=true",
      "--format",
      "{{.ID}}",
    ],
    signal,
    timeoutMs: 60_000,
  });
  if (dangling.exitCode !== 0) {
    failures.push({
      step: "dangling-images",
      subject: "docker images",
      error: dangling.stderr.trim() || `exit ${dangling.exitCode}`,
    });
  }

  // The dangling listing is host-wide, so the tags gathered from Forge-labelled
  // containers do not cover it — and a tag is the wrong kind of key here anyway.
  // Resolved ids are what a dangling id can be compared against.
  const pinned = new Set([
    ...inUseImages,
    ...(await inUseImageIds(exec, signal)),
  ]);

  for (const id of selectDanglingToRemove(
    dangling.stdout.split("\n").map((line) => line.trim()),
    pinned,
  )) {
    if (request.dryRun) {
      report.imagesRemoved.push(id);
      continue;
    }
    const removed = await exec({
      command: ["docker", "rmi", id],
      signal,
      timeoutMs: 180_000,
    });
    if (removed.exitCode === 0) {
      report.imagesRemoved.push(id);
      continue;
    }
    const stderr = removed.stderr.trim();
    // Something started using it between the listing and now. Nothing is wrong
    // and nothing was reclaimed; the next pass will find it again.
    if (isImageInUseConflict(stderr)) {
      report.imagesSkipped.push(id.slice(0, 19));
      continue;
    }
    failures.push({
      step: "dangling-images",
      subject: id.slice(0, 19),
      error: stderr || `exit ${removed.exitCode}`,
    });
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

  // Access logs, on the same retention as build logs. Caddy caps each file by
  // rolling it, which bounds one deployment's logs but not the number of files —
  // every deployment that ever served a request leaves one behind, and nothing
  // else would ever remove them.
  //
  // A kept deployment's file is never touched, even if its mtime is old. Caddy
  // holds an open descriptor to the file of anything it is routing and does not
  // notice the unlink: it goes on writing to a detached inode, so the log looks
  // frozen until the next publish reopens it. An idle-but-live deployment is
  // exactly the case where the mtime would be old enough to qualify.
  if (options.accessLogRoot) {
    const accessRoot = options.accessLogRoot;
    const keep = new Set(request.keepDeploymentIds);
    for (const name of await listEntriesOlderThan(accessRoot, logCutoff)) {
      if (keep.has(name.replace(/\.log$/, ""))) continue;
      if (request.dryRun) {
        report.logsRemoved.push(name);
        continue;
      }
      try {
        await rm(join(accessRoot, name), { recursive: true, force: true });
        report.logsRemoved.push(name);
      } catch (error) {
        failures.push({
          step: "access-logs",
          subject: name,
          error: errorMessage(error),
        });
      }
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
    // The daemon's own BuildKit is not the named builder's. Pruning only the
    // named one strands everything the embedded builder wrote — which is how
    // 111 GB of reclaimable cache sat on the runtime disk unnoticed after the
    // builder moved to its own daemon. It also keeps the sweep correct if
    // BUILDKIT_ENDPOINT is ever unset and builds fall back to the daemon.
    for (const pruneCommand of builderPruneCommands(options.buildxBuilder)) {
      const pruned = await exec({
        command: [
          ...pruneCommand,
          "--filter",
          `until=${request.builderPruneHours}h`,
          "--force",
        ],
        signal,
        timeoutMs: 600_000,
      });
      if (pruned.exitCode === 0) {
        const reclaimed = parseReclaimedBytes(
          `${pruned.stdout}\n${pruned.stderr}`,
        );
        if (reclaimed !== null) {
          report.builderCacheReclaimedBytes =
            (report.builderCacheReclaimedBytes ?? 0) + reclaimed;
        }
      } else {
        failures.push({
          step: "builder-cache",
          subject: pruneCommand.join(" "),
          error: pruned.stderr.trim() || `exit ${pruned.exitCode}`,
        });
      }
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

  try {
    const usage = diskUsageFrom(await statfsImplementation(buildDataRoot));
    report.buildDisk = {
      path: buildDataRoot,
      totalBytes: usage.totalBytes,
      freeBytes: usage.freeBytes,
      usedPercent: Number(usage.usedPercent.toFixed(2)),
      error: null,
    };
  } catch (error) {
    report.buildDisk = {
      ...report.buildDisk!,
      error: errorMessage(error),
    };
  }

  return report;
}
