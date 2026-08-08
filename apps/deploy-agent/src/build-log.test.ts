import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { BuildLog, BuildLogNotFoundError, BuildLogStore } from "./build-log";
import { withTempDir } from "./fixtures";

async function collect(
  source: AsyncGenerator<string, void>,
  count: number,
): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of source) {
    lines.push(line);
    if (lines.length >= count) break;
  }
  return lines;
}

describe("BuildLog", () => {
  it("writes only complete lines and flushes the remainder on close", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({ path: join(dir, "a.log") });
      log.write("one\ntw");
      expect(log.text).toBe("one");
      log.write("o\nthree");
      expect(log.text).toBe("one\ntwo");
      await log.close();
      expect(log.text).toBe("one\ntwo\nthree");
    });
  });

  it("redacts a protected secret", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({ path: join(dir, "a.log") });
      log.protect("ghs_supersecrettoken");
      log.write(
        "fatal: could not read from https://x-access-token:ghs_supersecrettoken@github.com/o/r.git\n",
      );
      await log.close();
      expect(log.text).not.toContain("ghs_supersecrettoken");
      expect(log.text).toContain("***");
    });
  });

  it("redacts a secret split across two writes", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({ path: join(dir, "a.log") });
      log.protect("ghs_supersecrettoken");
      log.write("remote: ghs_super");
      log.write("secrettoken denied\n");
      await log.close();
      expect(log.text).not.toContain("ghs_supersecrettoken");
    });
  });

  it("ignores a secret too short to be one", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({ path: join(dir, "a.log") });
      log.protect("abc");
      log.write("abcdef\n");
      await log.close();
      expect(log.text).toBe("abcdef");
    });
  });

  it("persists to the file it was given", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "a.log");
      const log = new BuildLog({ path });
      log.write("hello\nworld\n");
      await log.close();
      expect(await Bun.file(path).text()).toBe("hello\nworld\n");
    });
  });

  it("drops the oldest lines rather than growing without bound", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({
        path: join(dir, "a.log"),
        maxBufferBytes: 32,
      });
      for (let index = 0; index < 20; index += 1) log.write(`line ${index}\n`);
      await log.close();
      expect(log.text).not.toContain("line 0\n");
      expect(log.text).toContain("line 19");
      expect(log.text.length).toBeLessThanOrEqual(64);
    });
  });

  it("replays what a subscriber missed, then tails", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({ path: join(dir, "a.log") });
      log.write("first\n");
      const pending = collect(log.subscribe(), 2);
      log.write("second\n");
      expect(await pending).toEqual(["first", "second"]);
      await log.close();
    });
  });

  it("ends a subscriber when the log closes", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({ path: join(dir, "a.log") });
      const pending = collect(log.subscribe(), 100);
      log.write("only\n");
      await log.close();
      expect(await pending).toEqual(["only"]);
    });
  });

  it("ends a subscriber on abort", async () => {
    await withTempDir(async (dir) => {
      const log = new BuildLog({ path: join(dir, "a.log") });
      const controller = new AbortController();
      const pending = collect(log.subscribe(controller.signal), 100);
      log.write("only\n");
      queueMicrotask(() => controller.abort());
      expect(await pending).toEqual(["only"]);
      await log.close();
    });
  });
});

describe("BuildLogStore", () => {
  it("streams a running build live", async () => {
    await withTempDir(async (dir) => {
      const store = new BuildLogStore({ root: dir });
      const log = await store.open("dep-1");
      log.write("building\n");
      expect(await collect(store.stream("dep-1"), 1)).toEqual(["building"]);
      await store.close("dep-1");
    });
  });

  it("streams a finished build from its file", async () => {
    await withTempDir(async (dir) => {
      const store = new BuildLogStore({ root: dir });
      const log = await store.open("dep-1");
      log.write("done\n");
      await store.close("dep-1");
      expect(store.get("dep-1")).toBeNull();
      expect(await collect(store.stream("dep-1"), 10)).toEqual(["done"]);
    });
  });

  it("reports an unknown deployment rather than an empty stream", async () => {
    await withTempDir(async (dir) => {
      const store = new BuildLogStore({ root: dir });
      expect(await store.has("nope")).toBe(false);
      await expect(collect(store.stream("nope"), 1)).rejects.toBeInstanceOf(
        BuildLogNotFoundError,
      );
    });
  });
});
