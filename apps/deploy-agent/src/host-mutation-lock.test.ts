import { describe, expect, it } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

  /**
   * A leaked lock used to be absorbing. Nothing on the host reclaimed it, so
   * every deployment and the garbage collector queued behind it for the full
   * hour `timeoutMs` allows and then failed, and recovery meant someone
   * noticing and removing a directory by hand. This is what happens when an
   * agent is killed mid-operation.
   */
  it("breaks a lock whose recorded holder is gone", async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "forge.lock");
      await mkdir(path);
      await writeFile(`${path}/pid`, "999999\n");
      await writeFile(`${path}/owner`, "deployment:dead\n");

      const lock = new HostMutationLock(path, {
        pollMs: 1,
        isProcessAlive: () => false,
      });
      const release = await lock.acquire(
        "deployment:22222222-2222-4222-8222-222222222222",
        new AbortController().signal,
      );

      expect((await readFile(`${path}/owner`, "utf8")).trim()).toBe(
        "deployment:22222222-2222-4222-8222-222222222222",
      );
      await release();
      expect(await exists(path)).toBe(false);
    });
  });

  /**
   * The narrowness is the point: breaking on age instead cannot tell a hung
   * operation from a slow one, and two operations mutating the host at once is
   * worse than a stall.
   */
  it("waits rather than breaking a lock whose holder is alive", async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "forge.lock");
      await mkdir(path);
      await writeFile(`${path}/pid`, `${process.pid}\n`);
      await writeFile(`${path}/owner`, "deployment:live\n");

      const lock = new HostMutationLock(path, {
        pollMs: 1,
        timeoutMs: 30,
        isProcessAlive: () => true,
      });

      await expect(
        lock.acquire(
          "deployment:33333333-3333-4333-8333-333333333333",
          new AbortController().signal,
        ),
      ).rejects.toThrow("timed out waiting for host mutation lock");
      expect((await readFile(`${path}/owner`, "utf8")).trim()).toBe(
        "deployment:live",
      );
    });
  });

  /**
   * A lock is a directory before it is a pid file. Breaking one that has simply
   * not published yet would race a healthy acquisition, so that case waits out
   * a grace period first.
   */
  it("does not break a lock that has not published its pid yet", async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "forge.lock");
      await mkdir(path);

      const lock = new HostMutationLock(path, {
        pollMs: 1,
        timeoutMs: 30,
        staleGraceMs: 60_000,
        isProcessAlive: () => false,
      });

      await expect(
        lock.acquire(
          "deployment:44444444-4444-4444-8444-444444444444",
          new AbortController().signal,
        ),
      ).rejects.toThrow("timed out waiting for host mutation lock");
      expect(await exists(path)).toBe(true);
    });
  });
});
