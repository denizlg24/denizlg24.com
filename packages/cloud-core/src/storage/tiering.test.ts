import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeChecksum, pathExists } from "./fs";
import { resolveHddDiskPath, resolveSsdDiskPath } from "./path";
import {
  PromotionQueue,
  runTieringPass,
  TieringCrashSimulationError,
  type TieringFile,
  type TieringRepository,
} from "./tiering";

class MemoryTieringRepository implements TieringRepository {
  readonly files = new Map<string, TieringFile>();

  async listFiles(): Promise<TieringFile[]> {
    return [...this.files.values()].sort(
      (left, right) =>
        left.lastAccessedAt.getTime() - right.lastAccessedAt.getTime(),
    );
  }

  async findFile(id: string): Promise<TieringFile | null> {
    return this.files.get(id) ?? null;
  }

  async swapLocation(
    id: string,
    currentDiskPath: string,
    tier: "ssd" | "hdd",
    diskPath: string,
  ): Promise<boolean> {
    const file = this.files.get(id);
    if (!file || file.diskPath !== currentDiskPath) return false;
    this.files.set(id, { ...file, tier, diskPath });
    return true;
  }
}

const UUIDS = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
] as const;

describe("storage tiering", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function setup() {
    root = await mkdtemp(join(tmpdir(), "cloud-tiering-"));
    const ssd = join(root, "ssd");
    const hdd = join(root, "hdd");
    await Promise.all([
      Bun.write(join(ssd, ".keep"), ""),
      Bun.write(join(hdd, ".keep"), ""),
    ]);
    return { ssd, hdd, repository: new MemoryTieringRepository() };
  }

  async function addFile(
    repository: MemoryTieringRepository,
    storageRoot: string,
    values: {
      id: string;
      size: number;
      lastAccessedAt: Date;
      tier?: "ssd" | "hdd";
    },
  ) {
    const tier = values.tier ?? "ssd";
    const path = `/project/${values.id}.bin`;
    const diskPath =
      tier === "ssd"
        ? resolveSsdDiskPath(storageRoot, path)
        : resolveHddDiskPath(storageRoot, values.id);
    const bytes = new Uint8Array(values.size).fill(7);
    await Bun.write(diskPath, bytes);
    repository.files.set(values.id, {
      id: values.id,
      filename: `${values.id}.bin`,
      path,
      diskPath,
      tier,
      checksum: await computeChecksum(diskPath),
      sizeBytes: values.size,
      lastAccessedAt: values.lastAccessedAt,
    });
  }

  it("uses LRU watermark math and reports dry runs without mutation", async () => {
    const { ssd, hdd, repository } = await setup();
    await addFile(repository, ssd, {
      id: UUIDS[0],
      size: 250,
      lastAccessedAt: new Date("2025-01-01"),
    });
    await addFile(repository, ssd, {
      id: UUIDS[1],
      size: 100,
      lastAccessedAt: new Date("2025-02-01"),
    });
    const report = await runTieringPass(repository, {
      ssdStoragePath: ssd,
      hddStoragePath: hdd,
      highWatermarkPercent: 80,
      targetWatermarkPercent: 60,
      minAgeMs: Number.MAX_SAFE_INTEGER,
      minSizeBytes: Number.MAX_SAFE_INTEGER,
      batchCap: 10,
      dryRun: true,
      diskStats: async () => ({
        totalBytes: 1_000,
        usedBytes: 900,
        availableBytes: 100,
        usagePercent: 90,
      }),
    });
    expect(report.moved.map((move) => move.fileId)).toEqual([
      UUIDS[0],
      UUIDS[1],
    ]);
    expect(report.finalSsdUsagePercent).toBeCloseTo(55);
    expect(repository.files.get(UUIDS[0])?.tier).toBe("ssd");
    expect(await pathExists(resolveHddDiskPath(hdd, UUIDS[0]))).toBe(false);
  });

  it("leaves both verified copies on a simulated crash and reconciles next pass", async () => {
    const { ssd, hdd, repository } = await setup();
    await addFile(repository, ssd, {
      id: UUIDS[0],
      size: 8,
      lastAccessedAt: new Date("2020-01-01"),
    });
    const source = repository.files.get(UUIDS[0]);
    if (!source) throw new Error("Missing fixture");
    const destination = resolveHddDiskPath(hdd, UUIDS[0]);
    await expect(
      runTieringPass(repository, {
        ssdStoragePath: ssd,
        hddStoragePath: hdd,
        highWatermarkPercent: 80,
        targetWatermarkPercent: 70,
        minAgeMs: 1,
        minSizeBytes: Number.MAX_SAFE_INTEGER,
        batchCap: 1,
        now: new Date("2026-01-01"),
        diskStats: async () => ({
          totalBytes: 1_000,
          usedBytes: 100,
          availableBytes: 900,
          usagePercent: 10,
        }),
        afterCopy: async () => {
          throw new TieringCrashSimulationError();
        },
      }),
    ).rejects.toBeInstanceOf(TieringCrashSimulationError);
    expect(await pathExists(source.diskPath)).toBe(true);
    expect(await pathExists(destination)).toBe(true);
    expect(repository.files.get(UUIDS[0])?.tier).toBe("ssd");

    const reconciled = await runTieringPass(repository, {
      ssdStoragePath: ssd,
      hddStoragePath: hdd,
      highWatermarkPercent: 80,
      targetWatermarkPercent: 70,
      minAgeMs: Number.MAX_SAFE_INTEGER,
      minSizeBytes: Number.MAX_SAFE_INTEGER,
      batchCap: 1,
      diskStats: async () => ({
        totalBytes: 1_000,
        usedBytes: 100,
        availableBytes: 900,
        usagePercent: 10,
      }),
    });
    expect(reconciled.reconciledCopies).toBe(1);
    expect(await pathExists(source.diskPath)).toBe(true);
    expect(await pathExists(destination)).toBe(false);
  });

  it("queues non-blocking HDD promotion and atomically swaps metadata", async () => {
    const { ssd, hdd, repository } = await setup();
    await addFile(repository, hdd, {
      id: UUIDS[2],
      size: 16,
      lastAccessedAt: new Date(),
      tier: "hdd",
    });
    const oldPath = repository.files.get(UUIDS[2])?.diskPath;
    const queue = new PromotionQueue(repository, {
      ssdStoragePath: ssd,
      hddStoragePath: hdd,
    });
    queue.enqueue(UUIDS[2]);
    await queue.waitForIdle();
    const promoted = repository.files.get(UUIDS[2]);
    expect(promoted?.tier).toBe("ssd");
    expect(promoted?.diskPath).toBe(
      resolveSsdDiskPath(ssd, `/project/${UUIDS[2]}.bin`),
    );
    expect(await pathExists(promoted?.diskPath ?? "")).toBe(true);
    expect(await pathExists(oldPath ?? "")).toBe(false);
  });
});
