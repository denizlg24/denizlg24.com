import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-storage-migrate.sh",
);
const roots: string[] = [];
const snapshotId = "posix-gate0-20260805T124412Z";
const ssdBranchId = "10000000-0000-4000-8000-000000000001";
const hddBranchId = "20000000-0000-4000-8000-000000000002";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

interface Fixture {
  root: string;
  sourceSsd: string;
  sourceHdd: string;
  targetSsd: string;
  targetHdd: string;
  snapshotRoot: string;
  inventory: string;
  journal: string;
}

async function fixture(): Promise<Fixture> {
  // The script realpaths every root and the contract compares sourcePath
  // against them, so the fixture must agree; macOS resolves /var to /private/var.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "posix-storage-migrate-")),
  );
  roots.push(root);
  const sourceSsd = join(root, "legacy-ssd");
  const sourceHdd = join(root, "legacy-hdd");
  const targetSsd = join(root, "namespace-ssd");
  const targetHdd = join(root, "namespace-hdd");
  const snapshotRoot = join(root, "backups");
  const snapshot = join(snapshotRoot, snapshotId);
  const inventory = join(root, "inventory.jsonl");
  const journal = join(root, "migration.journal.jsonl");
  const snapshotManifest = `${JSON.stringify({ schemaVersion: 1, snapshotId })}\n`;
  await Promise.all([
    mkdir(join(sourceSsd, "shared"), { recursive: true }),
    mkdir(sourceHdd),
    mkdir(targetSsd),
    mkdir(targetHdd),
    mkdir(snapshot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(sourceSsd, "shared", "file.txt"), "ssd-source"),
    writeFile(
      join(sourceHdd, "10000000-0000-4000-8000-000000000001"),
      "hdd-source",
    ),
    writeFile(
      join(targetSsd, ".denizcloud-branch.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        role: "ssd",
        filesystemUuid: "test-ssd-uuid",
        branchId: ssdBranchId,
        createdAt: "2026-08-05T12:44:12Z",
      })}\n`,
    ),
    writeFile(
      join(targetHdd, ".denizcloud-branch.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        role: "hdd",
        filesystemUuid: "test-hdd-uuid",
        branchId: hddBranchId,
        createdAt: "2026-08-05T12:44:12Z",
      })}\n`,
    ),
    writeFile(join(snapshot, "manifest.json"), snapshotManifest),
    writeFile(
      join(snapshot, "SHA256SUMS"),
      `${new Bun.CryptoHasher("sha256").update(snapshotManifest).digest("hex")}  manifest.json\n`,
    ),
    writeFile(
      inventory,
      `${JSON.stringify({
        event: "inventory-summary",
        allGreen: true,
        database: { files: { count: 2 }, folders: { count: 1 } },
      })}\n`,
    ),
  ]);
  return {
    root,
    sourceSsd,
    sourceHdd,
    targetSsd,
    targetHdd,
    snapshotRoot,
    inventory,
    journal,
  };
}

