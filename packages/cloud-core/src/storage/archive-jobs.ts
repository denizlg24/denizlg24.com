import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";

import { type ArchiveEntry, writeArchive } from "./archive";
import { deletePath, ensureDir } from "./fs";

export type ArchiveJobState = "building" | "ready" | "failed";

export interface ArchiveJob {
  id: string;
  ownerKey: string;
  filename: string;
  fileCount: number;
  totalBytes: number;
  writtenBytes: number;
  state: ArchiveJobState;
  error: string | null;
  diskPath: string;
  expiresAt: number;
}

export interface ArchiveJobStoreOptions {
  directory: string;
  ttlMs: number;
  sweepIntervalMs?: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const ARCHIVE_JOB_SNAPSHOT_VERSION = 1;
const MAX_ACTIVE_JOBS_IN_SNAPSHOT = 4_096;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ARCHIVE_JOB_SNAPSHOT_FILENAME = ".active-jobs.json";

export interface ActiveArchiveJobSnapshot {
  id: string;
  startedAt: string;
  state: "building";
}

export interface ArchiveJobSnapshot {
  activeJobs: ActiveArchiveJobSnapshot[];
  bootId: string | null;
  instanceId: string;
  pid: number;
  processStartTimeTicks: string | null;
  updatedAt: string;
  version: typeof ARCHIVE_JOB_SNAPSHOT_VERSION;
}

export type ArchiveJobSnapshotReadResult =
  | { snapshot: ArchiveJobSnapshot; status: "current" }
  | { snapshot: ArchiveJobSnapshot; status: "stale" }
  | { reason: string; status: "invalid" | "missing" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSnapshot(value: unknown): ArchiveJobSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== ARCHIVE_JOB_SNAPSHOT_VERSION ||
    typeof value.instanceId !== "string" ||
    !UUID_PATTERN.test(value.instanceId) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !(value.bootId === null || typeof value.bootId === "string") ||
    !(
      value.processStartTimeTicks === null ||
      (typeof value.processStartTimeTicks === "string" &&
        /^\d+$/.test(value.processStartTimeTicks))
    ) ||
    typeof value.updatedAt !== "string" ||
    Number.isNaN(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.activeJobs) ||
    value.activeJobs.length > MAX_ACTIVE_JOBS_IN_SNAPSHOT
  ) {
    return null;
  }

  const activeJobs: ActiveArchiveJobSnapshot[] = [];
  const ids = new Set<string>();
  for (const job of value.activeJobs) {
    if (
      !isRecord(job) ||
      typeof job.id !== "string" ||
      !UUID_PATTERN.test(job.id) ||
      ids.has(job.id) ||
      job.state !== "building" ||
      typeof job.startedAt !== "string" ||
      Number.isNaN(Date.parse(job.startedAt))
    ) {
      return null;
    }
    ids.add(job.id);
    activeJobs.push({
      id: job.id,
      startedAt: job.startedAt,
      state: "building",
    });
  }

  return {
    activeJobs,
    bootId: value.bootId as string | null,
    instanceId: value.instanceId,
    pid: value.pid,
    processStartTimeTicks: value.processStartTimeTicks as string | null,
    updatedAt: value.updatedAt,
    version: ARCHIVE_JOB_SNAPSHOT_VERSION,
  };
}

type LinuxProcessIdentityResult =
  | { bootId: string; processStartTimeTicks: string; status: "available" }
  | { status: "missing" }
  | { status: "unavailable" };

async function linuxProcessIdentity(
  pid: number,
): Promise<LinuxProcessIdentityResult> {
  let statLine: string;
  try {
    statLine = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "unavailable" };
  }
  // The parenthesized command may itself contain spaces or `)`, so field 3
  // starts only after the final closing parenthesis. starttime is field 22.
  const commandEnd = statLine.lastIndexOf(")");
  const fields = statLine
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/);
  const processStartTimeTicks = fields[19];
  if (
    commandEnd < 0 ||
    !processStartTimeTicks ||
    !/^\d+$/.test(processStartTimeTicks)
  ) {
    return { status: "unavailable" };
  }

  let bootId: string;
  try {
    bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  } catch {
    return { status: "unavailable" };
  }
  if (!UUID_PATTERN.test(bootId)) return { status: "unavailable" };
  return { bootId, processStartTimeTicks, status: "available" };
}

/**
 * Reads the private, process-owned archive activity snapshot. Consumers must
 * treat every result except `current` as a blocker: an absent or stale file can
 * mean the archive process crashed while a ZIP was being built.
 */
