import type {
  StorageTier,
  TieringMove,
  TieringReason,
  TieringReport,
} from "@repo/schemas/cloud";
import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../db";
import { files } from "../db/schema";
import {
  computeChecksum,
  copyAndVerify,
  deletePath,
  directoryHasEntries,
  getDiskStats,
  pathExists,
} from "./fs";
import { resolveHddDiskPath, resolveSsdDiskPath } from "./path";

export interface TieringFile {
  id: string;
  filename: string;
  path: string;
  diskPath: string;
  tier: StorageTier;
  checksum: string;
  sizeBytes: number;
  lastAccessedAt: Date;
}

export interface TieringRepository {
  listFiles(): Promise<TieringFile[]>;
  findFile(id: string): Promise<TieringFile | null>;
  swapLocation(
    id: string,
    currentDiskPath: string,
    tier: StorageTier,
    diskPath: string,
  ): Promise<boolean>;
  deleteFile(id: string, currentDiskPath: string): Promise<boolean>;
}

export interface TieringOptions {
  ssdStoragePath: string;
  hddStoragePath: string;
  highWatermarkPercent: number;
  targetWatermarkPercent: number;
  minAgeMs: number;
  minSizeBytes: number;
  batchCap: number;
  dryRun?: boolean;
  now?: Date;
  diskStats?: typeof getDiskStats;
  afterCopy?: (file: TieringFile, destination: string) => Promise<void>;
  /** Runs after an orphaned row is reaped, to drop it from the search index. */
  afterReap?: (file: TieringFile) => Promise<void>;
}

export class TieringCrashSimulationError extends Error {
  constructor() {
    super("Simulated crash after verified copy");
    this.name = "TieringCrashSimulationError";
  }
}

export function createTieringRepository(db: Database): TieringRepository {
  const selection = {
    id: files.id,
    filename: files.filename,
    path: files.path,
    diskPath: files.diskPath,
    tier: files.tier,
    checksum: files.checksum,
    sizeBytes: files.sizeBytes,
    lastAccessedAt: files.lastAccessedAt,
  };
  return {
    async listFiles() {
      return db
        .select(selection)
        .from(files)
        .orderBy(asc(files.lastAccessedAt));
    },
    async findFile(id) {
      const [file] = await db
        .select(selection)
        .from(files)
        .where(eq(files.id, id))
        .limit(1);
      return file ?? null;
    },
    async swapLocation(id, currentDiskPath, tier, diskPath) {
      const updated = await db
        .update(files)
        .set({
          tier,
          diskPath,
          updatedAt: new Date(),
        })
        .where(and(eq(files.id, id), eq(files.diskPath, currentDiskPath)))
        .returning({ id: files.id });
      return updated.length === 1;
    },
    async deleteFile(id, currentDiskPath) {
      const deleted = await db
        .delete(files)
        .where(and(eq(files.id, id), eq(files.diskPath, currentDiskPath)))
        .returning({ id: files.id });
      return deleted.length === 1;
    },
  };
}

function destinationFor(
  file: TieringFile,
  tier: StorageTier,
  options: Pick<TieringOptions, "ssdStoragePath" | "hddStoragePath">,
): string {
  return tier === "ssd"
    ? resolveSsdDiskPath(options.ssdStoragePath, file.path)
    : resolveHddDiskPath(options.hddStoragePath, file.id);
}

async function moveAtomically(
  repository: TieringRepository,
  file: TieringFile,
  targetTier: StorageTier,
  options: TieringOptions,
): Promise<void> {
  const destination = destinationFor(file, targetTier, options);
  await copyAndVerify(file.diskPath, destination, file.checksum);
  await options.afterCopy?.(file, destination);
  const swapped = await repository.swapLocation(
    file.id,
    file.diskPath,
    targetTier,
    destination,
  );
  if (!swapped) {
    throw new Error("File metadata changed during tiering move");
  }
  await deletePath(file.diskPath);
}

function isMissingSourceError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function rootFor(
  tier: StorageTier,
  options: Pick<TieringOptions, "ssdStoragePath" | "hddStoragePath">,
): string {
  return tier === "ssd" ? options.ssdStoragePath : options.hddStoragePath;
}

