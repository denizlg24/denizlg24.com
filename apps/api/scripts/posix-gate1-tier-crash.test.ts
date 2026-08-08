import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { POSIX_GATE1_SUPPORTED } from "./posix-gate1-platform";

const SCRIPT = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-gate1-tier-crash.sh",
);
const parents: string[] = [];

async function invoke(args: string[], root: string) {
  const child = Bun.spawn(["/bin/bash", SCRIPT, ...args], {
    env: { ...process.env, POSIX_GATE1_ROOT: root },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

afterEach(async () => {
  await Promise.all(
    parents.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe.skipIf(!POSIX_GATE1_SUPPORTED)(
  "POSIX Gate 1 tier-crash probe safety",
  () => {
    it("is a non-mutating dry run with honest partial coverage", async () => {
      const parent = await mkdtemp(join(tmpdir(), "tier-crash-test-"));
      parents.push(parent);
      const root = join(parent, "posix-gate1-test");

      const result = await invoke([], root);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        gate1Passed: false,
        mode: "--dry-run",
        productionBranchesMounted: false,
        root,
        writes: false,
      });
      expect(await Bun.file(root).exists()).toBe(false);
    });

    it("rejects conflicting arguments and protected roots", async () => {
      const parent = await mkdtemp(join(tmpdir(), "tier-crash-test-"));
      parents.push(parent);
      const root = join(parent, "posix-gate1-test");
      const conflicting = await invoke(["--dry-run", "--execute"], root);
      const protectedResult = await invoke(
        ["--dry-run"],
        "/mnt/ssd/deniz-cloud/namespace/posix-gate1-test",
      );

      expect(conflicting.exitCode).toBe(2);
      expect(conflicting.stderr).toContain("Usage:");
      expect(protectedResult.exitCode).toBe(1);
      expect(protectedResult.stderr).toContain("protected production path");
      expect(await Bun.file(root).exists()).toBe(false);
    });
  },
);
