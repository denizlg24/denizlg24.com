import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { POSIX_GATE1_SUPPORTED } from "./posix-gate1-platform";

const SCRIPT = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-gate1-metadata.sh",
);
const RUN_ID = "12345678-1234-4234-8234-123456789abc";
const temporaryParents: string[] = [];

interface ScriptResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

async function runMetadata(args: readonly string[]): Promise<ScriptResult> {
  const child = Bun.spawn(["/bin/bash", SCRIPT, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  return { exitCode, stderr: await stderr, stdout: await stdout };
}

async function fixture(): Promise<{ parent: string; root: string }> {
  const temporary = await mkdtemp(join(tmpdir(), "gate1-metadata-test-"));
  const parent = await realpath(temporary);
  temporaryParents.push(parent);
  const root = join(parent, `posix-gate1-metadata-${RUN_ID}`);
  await mkdir(root);
  await writeFile(
    join(root, ".posix-gate1-metadata"),
    `deniz-cloud-posix-gate1-metadata:${RUN_ID}\n`,
  );
  return { parent, root };
}

afterEach(async () => {
  for (const parent of temporaryParents.splice(0)) {
    await rm(parent, { force: true, recursive: true });
  }
});

describe.skipIf(!POSIX_GATE1_SUPPORTED)(
  "POSIX Gate 1 metadata adversary safety",
  () => {
    it("dry-runs without changing the marked disposable root", async () => {
      const { root } = await fixture();
      const result = await runMetadata([
        "--action",
        "seed",
        "--root",
        root,
        "--run-id",
        RUN_ID,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        action: "seed",
        allGreen: false,
        credentialsInArguments: false,
        mode: "dry-run",
        writes: false,
      });
      expect(await Bun.file(join(root, "metadata.bin")).exists()).toBe(false);
    });

    it("rejects conflicting modes, unsafe roots and in-namespace evidence", async () => {
      const { root } = await fixture();
      const conflicting = await runMetadata([
        "--dry-run",
        "--execute",
        "--action",
        "seed",
        "--root",
        root,
        "--run-id",
        RUN_ID,
      ]);
      expect(conflicting.exitCode).toBe(2);

      const protectedPath = `/mnt/ssd/storage/posix-gate1-metadata-${RUN_ID}`;
      const protectedResult = await runMetadata([
        "--action",
        "seed",
        "--root",
        protectedPath,
        "--run-id",
        RUN_ID,
      ]);
      expect(protectedResult.exitCode).toBe(1);
      expect(protectedResult.stderr).toContain("protected production path");

      const evidenceResult = await runMetadata([
        "--action",
        "seed",
        "--root",
        root,
        "--run-id",
        RUN_ID,
        "--evidence",
        join(root, "evidence.jsonl"),
      ]);
      expect(evidenceResult.exitCode).toBe(1);
      expect(evidenceResult.stderr).toContain("outside the metadata namespace");
    });

    it("rejects symlink roots and mismatched markers", async () => {
      const { parent, root } = await fixture();
      const linked = join(parent, `posix-gate1-metadata-${RUN_ID}-link`);
      await symlink(root, linked);
      const linkedResult = await runMetadata([
        "--action",
        "verify",
        "--root",
        linked,
        "--run-id",
        RUN_ID,
      ]);
      expect(linkedResult.exitCode).not.toBe(0);

      await writeFile(join(root, ".posix-gate1-metadata"), "wrong\n");
      const markerResult = await runMetadata([
        "--action",
        "verify",
        "--root",
        root,
        "--run-id",
        RUN_ID,
      ]);
      expect(markerResult.exitCode).toBe(1);
      expect(markerResult.stderr).toContain("marker is missing or mismatched");
    });

    it("contains the exact reserved-xattr and AppleDouble adversarial probes", async () => {
      const source = await Bun.file(SCRIPT).text();
      for (const attribute of [
        "user.denizcloud.id",
        "user.denizcloud.owner_id",
        "user.denizcloud.created_at",
        "user.denizcloud.schema_version",
        "user.denizcloud.checksum",
      ]) {
        expect(source).toContain(attribute);
      }
      expect(source).toContain("metadata.bin:user.denizcloud.id");
      expect(source).toContain("metadata.bin:AFP_Resource");
      expect(source).toContain('== "00051607"');
      expect(source).toContain("appleDoubleVisibleOverSmb");
    });
  },
);
