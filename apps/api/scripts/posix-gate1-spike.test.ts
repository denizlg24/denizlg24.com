import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SPIKE_SCRIPT = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-gate1-spike.sh",
);
const temporaryRoots: string[] = [];

interface ScriptResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

async function runSpike(
  args: readonly string[],
  stateRoot?: string,
): Promise<ScriptResult> {
  const child = Bun.spawn(["/bin/bash", SPIKE_SCRIPT, ...args], {
    env: {
      ...process.env,
      ...(stateRoot === undefined ? {} : { POSIX_GATE1_ROOT: stateRoot }),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  return { exitCode, stderr: await stderr, stdout: await stdout };
}

async function disposableStateRoot(): Promise<{
  parent: string;
  root: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "gate1-spike-script-test-"));
  temporaryRoots.push(parent);
  return { parent, root: join(parent, "posix-gate1-test") };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("POSIX Gate 1 spike shell safety", () => {
  it("defaults to dry-run and does not create the requested state root", async () => {
    const { root } = await disposableStateRoot();

    const result = await runSpike(["prepare"], root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: "prepare",
      mode: "--dry-run",
      root,
      willMountProductionBranches: false,
    });
    expect(await Bun.file(root).exists()).toBe(false);
  });

  it("rejects conflicting modes and actions before doing any work", async () => {
    const { root } = await disposableStateRoot();
    const conflictingModes = await runSpike(
      ["--dry-run", "--execute", "status"],
      root,
    );
    const conflictingActions = await runSpike(
      ["--dry-run", "prepare", "destroy"],
      root,
    );

    for (const result of [conflictingModes, conflictingActions]) {
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage:");
    }
    expect(await Bun.file(root).exists()).toBe(false);
  });

  it("rejects descendants of current and future production roots", async () => {
    const protectedDescendants = [
      "/data/ssd/posix-gate1-test",
      "/mnt/hdd/storage/posix-gate1-test",
      "/mnt/ssd/deniz-cloud/namespace/posix-gate1-test",
      "/srv/deniz-cloud/namespace/posix-gate1-test",
    ];

    for (const root of protectedDescendants) {
      const result = await runSpike(["--dry-run", "prepare"], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("overlaps a protected production path");
    }
  });

  it("rejects ancestors and exact roots that could contain production", async () => {
    const protectedAncestorsOrExactRoots = [
      "/data",
      "/mnt/ssd",
      "/srv/deniz-cloud",
      "/opt/deniz-cloud",
    ];

    for (const root of protectedAncestorsOrExactRoots) {
      const result = await runSpike(["--dry-run", "prepare"], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(
        /specifically named absolute path|overlaps a protected production path/,
      );
    }
  });

  it("requires a normalized absolute state path", async () => {
    const invalidRoots = [
      "relative/posix-gate1-test",
      "/tmp//posix-gate1-test",
      "/tmp/./posix-gate1-test",
      "/tmp/child/../posix-gate1-test",
    ];

    for (const root of invalidRoots) {
      const result = await runSpike(["--dry-run", "status"], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("must be a normalized absolute path");
    }
  });

  it("never represents a dry-run host test as a Gate 1 pass", async () => {
    const { root } = await disposableStateRoot();

    const result = await runSpike(["--dry-run", "host-test"], root);

    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({
      action: "host-test",
      mode: "--dry-run",
      willMountProductionBranches: false,
    });
    expect(summary).not.toHaveProperty("allGreen", true);
    expect(summary).not.toHaveProperty("gate1Passed", true);
    expect(summary).not.toHaveProperty("hostTestsPassed", true);
  });
});