export async function readArchiveJobSnapshot(
  directory: string,
): Promise<ArchiveJobSnapshotReadResult> {
  const path = join(directory, ARCHIVE_JOB_SNAPSHOT_FILENAME);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        reason: "archive activity snapshot is missing",
        status: "missing",
      };
    }
    return {
      reason: "archive activity snapshot is unreadable",
      status: "invalid",
    };
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      return {
        reason: "archive activity snapshot is not a regular file",
        status: "invalid",
      };
    }
    if ((metadata.mode & 0o777) !== 0o600) {
      return {
        reason: "archive activity snapshot permissions are not private",
        status: "invalid",
      };
    }
    if (metadata.size > MAX_SNAPSHOT_BYTES) {
      return {
        reason: "archive activity snapshot exceeds its size limit",
        status: "invalid",
      };
    }

    let value: unknown;
    try {
      value = JSON.parse(await handle.readFile("utf8"));
    } catch {
      return {
        reason: "archive activity snapshot is not valid JSON",
        status: "invalid",
      };
    }
    const snapshot = parseSnapshot(value);
    if (!snapshot) {
      return {
        reason: "archive activity snapshot has an invalid schema",
        status: "invalid",
      };
    }
    return verifySnapshotProcess(snapshot);
  } finally {
    await handle.close();
  }
}

async function verifySnapshotProcess(
  snapshot: ArchiveJobSnapshot,
): Promise<ArchiveJobSnapshotReadResult> {
  if (process.platform === "linux") {
    if (!snapshot.bootId || !snapshot.processStartTimeTicks) {
      return {
        reason: "archive process identity is missing",
        status: "invalid",
      };
    }
    const identity = await linuxProcessIdentity(snapshot.pid);
    if (identity.status === "missing") return { snapshot, status: "stale" };
    if (identity.status === "unavailable") {
      return {
        reason: "archive process identity cannot be verified",
        status: "invalid",
      };
    }
    if (
      identity.bootId !== snapshot.bootId ||
      identity.processStartTimeTicks !== snapshot.processStartTimeTicks
    ) {
      return { snapshot, status: "stale" };
    }
    return { snapshot, status: "current" };
  }

  // Non-Linux development hosts have no portable process-birth identity. Keep
  // PID liveness as an explicit test/development fallback; production Linux
  // never takes this branch.
  try {
    process.kill(snapshot.pid, 0);
    return { snapshot, status: "current" };
  } catch {
    return { snapshot, status: "stale" };
  }
}

async function writePrivateJsonAtomically(
  path: string,
  value: unknown,
  temporaryPaths: Set<string>,
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  temporaryPaths.add(temporaryPath);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    temporaryPaths.delete(temporaryPath);
  }
}

/**
 * Tracks archives being built on disk. Job recovery deliberately remains
 * in-memory: a restart drops the registry, the startup sweep removes orphaned
 * files, and the client sees the poll 404. A minimal private disk snapshot
 * exists only so out-of-process maintenance can fail closed around live or
 * crashed builds; it contains no owner keys, filenames, or selections.
 */
