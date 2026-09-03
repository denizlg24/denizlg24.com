import { describe, expect, it } from "bun:test";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { withTempDir } from "./fixtures";
import { HostMutationLock } from "./host-mutation-lock";

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

describe("HostMutationLock", () => {
  it("publishes ownership atomically and releases after success", async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "forge.lock");
      const lock = new HostMutationLock(path);
      const result = await lock.run(
        "deployment:11111111-1111-4111-8111-111111111111",
        new AbortController().signal,
        async () => {
          expect((await readFile(`${path}/pid`, "utf8")).trim()).toBe(
            String(process.pid),
          );
          expect((await readFile(`${path}/owner`, "utf8")).trim()).toContain(
            "deployment:",
          );
          return "done";
        },
      );
      expect(result).toBe("done");
      expect(await exists(path)).toBe(false);
    });
  });

  it("releases after an operation fails and times out behind another owner", async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "forge.lock");
      const lock = new HostMutationLock(path);
      await expect(
        lock.run("deployment:test", new AbortController().signal, async () => {
          throw new Error("failed mutation");
        }),
      ).rejects.toThrow("failed mutation");
      expect(await exists(path)).toBe(false);

      await mkdir(path);
      const blocked = new HostMutationLock(path, { timeoutMs: 5, pollMs: 1 });
      await expect(
        blocked.acquire("deployment:blocked", new AbortController().signal),
      ).rejects.toThrow(/timed out/);
    });
  });

  it("rejects paths and owners that could escape the lock contract", async () => {
    expect(() => new HostMutationLock("relative.lock")).toThrow(/absolute/);
    expect(() => new HostMutationLock("/tmp/../forge.lock")).toThrow(
      /normalized/,
    );
    const lock = new HostMutationLock("/tmp/forge.lock");
    await expect(
      lock.acquire("unsafe owner", new AbortController().signal),
    ).rejects.toThrow(/owner/);
  });
});
