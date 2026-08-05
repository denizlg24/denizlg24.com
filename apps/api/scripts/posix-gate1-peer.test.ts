import { afterEach, describe, expect, it } from "bun:test";
import {
  lstat,
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
  expectedGenerationHash,
  type PeerArguments,
  PeerSafetyError,
  parsePeerArguments,
  runPosixGate1Peer,
} from "./posix-gate1-peer";

const RUN_ID = "12345678-1234-4234-8234-123456789abc";
const temporaryParents: string[] = [];

async function fixture(): Promise<{
  control: string;
  evidence: string;
  root: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "posix-gate1-peer-test-"));
  temporaryParents.push(parent);
  const root = join(parent, `posix-gate1-disposable-${RUN_ID}`);
  const control = join(parent, `posix-gate1-control-${RUN_ID}`);
  await Promise.all([mkdir(root), mkdir(control)]);
  await Promise.all([
    writeFile(
      join(root, ".posix-gate1-disposable"),
      "deniz-cloud-posix-gate1\n",
    ),
    writeFile(join(control, ".posix-gate1-control"), `${RUN_ID}\n`),
  ]);
  return { control, evidence: join(parent, "evidence.jsonl"), root };
}

function options(
  root: string,
  overrides: Partial<PeerArguments> = {},
): PeerArguments {
  return {
    action: "seed",
    bytes: 4096,
    delayMs: 0,
    dryRun: false,
    expectedGenerations: [],
    generation: "A",
    holdMs: 1000,
    iterations: 3,
    root,
    runId: RUN_ID,
    target: "payload",
    ...overrides,
  };
}

afterEach(async () => {
  for (const parent of temporaryParents.splice(0)) {
    await rm(parent, { force: true, recursive: true });
  }
});

describe("POSIX Gate 1 concurrency peer arguments", () => {
  it("is dry-run by default and accepts only bounded whitelisted actions", () => {
    expect(
      parsePeerArguments([
        "--action",
        "seed",
        "--root",
        `/tmp/posix-gate1-disposable-${RUN_ID}`,
        "--run-id",
        RUN_ID,
        "--generation",
        "a",
      ]),
    ).toMatchObject({
      action: "seed",
      dryRun: true,
      generation: "A",
      runId: RUN_ID,
    });
    expect(() =>
      parsePeerArguments([
        "--action",
        "shell",
        "--root",
        "/tmp/irrelevant",
        "--run-id",
        RUN_ID,
      ]),
    ).toThrow("--action must be one of");
    expect(() =>
      parsePeerArguments([
        "--action",
        "snapshot-loop",
        "--root",
        `/tmp/posix-gate1-disposable-${RUN_ID}`,
        "--run-id",
        RUN_ID,
        "--expected-generations",
        "A,B",
        "--iterations",
        "200",
        "--delay-ms",
        "1000",
      ]),
    ).toThrow("duration exceeds");
  });
});

describe("POSIX Gate 1 concurrency peer safety", () => {
  it("rejects production roots, symlink roots, markers and unexpected entries", async () => {
    await expect(
      runPosixGate1Peer(
        options(`/mnt/ssd/storage/posix-gate1-disposable-${RUN_ID}`, {
          dryRun: true,
        }),
      ),
    ).rejects.toThrow("protected production");
    await expect(
      runPosixGate1Peer(
        options(
          `/mnt/hdd/deniz-cloud/namespace/posix-gate1-disposable-${RUN_ID}`,
          { dryRun: false },
        ),
      ),
    ).rejects.toThrow("protected production");

    const { root } = await fixture();
    const linked = join(
      dirname(root),
      `posix-gate1-disposable-${RUN_ID}-linked`,
    );
    await symlink(root, linked);
    await expect(
      runPosixGate1Peer(options(linked, { dryRun: true })),
    ).rejects.toThrow(PeerSafetyError);

    await writeFile(join(root, "unexpected"), "nope");
    await expect(
      runPosixGate1Peer(options(root, { dryRun: true })),
    ).rejects.toThrow("unexpected entry");
  });

  it("does not mutate a valid root in dry-run mode", async () => {
    const { root } = await fixture();
    const before = await readdir(root);
    const result = await runPosixGate1Peer(options(root, { dryRun: true }));
    expect(result).toMatchObject({ dryRun: true, ok: false });
    expect(await readdir(root)).toEqual(before);
  });

  it("rejects a symlink evidence target before executing an action", async () => {
    const { root } = await fixture();
    const parent = dirname(root);
    const evidenceTarget = join(parent, "evidence-target.jsonl");
    const evidenceLink = join(parent, "evidence-link.jsonl");
    await writeFile(evidenceTarget, "");
    await symlink(evidenceTarget, evidenceLink);

    await expect(
      runPosixGate1Peer(options(root, { logPath: evidenceLink })),
    ).rejects.toThrow("must not be a symlink");
    expect(await readdir(root)).toEqual([".posix-gate1-disposable"]);
  });
});

