import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { thumbnailKindFor } from "@repo/schemas/cloud";

import {
  posterSeekSeconds,
  type SpawnResult,
  ThumbnailBusyError,
  ThumbnailService,
  type ThumbnailSource,
} from "./thumbnails";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "thumbs-"));
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

function source(overrides: Partial<ThumbnailSource> = {}): ThumbnailSource {
  return {
    diskPath: "/data/storage/users/u/photo.heic",
    id: "0f5c2d4e-1111-4222-8333-444455556666",
    kind: "image",
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 1234,
    ...overrides,
  };
}

/** Writes the output the real command would, so the rename path is exercised. */
function fakeSpawn(behaviour: { exitCode?: number; delayMs?: number } = {}) {
  const calls: string[][] = [];
  const spawn = async (command: string[]): Promise<SpawnResult> => {
    calls.push(command);
    if (behaviour.delayMs) await Bun.sleep(behaviour.delayMs);
    const exitCode = behaviour.exitCode ?? 0;
    if (exitCode === 0) {
      const output = command[command.length - 1] ?? "";
      await writeFile(output.replace(/\[.*\]$/, ""), "webp");
    }
    return { exitCode, stderr: exitCode === 0 ? "" : "decode failed" };
  };
  return { calls, spawn };
}

describe("thumbnailKindFor", () => {
  it("classifies on the extension first and the stored type second", () => {
    expect(
      thumbnailKindFor({ filename: "IMG_0001.HEIC", mimeType: null }),
    ).toBe("image");
    expect(
      thumbnailKindFor({
        filename: "clip.mov",
        mimeType: "application/octet-stream",
      }),
    ).toBe("video");
    expect(thumbnailKindFor({ filename: "paper.pdf", mimeType: null })).toBe(
      "pdf",
    );
    expect(thumbnailKindFor({ filename: "noext", mimeType: "image/png" })).toBe(
      "image",
    );
    expect(
      thumbnailKindFor({ filename: "notes.txt", mimeType: null }),
    ).toBeNull();
  });

  it("refuses oversized images and PDFs but not videos", () => {
    expect(
      thumbnailKindFor({ filename: "a.jpg", sizeBytes: 61 * 1024 * 1024 }),
    ).toBeNull();
    expect(
      thumbnailKindFor({ filename: "a.pdf", sizeBytes: 51 * 1024 * 1024 }),
    ).toBeNull();
    expect(
      thumbnailKindFor({ filename: "a.mp4", sizeBytes: 5 * 1024 ** 3 }),
    ).toBe("video");
  });
});

describe("ThumbnailService", () => {
  it("generates once, caches by fingerprint, and reads back without spawning", async () => {
    const { calls, spawn } = fakeSpawn();
    const service = new ThumbnailService({ cacheRoot: root, spawn });
    await service.initialize();
    const first = await service.get(source(), 256);
    expect(first).toBe(service.cachePath(source(), 256));
    expect(first?.endsWith("-1234-1700000000000.webp")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 4)).toEqual([
      "nice",
      "-n",
      "10",
      "vipsthumbnail",
    ]);
    expect(await service.get(source(), 256)).toBe(first);
    expect(calls).toHaveLength(1);
    expect(await service.exists(source(), 256)).toBe(true);
    expect(await service.exists(source(), 512)).toBe(false);
  });

  it("coalesces concurrent requests for the same key into one process", async () => {
    const { calls, spawn } = fakeSpawn({ delayMs: 20 });
    const service = new ThumbnailService({ cacheRoot: root, spawn });
    const results = await Promise.all(
      Array.from({ length: 40 }, () => service.get(source(), 256)),
    );
    expect(new Set(results).size).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("unlinks the stale sibling when a file is rewritten", async () => {
    const { spawn } = fakeSpawn();
    const service = new ThumbnailService({ cacheRoot: root, spawn });
    const old = await service.get(source(), 256);
    const fresh = await service.get(
      source({ mtimeMs: 1_700_000_005_000, sizeBytes: 2000 }),
      256,
    );
    expect(old).not.toBe(fresh);
    await expect(stat(old ?? "")).rejects.toThrow();
    const shard = await readdir(join(root, "256", "0f"));
    expect(shard).toHaveLength(1);
  });

  it("remembers a failure so a broken file is not respawned per tile", async () => {
    const { calls, spawn } = fakeSpawn({ exitCode: 1 });
    const service = new ThumbnailService({ cacheRoot: root, spawn });
    expect(await service.get(source(), 256)).toBeNull();
    expect(await service.get(source(), 256)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("answers busy when more are waiting than the queue allows", async () => {
    const { spawn } = fakeSpawn({ delayMs: 30 });
    const service = new ThumbnailService({
      cacheRoot: root,
      concurrency: 1,
      maxQueued: 1,
      spawn,
    });
    const a = service.get(
      source({ id: "aaaaaaaa-1111-4222-8333-444455556666" }),
      256,
    );
    const b = service.get(
      source({ id: "bbbbbbbb-1111-4222-8333-444455556666" }),
      256,
    );
    await Bun.sleep(5);
    await expect(
      service.get(source({ id: "cccccccc-1111-4222-8333-444455556666" }), 256),
    ).rejects.toBeInstanceOf(ThumbnailBusyError);
    await Promise.all([a, b]);
  });

  it("garbage-collects entries whose row is gone", async () => {
    const { spawn } = fakeSpawn();
    const service = new ThumbnailService({ cacheRoot: root, spawn });
    const live = source({ id: "11111111-1111-4222-8333-444455556666" });
    const dead = source({ id: "22222222-1111-4222-8333-444455556666" });
    await service.get(live, 256);
    await service.get(dead, 512);
    const report = await service.gc(
      async (ids) => new Set(ids.filter((id) => id === live.id)),
    );
    expect(report).toEqual({ removed: 1, scanned: 2 });
    expect(await service.exists(live, 256)).toBe(true);
    expect(await service.exists(dead, 512)).toBe(false);
  });
});

describe("posterSeekSeconds", () => {
  it("seeks to 10 % or one second, whichever is earlier", () => {
    expect(posterSeekSeconds(null)).toBe(0);
    expect(posterSeekSeconds(0)).toBe(0);
    expect(posterSeekSeconds(4)).toBeCloseTo(0.4);
    expect(posterSeekSeconds(120)).toBe(1);
  });
});
