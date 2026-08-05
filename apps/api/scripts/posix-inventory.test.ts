import { describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArchiveJobStore } from "@repo/cloud-core/storage";

import {
  collectPosixInventory,
  crossPlatformNameKey,
  resolveStoredBlobPath,
} from "./posix-inventory";

function fakeDb(rows: {
  files: unknown[];
  folders: unknown[];
  tus: unknown[];
}) {
  let call = 0;
  return {
    select() {
      const selected = [rows.files, rows.folders, rows.tus][call++] ?? [];
      const promise = Promise.resolve(selected);
      const chain = {
        from() {
          return Object.assign(promise, { where: () => promise });
        },
      };
      return chain;
    },
  };
}

describe("POSIX inventory", () => {
  it("uses a compatibility-normalized casefold key", () => {
    expect(crossPlatformNameKey("Ｆｏｏ.TXT")).toBe("FOO.TXT");
    expect(crossPlatformNameKey("Résumé")).toBe(
      crossPlatformNameKey("Re\u0301sume\u0301"),
    );
    expect(crossPlatformNameKey("Straße")).toBe(
      crossPlatformNameKey("STRASSE"),
    );
  });

  it("refuses stored paths outside their configured tier", () => {
    expect(resolveStoredBlobPath("/data/ssd", "folder/file.txt")).toBe(
      "/data/ssd/folder/file.txt",
    );
    expect(resolveStoredBlobPath("/data/ssd", "../secret")).toBeNull();
    expect(resolveStoredBlobPath("/data/ssd", "/etc/passwd")).toBeNull();
  });

  it("reports physical and logical blockers and writes a private JSONL audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "posix-inventory-test-"));
    const ssd = join(root, "ssd");
    const hdd = join(root, "hdd");
    const archives = join(ssd, ".archives");
    const auditPath = join(root, "audit", "inventory.jsonl");
    await Promise.all([
      mkdir(join(ssd, "shared"), { recursive: true }),
      mkdir(hdd),
      mkdir(archives, { recursive: true }),
    ]);
    await writeFile(join(ssd, "shared", "Report.txt"), "good");
    await writeFile(join(ssd, "shared", "wrong.txt"), "wrong");
    await symlink("shared/Report.txt", join(ssd, "linked.txt"));

    const db = fakeDb({
      files: [
        {
          checksum:
            "770e607624d689265ca6c44884d0807d9b054d23c473c106c72be9de08b7376c",
          diskPath: join(ssd, "shared", "Report.txt"),
          filename: "Report.txt",
          id: "00000000-0000-4000-8000-000000000001",
          path: "/shared/Report.txt",
          sizeBytes: 4,
          tier: "ssd",
        },
        {
          checksum: "0".repeat(64),
          diskPath: join(ssd, "shared", "wrong.txt"),
          filename: "wrong.txt",
          id: "00000000-0000-4000-8000-000000000002",
          path: "/shared/wrong.txt",
          sizeBytes: 6,
          tier: "ssd",
        },
        {
          checksum: "0".repeat(64),
          diskPath: join(hdd, "00000000-0000-4000-8000-000000000003"),
          filename: "CON",
          id: "00000000-0000-4000-8000-000000000003",
          path: "/shared/CON",
          sizeBytes: 10,
          tier: "hdd",
        },
      ],
      folders: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Report.txt",
          path: "/shared/Report.txt",
        },
        {
          id: "00000000-0000-4000-8000-000000000005",
          name: "report.TXT",
          path: "/shared/report.TXT",
        },
      ],
      tus: [
        {
          bytesReceived: 4,
          expiresAt: new Date("2026-01-01T00:00:00.000Z"),
          id: "00000000-0000-4000-8000-000000000004",
          sizeBytes: 10,
        },
      ],
    });

    const summary = await collectPosixInventory({
      archivePath: archives,
      auditPath,
      db: db as never,
      excludedPaths: [archives],
      hddStoragePath: hdd,
      now: new Date("2026-08-05T00:00:00.000Z"),
      ssdStoragePath: ssd,
    });

    expect(summary.allGreen).toBe(false);
    expect(summary.gate.blockers).toEqual(
      expect.arrayContaining([
        { count: 1, name: "checksumMismatches" },
        { count: 1, name: "activeTusUploads" },
        { count: 1, name: "archiveActivityUnobservable" },
      ]),
    );
    expect(summary.gate.blockers).not.toContainEqual({
      count: 1,
      name: "verifiedBlobs",
    });
    expect(summary.database.files.byTier).toEqual({
      hdd: { bytes: 10, files: 1 },
      ssd: { bytes: 10, files: 2 },
    });
    expect(summary.issues.checksumMismatches).toBe(1);
    expect(summary.issues.missingBlobs).toBe(1);
    expect(summary.issues.sizeMismatches).toBe(1);
    expect(summary.issues.casefoldCollisions).toBe(1);
    expect(summary.issues.duplicateIds).toBe(1);
    expect(summary.issues.duplicatePaths).toBe(1);
    expect(summary.issues.invalidNames).toBe(1);
    expect(summary.issues.symlinks).toBe(1);
    expect(summary.activeJobs.tus).toMatchObject({
      count: 1,
      expiredCount: 1,
    });
    expect(summary.activeJobs.archives).toMatchObject({
      active: null,
      observable: false,
      snapshotStatus: "missing",
    });

    const audit = (await readFile(auditPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
    expect(audit[0]?.event).toBe("inventory-summary");
    expect(audit.some(({ event }) => event === "checksum-mismatch")).toBe(true);
    expect(audit.some(({ event }) => event === "missing-blob")).toBe(true);
    expect(audit.some(({ event }) => event === "casefold-collision")).toBe(
      true,
    );
    expect(audit.some(({ event }) => event === "symlink")).toBe(true);
  });

  it("can produce a genuinely green inventory with a live archive snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "posix-inventory-green-"));
    const ssd = join(root, "ssd");
    const hdd = join(root, "hdd");
    const archives = join(ssd, ".archives");
    const auditPath = join(root, "inventory.jsonl");
    const filePath = join(ssd, "home", "file.txt");
    await Promise.all([
      mkdir(join(ssd, "home"), { recursive: true }),
      mkdir(hdd),
      mkdir(archives, { recursive: true }),
    ]);
    await writeFile(filePath, "good");
    const archiveJobs = new ArchiveJobStore({
      directory: archives,
      ttlMs: 60_000,
    });
    await archiveJobs.initialize();

    const summary = await collectPosixInventory({
      archivePath: archives,
      auditPath,
      db: fakeDb({
        files: [
          {
            checksum:
              "770e607624d689265ca6c44884d0807d9b054d23c473c106c72be9de08b7376c",
            diskPath: filePath,
            filename: "file.txt",
            id: "00000000-0000-4000-8000-000000000010",
            path: "/home/file.txt",
            sizeBytes: 4,
            tier: "ssd",
          },
        ],
        folders: [
          {
            id: "00000000-0000-4000-8000-000000000011",
            name: "home",
            path: "/home",
          },
        ],
        tus: [],
      }) as never,
      excludedPaths: [archives],
      hddStoragePath: hdd,
      requireMountPoints: false,
      ssdStoragePath: ssd,
    });

    archiveJobs.close();
    expect(summary.allGreen).toBe(true);
    expect(summary.gate.blockers).toEqual([]);
    expect(summary.activeJobs.archives).toMatchObject({
      active: 0,
      observable: true,
      snapshotStatus: "current",
    });
    expect(summary.issues).toMatchObject({
      checksumMismatches: 0,
      missingBlobs: 0,
      orphanFiles: 0,
      sizeMismatches: 0,
      wrongDiskPaths: 0,
    });
  });

  it("optionally writes a complete exact migration manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "posix-inventory-manifest-"));
    const ssd = join(root, "ssd");
    const hdd = join(root, "hdd");
    const archives = join(ssd, ".archives");
    const auditPath = join(root, "inventory.jsonl");
    const manifestPath = join(root, "migration.jsonl");
    const folderPath = join(ssd, "shared");
    const fileId = "00000000-0000-4000-8000-000000000021";
    const filePath = join(hdd, fileId);
    const createdAt = new Date("2026-07-01T10:00:00.000Z");
    const updatedAt = new Date("2026-07-02T11:00:00.000Z");
    await Promise.all([
      mkdir(folderPath, { recursive: true }),
      mkdir(hdd),
      mkdir(archives, { recursive: true }),
    ]);
    await writeFile(filePath, "good");
    const archiveJobs = new ArchiveJobStore({
      directory: archives,
      ttlMs: 60_000,
    });
    await archiveJobs.initialize();

    const summary = await collectPosixInventory({
      archivePath: archives,
      auditPath,
      db: fakeDb({
        files: [
          {
            checksum:
              "770e607624d689265ca6c44884d0807d9b054d23c473c106c72be9de08b7376c",
            createdAt,
            diskPath: filePath,
            filename: "file.txt",
            folderId: "00000000-0000-4000-8000-000000000020",
            id: fileId,
            mimeType: "text/plain",
            ownerId: "00000000-0000-4000-8000-000000000030",
            path: "/shared/file.txt",
            sizeBytes: 4,
            tier: "hdd",
            updatedAt,
          },
        ],
        folders: [
          {
            createdAt,
            id: "00000000-0000-4000-8000-000000000020",
            name: "shared",
            ownerId: null,
            parentId: null,
            path: "/shared",
            updatedAt,
          },
        ],
        tus: [],
      }) as never,
      excludedPaths: [archives],
      hddStoragePath: hdd,
      migrationManifestPath: manifestPath,
      requireMountPoints: false,
      ssdStoragePath: ssd,
    });

    archiveJobs.close();
    expect(summary.allGreen).toBe(true);
    const records = (await readFile(manifestPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      allGreen: true,
      event: "inventory-summary",
      manifestSchema: "deniz-cloud-posix-migration-v1",
      schemaVersion: 1,
    });
    expect(records[1]).toEqual({
      createdAt: createdAt.toISOString(),
      event: "migration-folder",
      id: "00000000-0000-4000-8000-000000000020",
      name: "shared",
      ownerId: null,
      parentId: null,
      path: "/shared",
      schemaVersion: 1,
      sourcePath: folderPath,
      targetRelativePath: "shared",
      targetTier: "ssd",
      updatedAt: updatedAt.toISOString(),
    });
    expect(records[2]).toMatchObject({
      checksum:
        "770e607624d689265ca6c44884d0807d9b054d23c473c106c72be9de08b7376c",
      createdAt: createdAt.toISOString(),
      event: "migration-file",
      folderId: "00000000-0000-4000-8000-000000000020",
      id: fileId,
      mimeType: "text/plain",
      name: "file.txt",
      ownerId: "00000000-0000-4000-8000-000000000030",
      path: "/shared/file.txt",
      schemaVersion: 1,
      sizeBytes: 4,
      sourcePath: filePath,
      targetRelativePath: "shared/file.txt",
      targetTier: "hdd",
      updatedAt: updatedAt.toISOString(),
    });
    expect(typeof records[2]?.allocatedBlocks512).toBe("number");
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
  });

  it("refuses to place or overwrite an audit inside storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "posix-inventory-audit-"));
    const ssd = join(root, "ssd");
    const hdd = join(root, "hdd");
    const archives = join(ssd, ".archives");
    await Promise.all([mkdir(archives, { recursive: true }), mkdir(hdd)]);
    const empty = fakeDb({ files: [], folders: [], tus: [] }) as never;

    await expect(
      collectPosixInventory({
        archivePath: archives,
        auditPath: join(ssd, "audit.jsonl"),
        db: empty,
        excludedPaths: [archives],
        hddStoragePath: hdd,
        ssdStoragePath: ssd,
      }),
    ).rejects.toThrow("outside every storage root");

    const existing = join(root, "existing.jsonl");
    await writeFile(existing, "keep");
    await expect(
      collectPosixInventory({
        archivePath: archives,
        auditPath: existing,
        db: fakeDb({ files: [], folders: [], tus: [] }) as never,
        excludedPaths: [archives],
        hddStoragePath: hdd,
        ssdStoragePath: ssd,
      }),
    ).rejects.toThrow("refusing to overwrite");
    expect(await readFile(existing, "utf8")).toBe("keep");
  });
});
