import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
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

/**
 * Tracks archives being built on disk. Deliberately in-memory: a restart drops
 * the registry, the startup sweep removes the orphaned files, and the client
 * sees the poll 404 and reports the build as lost. Persisting half-written
 * archives across a deploy would buy nothing.
 */
export class ArchiveJobStore {
  readonly #jobs = new Map<string, ArchiveJob>();
  readonly #directory: string;
  readonly #ttlMs: number;
  readonly #sweepIntervalMs: number;
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

  start(input: {
    ownerKey: string;
    filename: string;
    totalBytes: number;
    entries: readonly ArchiveEntry[];
  }): ArchiveJob {
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
    void this.#build(job, input.entries);
    return job;
  }

  async discard(job: ArchiveJob): Promise<void> {
    this.#jobs.delete(job.id);
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
      if (tracked.has(path)) continue;
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
    try {
      await ensureDir(this.#directory);
      const written = await writeArchive(entries, job.diskPath, (bytes) => {
        job.writtenBytes = bytes;
      });
      job.writtenBytes = written;
      job.totalBytes = written;
      job.state = "ready";
    } catch (error) {
      // Cleanup first: a job that reports "failed" must not still have a
      // half-written archive on disk for a poller to race against.
      await deletePath(job.diskPath).catch(() => undefined);
      job.error =
        error instanceof Error ? error.message : "Archive build failed";
      job.state = "failed";
    } finally {
      job.expiresAt = Date.now() + this.#ttlMs;
    }
  }
}
