import { createHash } from "node:crypto";
import { copyFile, mkdir, open, rm, stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
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

export async function computeChecksum(path: string): Promise<string> {
  const hasher = createHash("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
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