/**
 * What a pass should conclude when the blob it was about to move is not on
 * disk. Only `orphaned` is destructive, and it is the one outcome that
 * requires positive evidence — that the storage root is mounted and the blob
 * is absent from both tiers — rather than merely the absence of the source.
 */
type MissingSource =
  | { kind: "vanished" }
  | { kind: "relocated"; diskPath: string }
  | { kind: "orphaned"; file: TieringFile }
  | { kind: "unmounted"; root: string };

async function resolveMissingSource(
  repository: TieringRepository,
  file: TieringFile,
  targetTier: StorageTier,
  options: TieringOptions,
): Promise<MissingSource> {
  const current = await repository.findFile(file.id);
  // Deleted, renamed or moved by another writer since listFiles() snapshotted
  // the batch. Whatever the row says now is authoritative, not our copy of it.
  if (!current || current.diskPath !== file.diskPath) {
    return { kind: "vanished" };
  }

  // A pass that died between copyAndVerify and swapLocation leaves a complete
  // blob at the destination with the row still pointing at the source it then
  // never deleted. Adopting it finishes that move.
  const destination = destinationFor(current, targetTier, options);
  if (await pathExists(destination)) {
    if ((await computeChecksum(destination)) === current.checksum) {
      return { kind: "relocated", diskPath: destination };
    }
    // Torn copy from a pass that died mid-write. It is not the file.
    await deletePath(destination);
  }

  const root = rootFor(current.tier, options);
  return (await directoryHasEntries(root))
    ? { kind: "orphaned", file: current }
    : { kind: "unmounted", root };
}

async function reconcileCopies(
  repository: TieringRepository,
  allFiles: TieringFile[],
  options: TieringOptions,
): Promise<number> {
  let reconciled = 0;
  for (const listedFile of allFiles) {
    const file = await repository.findFile(listedFile.id);
    if (!file) continue;
    const alternateTier: StorageTier = file.tier === "ssd" ? "hdd" : "ssd";
    const alternate = destinationFor(file, alternateTier, options);
    if (
      alternate !== file.diskPath &&
      (await pathExists(file.diskPath)) &&
      (await pathExists(alternate))
    ) {
      reconciled += 1;
      if (!options.dryRun) {
        await deletePath(alternate);
      }
    }
  }
  return reconciled;
}

function demotionReason(
  file: TieringFile,
  now: Date,
  options: TieringOptions,
): TieringReason | null {
  if (file.sizeBytes >= options.minSizeBytes) {
    return "large";
  }
  if (now.getTime() - file.lastAccessedAt.getTime() >= options.minAgeMs) {
    return "cold";
  }
  return null;
}