function run(
  data: Fixture,
  args: string[] = [],
  env: Record<string, string> = {},
) {
  return Bun.spawnSync({
    cmd: [
      "bash",
      script,
      ...args,
      "--inventory",
      data.inventory,
      "--snapshot-id",
      snapshotId,
    ],
    env: {
      ...process.env,
      POSIX_MIGRATION_SOURCE_SSD: data.sourceSsd,
      POSIX_MIGRATION_SOURCE_HDD: data.sourceHdd,
      POSIX_MIGRATION_TARGET_SSD: data.targetSsd,
      POSIX_MIGRATION_TARGET_HDD: data.targetHdd,
      POSIX_MIGRATION_SNAPSHOT_ROOT: data.snapshotRoot,
      POSIX_MIGRATION_JOURNAL: data.journal,
      POSIX_MIGRATION_SSD_UUID: "test-ssd-uuid",
      POSIX_MIGRATION_HDD_UUID: "test-hdd-uuid",
      POSIX_MIGRATION_SSD_BRANCH_ID: ssdBranchId,
      POSIX_MIGRATION_HDD_BRANCH_ID: hddBranchId,
      POSIX_MIGRATION_API_RUNNING: "false",
      POSIX_MIGRATION_CURRENT_SNAPSHOT_ID: snapshotId,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function tree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.map(String).sort();
}

describe("POSIX storage migration planner", () => {
  it("has valid shell syntax", () => {
    const result = Bun.spawnSync(["bash", "-n", script]);
    expect(result.exitCode).toBe(0);
  });

  it("defaults to a mutation-free dry-run and stops on the current inventory schema", async () => {
    const data = await fixture();
    const beforeTree = await tree(data.root);
    const beforeSsd = await readFile(
      join(data.sourceSsd, "shared", "file.txt"),
      "utf8",
    );
    const beforeHdd = await readFile(
      join(data.sourceHdd, "10000000-0000-4000-8000-000000000001"),
      "utf8",
    );

    const result = run(data);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout.toString());
    expect(output).toMatchObject({
      schemaVersion: 1,
      mode: "--dry-run",
      executable: false,
      inventoryEntries: 0,
      sourceDeletionAllowed: false,
      stopReason: "inventory does not satisfy deniz-cloud-posix-migration-v1",
    });
    expect(output.blockers).toEqual([
      {
        code: "INVENTORY_MANIFEST_CONTRACT_MISSING",
        message: "inventory does not satisfy deniz-cloud-posix-migration-v1",
      },
    ]);
    expect(output.copyContract).toEqual(
      expect.arrayContaining([
        "preserve-xattrs",
        "preserve-acls",
        "preserve-sparse",
        "copy-fsync-verify-publish",
        "no-overwrite",
        "journal-resume",
      ]),
    );
    expect(await tree(data.root)).toEqual(beforeTree);
    expect(
      await readFile(join(data.sourceSsd, "shared", "file.txt"), "utf8"),
    ).toBe(beforeSsd);
    expect(
      await readFile(
        join(data.sourceHdd, "10000000-0000-4000-8000-000000000001"),
        "utf8",
      ),
    ).toBe(beforeHdd);
  });

  it("requires the explicit live-API no-write exception", async () => {
    const data = await fixture();
    const blocked = run(data, [], { POSIX_MIGRATION_API_RUNNING: "true" });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr.toString()).toContain(
      "operator-enforced storage write freeze",
    );

    const planned = run(data, ["--allow-live-api-no-writes"], {
      POSIX_MIGRATION_API_RUNNING: "true",
    });
    expect(planned.exitCode).toBe(0);
    expect(JSON.parse(planned.stdout.toString())).toMatchObject({
      apiRunning: true,
      allowLiveApiNoWrites: true,
      executable: false,
    });
  });

  it("rejects inventory and branch evidence that is not exact", async () => {
    const data = await fixture();
    await writeFile(
      data.inventory,
      `${JSON.stringify({ event: "inventory-summary", allGreen: false })}\n`,
    );
    const blockedInventory = run(data);
    expect(blockedInventory.exitCode).toBe(1);
    expect(blockedInventory.stderr.toString()).toContain(
      "Inventory is not all-green",
    );

    await writeFile(
      data.inventory,
      `${JSON.stringify({ event: "inventory-summary", allGreen: true })}\n`,
    );
    await writeFile(
      join(data.targetHdd, ".denizcloud-branch.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        role: "hdd",
        filesystemUuid: "wrong-uuid",
        branchId: hddBranchId,
        createdAt: "2026-08-05T12:44:12Z",
      })}\n`,
    );
    const blockedMarker = run(data);
    expect(blockedMarker.exitCode).toBe(1);
    expect(blockedMarker.stderr.toString()).toContain(
      "hdd branch marker/UUID validation failed",
    );
  });

  it("keeps execute and rollback fail-closed without the missing manifest contract", async () => {
    const data = await fixture();
    const before = await tree(data.root);

    for (const mode of ["--execute", "--rollback"]) {
      const result = run(data, [mode]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toMatch(
        /requires root|exact production storage path allowlist|STOP:/,
      );
      expect(await tree(data.root)).toEqual(before);
    }
  });

  it("does not infer an executable schema from unknown entry events", async () => {
    const data = await fixture();
    await writeFile(
      data.inventory,
      `${[
        JSON.stringify({ event: "inventory-summary", allGreen: true }),
        JSON.stringify({
          event: "migration-file",
          id: "10000000-0000-4000-8000-000000000001",
          path: "/shared/file.txt",
        }),
      ].join("\n")}\n`,
    );

    const result = run(data);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      executable: false,
      inventoryEntries: 1,
      sourceDeletionAllowed: false,
    });
  });

  it("reports executable when the inventory satisfies the whole contract", async () => {
    // Every other case proves the contract rejects something. Without this one
    // a contract that rejects *everything* would pass the suite.
    const data = await fixture();
    const folderId = "40000000-0000-4000-8000-000000000004";
    const fileId = "50000000-0000-4000-8000-000000000006";
    const ownerId = "30000000-0000-4000-8000-000000000003";
    await writeFile(
      data.inventory,
      `${[
        JSON.stringify({
          allGreen: true,
          database: { files: { count: 1 }, folders: { count: 1 } },
          event: "inventory-summary",
          manifestSchema: "deniz-cloud-posix-migration-v1",
          schemaVersion: 1,
        }),
        JSON.stringify({
          createdAt: "2026-07-01T10:00:00Z",
          event: "migration-folder",
          id: folderId,
          name: "shared",
          ownerId: null,
          parentId: null,
          path: "/shared",
          schemaVersion: 1,
          sourcePath: `${data.sourceSsd}/shared`,
          targetRelativePath: "shared",
          targetTier: "ssd",
          updatedAt: "2026-07-02T10:00:00Z",
        }),
        JSON.stringify({
          allocatedBlocks512: 8,
          checksum: "a".repeat(64),
          createdAt: "2026-07-01T10:00:00Z",
          event: "migration-file",
          folderId,
          id: fileId,
          mimeType: "text/plain",
          name: "file.txt",
          ownerId,
          path: "/shared/file.txt",
          schemaVersion: 1,
          sizeBytes: 10,
          sourcePath: `${data.sourceSsd}/shared/file.txt`,
          targetRelativePath: "shared/file.txt",
          targetTier: "ssd",
          updatedAt: "2026-07-02T10:00:00Z",
        }),
      ].join("\n")}\n`,
    );

    const result = run(data);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      blockers: [],
      executable: true,
      inventoryEntries: 2,
      sourceDeletionAllowed: false,
      state: "planned",
      stopReason: null,
    });
  });

  it("refuses an inventory with duplicate ids or duplicate target paths", async () => {
    const data = await fixture();
    const folderId = "40000000-0000-4000-8000-000000000004";
    const summary = JSON.stringify({
      allGreen: true,
      database: { files: { count: 2 }, folders: { count: 0 } },
      event: "inventory-summary",
      manifestSchema: "deniz-cloud-posix-migration-v1",
      schemaVersion: 1,
    });
    const file = (id: string, path: string) =>
      JSON.stringify({
        allocatedBlocks512: 8,
        checksum: "a".repeat(64),
        createdAt: "2026-07-01T10:00:00Z",
        event: "migration-file",
        folderId,
        id,
        mimeType: null,
        name: path.slice(path.lastIndexOf("/") + 1),
        ownerId: "30000000-0000-4000-8000-000000000003",
        path,
        schemaVersion: 1,
        sizeBytes: 10,
        sourcePath: `${data.sourceSsd}${path}`,
        targetRelativePath: path.slice(1),
        targetTier: "ssd",
        updatedAt: "2026-07-02T10:00:00Z",
      });

    // A duplicate id makes the second entry take the resume branch off the
    // first entry's journal record, after earlier entries have published.
    const duplicateId = "50000000-0000-4000-8000-000000000006";
    await writeFile(
      data.inventory,
      `${[summary, file(duplicateId, "/a.txt"), file(duplicateId, "/b.txt")].join("\n")}\n`,
    );
    expect(JSON.parse(run(data).stdout.toString()).executable).toBe(false);

    await writeFile(
      data.inventory,
      `${[
        summary,
        file(duplicateId, "/same.txt"),
        file("50000000-0000-4000-8000-000000000007", "/same.txt"),
      ].join("\n")}\n`,
    );
    expect(JSON.parse(run(data).stdout.toString()).executable).toBe(false);
  });
});
