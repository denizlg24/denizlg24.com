import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ProbeSafetyError,
  parseProbeArguments,
  runPosixGate1Probe,
  validateDisposableRoot,
} from "./posix-gate1-probe";

const roots: string[] = [];

async function makeDisposableRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "gate1-test-parent-"));
  roots.push(parent);
  const root = join(parent, "posix-gate1-disposable-test");
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

describe("POSIX Gate 1 probe safety", () => {
  it("is dry-run by default and requires an explicit root", () => {
    expect(
      parseProbeArguments(["--root", "/tmp/posix-gate1-disposable-test"]),
    ).toEqual({
      dryRun: true,
      logPath: undefined,
      root: "/tmp/posix-gate1-disposable-test",
    });
    expect(() => parseProbeArguments([])).toThrow(ProbeSafetyError);
    expect(() =>
      parseProbeArguments([
        "--root",
        "/tmp/posix-gate1-disposable-test",
        "--execute",
        "--dry-run",
      ]),
    ).toThrow("Choose either");
  });

  it("rejects production-like roots, symlinks, unmarked and non-empty roots", async () => {
    await expect(
      validateDisposableRoot("/mnt/ssd/storage/posix-gate1-disposable-test"),
    ).rejects.toThrow("protected production path");

    const parent = await mkdtemp(join(tmpdir(), "gate1-symlink-parent-"));
    roots.push(parent);
    const target = join(parent, "posix-gate1-disposable-target");
    const linked = join(parent, "posix-gate1-disposable-linked");
    await mkdir(target);
    await symlink(target, linked);
    await expect(validateDisposableRoot(linked)).rejects.toThrow(
      "must not be a symlink",
    );

    const root = await makeDisposableRoot();
    await writeFile(join(root, "unexpected"), "data");
    await expect(validateDisposableRoot(root)).rejects.toThrow("empty except");
  });
});

describe("POSIX Gate 1 probe", () => {
  it("does not mutate its disposable root in dry-run mode", async () => {
    const root = await makeDisposableRoot();
    const before = await readdir(root);
    const summary = await runPosixGate1Probe({ dryRun: true, root });
    const after = await readdir(root);

    expect(summary.dryRun).toBe(true);
    expect(summary.allGreen).toBe(false);
    expect(after).toEqual(before);
  });

  it("keeps evidence outside the probed namespace", async () => {
    const root = await makeDisposableRoot();
    await expect(
      runPosixGate1Probe({
        dryRun: true,
        logPath: join(root, "evidence.jsonl"),
        root,
      }),
    ).rejects.toThrow("Evidence log must be outside");
  });

  it("runs bounded filesystem, sparse, Range and interrupted-upload checks", async () => {
    const root = await makeDisposableRoot();
    const logPath = join(dirname(root), "gate1-evidence.jsonl");
    const summary = await runPosixGate1Probe({ dryRun: false, logPath, root });

    expect(summary.allGreen).toBe(true);
    expect(summary.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "same-mount-atomic-rename",
          status: "pass",
        }),
        expect.objectContaining({
          name: "tus-interrupt-fsync-resume-publish",
          status: "pass",
        }),
        expect.objectContaining({
          name: "bun-file-full-range-and-sparse-offset",
          status: "pass",
        }),
        expect.objectContaining({
          name: "mmap-shared-write-msync",
          status: "pass",
        }),
      ]),
    );
    expect(await readdir(root)).toEqual([".posix-gate1-disposable"]);
    const evidence = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(evidence.every((record) => typeof record.name === "string")).toBe(
      true,
    );
    expect((await stat(logPath)).mode & 0o777).toBe(0o600);
  });

  it("refuses to overwrite an evidence file", async () => {
    const root = await makeDisposableRoot();
    const logPath = join(dirname(root), "existing-evidence.jsonl");
    await writeFile(logPath, "keep\n");

    await expect(
      runPosixGate1Probe({ dryRun: false, logPath, root }),
    ).rejects.toThrow("Refusing to overwrite");
    expect(await readFile(logPath, "utf8")).toBe("keep\n");
  });
});