export async function runTieringPass(
  repository: TieringRepository,
  options: TieringOptions,
): Promise<TieringReport> {
  const now = options.now ?? new Date();
  const allFiles = await repository.listFiles();
  const diskStats = await (options.diskStats ?? getDiskStats)(
    options.ssdStoragePath,
  );
  const candidates = allFiles.filter((file) => file.tier === "ssd");
  const planned = new Map<string, TieringReason>();
  for (const file of candidates) {
    const reason = demotionReason(file, now, options);
    if (reason) planned.set(file.id, reason);
  }

  let predictedUsedBytes = diskStats.usedBytes;
  for (const file of candidates) {
    if (planned.has(file.id)) {
      predictedUsedBytes = Math.max(0, predictedUsedBytes - file.sizeBytes);
    }
  }
  if (diskStats.usagePercent > options.highWatermarkPercent) {
    for (const file of candidates) {
      const predictedPercent =
        diskStats.totalBytes === 0
          ? 0
          : (predictedUsedBytes / diskStats.totalBytes) * 100;
      if (predictedPercent <= options.targetWatermarkPercent) break;
      if (!planned.has(file.id)) {
        planned.set(file.id, "watermark");
        predictedUsedBytes = Math.max(0, predictedUsedBytes - file.sizeBytes);
      }
    }
  }

  const selected = candidates
    .filter((file) => planned.has(file.id))
    .slice(0, options.batchCap);
  const moved: TieringMove[] = [];
  const failures: TieringReport["failures"] = [];
  const orphaned: TieringReport["orphaned"] = [];
  let movedBytes = 0;
  let vanished = 0;
  let healed = 0;
  for (const file of selected) {
    const reason = planned.get(file.id);
    if (!reason) continue;
    const move: TieringMove = {
      fileId: file.id,
      filename: file.filename,
      from: "ssd",
      to: "hdd",
      reason,
      sizeBytes: file.sizeBytes,
    };
    if (options.dryRun) {
      moved.push(move);
      movedBytes += file.sizeBytes;
      continue;
    }
    try {
      await moveAtomically(repository, file, "hdd", options);
      moved.push(move);
      movedBytes += file.sizeBytes;
    } catch (error) {
      if (error instanceof TieringCrashSimulationError) {
        throw error;
      }
      if (!isMissingSourceError(error)) {
        failures.push({
          fileId: file.id,
          message:
            error instanceof Error ? error.message : "Tiering move failed",
        });
        continue;
      }
      const resolution = await resolveMissingSource(
        repository,
        file,
        "hdd",
        options,
      );
      switch (resolution.kind) {
        case "vanished":
          vanished += 1;
          break;
        case "relocated":
          if (
            await repository.swapLocation(
              file.id,
              file.diskPath,
              "hdd",
              resolution.diskPath,
            )
          ) {
            healed += 1;
            movedBytes += file.sizeBytes;
          } else {
            vanished += 1;
          }
          break;
        case "orphaned":
          if (await repository.deleteFile(file.id, file.diskPath)) {
            await options.afterReap?.(resolution.file);
            orphaned.push({
              fileId: resolution.file.id,
              filename: resolution.file.filename,
              path: resolution.file.path,
              sizeBytes: resolution.file.sizeBytes,
            });
          } else {
            vanished += 1;
          }
          break;
        case "unmounted":
          failures.push({
            fileId: file.id,
            message: `Source missing and ${resolution.root} is empty; refusing to treat this as data loss`,
          });
          break;
      }
    }
  }

  const reconciledCopies = await reconcileCopies(repository, allFiles, options);
  const finalUsedBytes = Math.max(0, diskStats.usedBytes - movedBytes);
  return {
    dryRun: options.dryRun === true,
    initialSsdUsagePercent: diskStats.usagePercent,
    finalSsdUsagePercent:
      diskStats.totalBytes === 0
        ? 0
        : (finalUsedBytes / diskStats.totalBytes) * 100,
    considered: candidates.length,
    moved,
    reconciledCopies,
    vanished,
    healed,
    orphaned,
    failures,
  };
}

export async function promoteFile(
  repository: TieringRepository,
  fileId: string,
  options: Pick<
    TieringOptions,
    "ssdStoragePath" | "hddStoragePath" | "afterCopy"
  >,
): Promise<boolean> {
  const file = await repository.findFile(fileId);
  if (file?.tier !== "hdd") {
    return false;
  }
  await moveAtomically(repository, file, "ssd", {
    ...options,
    highWatermarkPercent: 100,
    targetWatermarkPercent: 100,
    minAgeMs: Number.MAX_SAFE_INTEGER,
    minSizeBytes: Number.MAX_SAFE_INTEGER,
    batchCap: 1,
  });
  return true;
}

export class PromotionQueue {
  readonly #pending = new Set<string>();
  #running: Promise<void> | null = null;

  constructor(
    private readonly repository: TieringRepository,
    private readonly options: Pick<
      TieringOptions,
      "ssdStoragePath" | "hddStoragePath"
    >,
  ) {}

  enqueue(fileId: string): void {
    this.#pending.add(fileId);
    if (!this.#running) {
      this.#running = this.#drain().finally(() => {
        this.#running = null;
        if (this.#pending.size > 0) this.enqueueNext();
      });
    }
  }

  private enqueueNext(): void {
    const next = this.#pending.values().next().value;
    if (typeof next === "string") this.enqueue(next);
  }

  async #drain(): Promise<void> {
    while (this.#pending.size > 0) {
      const fileId = this.#pending.values().next().value;
      if (typeof fileId !== "string") return;
      this.#pending.delete(fileId);
      try {
        await promoteFile(this.repository, fileId, this.options);
      } catch (error) {
        console.error("Storage file promotion failed", {
          fileId,
          error,
        });
      }
    }
  }

  async waitForIdle(): Promise<void> {
    await this.#running;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }
}
