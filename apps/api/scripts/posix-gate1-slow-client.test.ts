import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  parseSlowClientArguments,
  runSlowClientProbe,
} from "./posix-gate1-slow-client";

const roots: string[] = [];

async function disposableRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "gate1-slow-test-"));
  roots.push(parent);
  const root = join(parent, "posix-gate1-disposable-slow");
  await mkdir(root);
  await writeFile(
    join(root, ".posix-gate1-disposable"),
    "deniz-cloud-posix-gate1\n",
  );
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe("POSIX Gate 1 slow-client probe", () => {
  it("is dry-run by default and validates CLI options", () => {
    expect(
      parseSlowClientArguments(["--root", "/tmp/posix-gate1-disposable-slow"]),
    ).toEqual({
      dryRun: true,
      logPath: undefined,
      root: "/tmp/posix-gate1-disposable-slow",
    });
    expect(() => parseSlowClientArguments([])).toThrow("--root is required");
    expect(() =>
      parseSlowClientArguments([
        "--root",
        "/tmp/posix-gate1-disposable-slow",
        "--execute",
        "--dry-run",
      ]),
    ).toThrow("Choose either");
  });

  it("does not mutate the root during dry-run", async () => {
    const root = await disposableRoot();
    const before = await readdir(root);
    const result = await runSlowClientProbe({ dryRun: true, root });
    expect(result.allGreen).toBe(false);
    expect(await readdir(root)).toEqual(before);
  });

  it("streams a sparse large-file shape with bounded RSS and cleans up", async () => {
    const root = await disposableRoot();
    const logPath = join(dirname(root), "slow-evidence.jsonl");
    const result = await runSlowClientProbe({
      dryRun: false,
      logPath,
      logicalBytes: 8 * 1024 * 1024,
      // Bun may execute unrelated test files in this same process. The Pi CLI
      // keeps the real acceptance limit at 128 MiB; this unit check verifies
      // backpressure mechanics without attributing concurrent-suite RSS.
      maxRssDeltaBytes: 512 * 1024 * 1024,
      readDelayMs: 1,
      root,
      sampleBytes: 512 * 1024,
    });
    expect(result.allGreen).toBe(true);
    expect(result.receivedBytes).toBeGreaterThanOrEqual(512 * 1024);
    expect(result.rssDeltaBytes).toBeLessThanOrEqual(512 * 1024 * 1024);
    expect(await readdir(root)).toEqual([".posix-gate1-disposable"]);
    expect(JSON.parse(await readFile(logPath, "utf8")).allGreen).toBe(true);
    expect((await stat(logPath)).mode & 0o777).toBe(0o600);
  });

  it("keeps evidence outside the namespace and enforces bounds", async () => {
    const root = await disposableRoot();
    await expect(
      runSlowClientProbe({
        dryRun: true,
        logPath: join(root, "evidence.jsonl"),
        root,
      }),
    ).rejects.toThrow("outside");
    await expect(
      runSlowClientProbe({
        dryRun: true,
        logicalBytes: 1,
        root,
        sampleBytes: 2,
      }),
    ).rejects.toThrow("bounds");
  });
});