describe("POSIX Gate 1 concurrency peer actions", () => {
  it("seeds, atomically replaces, snapshots, renames, holds and unlinks exact generations", async () => {
    const { control, evidence, root } = await fixture();
    const seeded = await runPosixGate1Peer(
      options(root, { logPath: evidence }),
    );
    expect(seeded).toMatchObject({
      ok: true,
      details: { hash: expectedGenerationHash("A", 4096) },
    });

    const replaced = await runPosixGate1Peer(
      options(root, {
        action: "atomic-replace",
        generation: "B",
        logPath: evidence,
      }),
    );
    expect(replaced).toMatchObject({
      ok: true,
      details: { hash: expectedGenerationHash("B", 4096) },
    });

    const snapshots = await runPosixGate1Peer(
      options(root, {
        action: "snapshot-loop",
        expectedGenerations: ["A", "B"],
        generation: undefined,
      }),
    );
    expect(snapshots).toMatchObject({
      ok: true,
      details: { counts: { B: 3 }, missing: 0, unknown: 0 },
    });

    expect(
      await runPosixGate1Peer(
        options(root, { action: "rename", generation: undefined }),
      ),
    ).toMatchObject({ ok: true });

    const held = await runPosixGate1Peer(
      options(root, {
        action: "hold-read",
        controlDir: control,
        generation: undefined,
        target: "renamed",
      }),
      {
        async onReady() {
          await writeFile(join(control, "release"), "release\n", {
            flag: "wx",
          });
        },
      },
    );
    expect(held).toMatchObject({
      ok: true,
      details: {
        afterHash: expectedGenerationHash("B", 4096),
        beforeHash: expectedGenerationHash("B", 4096),
        released: true,
      },
    });

    expect(
      await runPosixGate1Peer(
        options(root, {
          action: "unlink",
          generation: undefined,
          target: "renamed",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(await readdir(root)).toEqual([".posix-gate1-disposable"]);

    const evidenceText = await readFile(evidence, "utf8");
    expect(evidenceText).not.toContain(root);
    const records = evidenceText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect((await stat(evidence)).mode & 0o777).toBe(0o600);
  });

  it("reports unknown snapshots and injects explicit test-only links", async () => {
    const first = await fixture();
    await runPosixGate1Peer(options(first.root));
    const snapshots = await runPosixGate1Peer(
      options(first.root, {
        action: "snapshot-loop",
        expectedGenerations: ["B"],
        generation: undefined,
      }),
    );
    expect(snapshots).toMatchObject({
      ok: false,
      details: { missing: 0, unknown: 3 },
    });

    const second = await fixture();
    await runPosixGate1Peer(options(second.root));
    const injected = await runPosixGate1Peer(
      options(second.root, {
        action: "inject-test-link",
        generation: undefined,
      }),
    );
    expect(injected).toMatchObject({
      ok: true,
      details: { hardLinkCount: 2, symbolicLink: true },
    });
    expect(
      (await lstat(join(second.root, "test-symlink"))).isSymbolicLink(),
    ).toBe(true);
    expect((await lstat(join(second.root, "test-hardlink"))).nlink).toBe(2);
  });
});