export class ArchiveJobStore {
  readonly #jobs = new Map<string, ArchiveJob>();
  readonly #jobStartedAt = new Map<string, string>();
  readonly #directory: string;
  readonly #instanceId = randomUUID();
  readonly #ttlMs: number;
  readonly #sweepIntervalMs: number;
  readonly #temporarySnapshotPaths = new Set<string>();
  #snapshotWrites: Promise<void> = Promise.resolve();
  #sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: ArchiveJobStoreOptions) {
    this.#directory = options.directory;
    this.#ttlMs = options.ttlMs;
    this.#sweepIntervalMs =
      options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  async initialize(): Promise<void> {
    await ensureDir(this.#directory);
    await this.sweep();
    await this.#persistActiveJobs();
    if (this.#sweeper) return;
    this.#sweeper = setInterval(() => {
      void this.sweep().catch(console.error);
    }, this.#sweepIntervalMs);
    this.#sweeper.unref?.();
  }

  close(): void {
    if (!this.#sweeper) return;
    clearInterval(this.#sweeper);
    this.#sweeper = null;
  }

  activeCount(ownerKey: string): number {
    let active = 0;
    for (const job of this.#jobs.values()) {
      if (job.ownerKey === ownerKey && job.state === "building") active += 1;
    }
    return active;
  }

  find(ownerKey: string, id: string): ArchiveJob | undefined {
    const job = this.#jobs.get(id);
    return job?.ownerKey === ownerKey ? job : undefined;
  }

  async start(input: {
    ownerKey: string;
    filename: string;
    totalBytes: number;
    entries: readonly ArchiveEntry[];
  }): Promise<ArchiveJob> {
    const id = randomUUID();
    const job: ArchiveJob = {
      id,
      ownerKey: input.ownerKey,
      filename: input.filename,
      fileCount: input.entries.length,
      totalBytes: input.totalBytes,
      writtenBytes: 0,
      state: "building",
      error: null,
      diskPath: join(this.#directory, `${id}.zip`),
      expiresAt: Date.now() + this.#ttlMs,
    };
    this.#jobs.set(id, job);
    this.#jobStartedAt.set(id, new Date().toISOString());
    try {
      // Do not launch the build until out-of-process readers can see it. This
      // prevents a maintenance preflight from observing a false zero.
      await this.#persistActiveJobs();
    } catch (error) {
      this.#jobs.delete(id);
      this.#jobStartedAt.delete(id);
      throw error;
    }
    void this.#build(job, input.entries).catch(console.error);
    return job;
  }

  async discard(job: ArchiveJob): Promise<void> {
    this.#jobs.delete(job.id);
    this.#jobStartedAt.delete(job.id);
    await this.#persistActiveJobs();
    await deletePath(job.diskPath);
  }

  /** Drops expired jobs and any archive file the registry no longer knows. */
  async sweep(): Promise<void> {
    const now = Date.now();
    for (const job of this.#jobs.values()) {
      if (job.state !== "building" && job.expiresAt <= now) {
        await this.discard(job);
      }
    }
    const tracked = new Set(
      [...this.#jobs.values()].map((job) => job.diskPath),
    );
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(this.#directory, name);
      if (name === ARCHIVE_JOB_SNAPSHOT_FILENAME) continue;
      if (tracked.has(path)) continue;
      if (this.#temporarySnapshotPaths.has(path)) continue;
      const modified = await stat(path)
        .then((stats) => stats.mtimeMs)
        .catch(() => Number.NaN);
      if (Number.isNaN(modified) || now - modified < this.#ttlMs) continue;
      await deletePath(path);
    }
  }

  async #build(
    job: ArchiveJob,
    entries: readonly ArchiveEntry[],
  ): Promise<void> {
    let finalState: Exclude<ArchiveJobState, "building"> = "ready";
    try {
      await ensureDir(this.#directory);
      const written = await writeArchive(entries, job.diskPath, (bytes) => {
        job.writtenBytes = bytes;
      });
      job.writtenBytes = written;
      job.totalBytes = written;
    } catch (error) {
      // Cleanup first: a job that reports "failed" must not still have a
      // half-written archive on disk for a poller to race against.
      await deletePath(job.diskPath).catch(() => undefined);
      job.error =
        error instanceof Error ? error.message : "Archive build failed";
      finalState = "failed";
    } finally {
      job.expiresAt = Date.now() + this.#ttlMs;
      // The public job state is the completion signal used by pollers and
      // tests. Publish the corresponding private snapshot first so nobody can
      // observe a terminal job while out-of-process maintenance still sees it
      // as active (or tear the directory down while this write is in flight).
      await this.#persistActiveJobs(job.id);
      job.state = finalState;
    }
  }

  #persistActiveJobs(completedJobId?: string): Promise<void> {
    // Capture at the transition, not when a queued write eventually runs. Each
    // atomic file therefore represents one real ordering of active-job states.
    const snapshot: ArchiveJobSnapshot = {
      activeJobs: [...this.#jobs.values()]
        .filter((job) => job.state === "building" && job.id !== completedJobId)
        .map((job) => ({
          id: job.id,
          startedAt: this.#jobStartedAt.get(job.id) ?? new Date().toISOString(),
          state: "building",
        })),
      instanceId: this.#instanceId,
      bootId: null,
      pid: process.pid,
      processStartTimeTicks: null,
      updatedAt: new Date().toISOString(),
      version: ARCHIVE_JOB_SNAPSHOT_VERSION,
    };
    const path = join(this.#directory, ARCHIVE_JOB_SNAPSHOT_FILENAME);
    const write = this.#snapshotWrites
      .catch(() => undefined)
      .then(async () => {
        if (process.platform === "linux") {
          const identity = await linuxProcessIdentity(process.pid);
          if (identity.status !== "available") {
            throw new Error("Cannot verify the archive process identity");
          }
          snapshot.bootId = identity.bootId;
          snapshot.processStartTimeTicks = identity.processStartTimeTicks;
        }
        return writePrivateJsonAtomically(
          path,
          snapshot,
          this.#temporarySnapshotPaths,
        );
      });
    this.#snapshotWrites = write;
    return write;
  }
}
