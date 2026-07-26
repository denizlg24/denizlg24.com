import { createHash } from "node:crypto";
import { copyFile, mkdir, open, rm, stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Returns true only when this call actually created the directory. Callers that
 * roll back on failure need that distinction: removing a directory that already
 * existed would take another request's files with it.
 */
export async function ensureDir(path: string): Promise<boolean> {
  return (await mkdir(path, { recursive: true })) !== undefined;
}

export async function deletePath(
  path: string,
  recursive = false,
): Promise<void> {
  await rm(path, { force: true, recursive });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const CHECKSUM_CHUNK_BYTES = 1024 * 1024;

/**
 * Reads through a descriptor into one reused buffer. `Bun.file().stream()`
 * accumulates the whole file in memory — 680 MB of unreclaimable RSS on a
 * 629 MB source — which is fatal here: this runs over multi-gigabyte files
 * during upload completion and tiering moves.
 */
export async function computeChecksum(path: string): Promise<string> {
  const hasher = createHash("sha256");
  const file = await open(path, "r");
  const buffer = Buffer.allocUnsafe(CHECKSUM_CHUNK_BYTES);
  try {
    for (;;) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        CHECKSUM_CHUNK_BYTES,
        null,
      );
      if (bytesRead === 0) break;
      hasher.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return hasher.digest("hex");
}

export async function fsyncFile(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    try {
      await file.sync();
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EPERM" && error.code !== "EINVAL")
      ) {
        throw error;
      }
    }
  } finally {
    await file.close();
  }
}

export async function copyAndVerify(
  source: string,
  destination: string,
  expectedChecksum: string,
): Promise<void> {
  await ensureDir(dirname(destination));
  await copyFile(source, destination);
  await fsyncFile(destination);
  const copiedChecksum = await computeChecksum(destination);
  if (copiedChecksum !== expectedChecksum) {
    await deletePath(destination);
    throw new Error("Checksum mismatch after file copy");
  }
}

export async function getDiskStats(path: string): Promise<{
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}> {
  const stats = await statfs(path);
  const totalBytes = stats.blocks * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usagePercent: totalBytes === 0 ? 0 : (usedBytes / totalBytes) * 100,
  };
}
