import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const OUTPUT_TAIL_LENGTH = 16_000;

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function backupTimestamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export function outputTail(value: string): string {
  return value.slice(-OUTPUT_TAIL_LENGTH);
}

export async function runProcess(
  command: readonly string[],
  timeoutMs = 30 * 60 * 1_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const processHandle = Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => processHandle.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]);
    return {
      stdout: outputTail(stdout),
      stderr: outputTail(stderr),
      exitCode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function enforceRetention(
  directory: string,
  maxCount: number,
): Promise<string[]> {
  const parent = resolve(directory);
  let names: string[];
  try {
    names = await readdir(parent);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      const path = resolve(join(parent, name));
      if (!path.startsWith(`${parent}${sep}`)) {
        throw new Error("Retention candidate escaped its backup directory");
      }
      const metadata = await stat(path);
      return { name, path, modifiedAt: metadata.mtimeMs };
    }),
  );
  entries.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const deleted: string[] = [];
  for (const entry of entries.slice(maxCount)) {
    await rm(entry.path, { recursive: true, force: true });
    deleted.push(entry.name);
  }
  return deleted;
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
