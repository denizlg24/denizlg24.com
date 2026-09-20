import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepOutputDir } from "./output-dir";

test("sweepOutputDir removes only what is older than the cutoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-out-"));
  const old = new Date(Date.now() - 2 * 3_600_000);
  await writeFile(join(dir, "old.png"), "x");
  await utimes(join(dir, "old.png"), old, old);
  await mkdir(join(dir, "old-session"));
  await writeFile(join(dir, "old-session", "snapshot.yml"), "y");
  await utimes(join(dir, "old-session"), old, old);
  await writeFile(join(dir, "fresh.png"), "z");

  const removed = await sweepOutputDir(dir, 3_600_000);
  expect(removed.sort()).toEqual(["old-session", "old.png"]);
  expect(await readdir(dir)).toEqual(["fresh.png"]);
  expect(await sweepOutputDir("/nonexistent/browser-out", 1)).toEqual([]);
});
