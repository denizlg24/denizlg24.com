import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROTECTED_XATTR_KEYS } from "@repo/cloud-core";

import {
  type ManifestEntry,
  protectedCanonical,
  protectedHash,
  verifyManifests,
} from "./posix-manifest-verify";

const roots: string[] = [];
const ownerId = "30000000-0000-4000-8000-000000000003";
const sharedFolderId = "40000000-0000-4000-8000-000000000004";
const fileId = "50000000-0000-4000-8000-000000000006";
const checksum = "b".repeat(64);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const forwardFolder = {
  createdAt: "2026-07-01T10:00:00Z",
  event: "migration-folder",
  id: sharedFolderId,
  name: "shared",
  ownerId: null,
  path: "/shared",
  schemaVersion: 1,
  targetRelativePath: "shared",
  targetTier: "ssd",
};

const forwardFile = {
  allocatedBlocks512: 8,
  checksum,
  createdAt: "2026-07-02T10:00:00Z",
  event: "migration-file",
  id: fileId,
  mimeType: "text/plain",
  name: "notes.txt",
  ownerId,
  path: "/shared/notes.txt",
  schemaVersion: 1,
  sizeBytes: 9,
  targetRelativePath: "shared/notes.txt",
  targetTier: "ssd",
};

function reverseOf(
  entry: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const kind = entry.event === "migration-file" ? "file" : "folder";
  const base: Record<string, unknown> = {
    createdAt: entry.createdAt,
    event: `reverse-${kind}`,
    id: entry.id,
    name: entry.name,
    ownerId: entry.ownerId,
    path: entry.path,
    protectedXattrHash: protectedHash(entry as unknown as ManifestEntry, kind),
    schemaVersion: 1,
    sourcePath: `/mnt/ssd/deniz-cloud/namespace/${entry.targetRelativePath}`,
    sourceTier: entry.targetTier,
  };
  if (kind === "file") {
    base.allocatedBlocks512 = entry.allocatedBlocks512;
    base.checksum = entry.checksum;
    base.mimeType = entry.mimeType;
    base.sizeBytes = entry.sizeBytes;
  }
  return { ...base, ...overrides };
}

async function manifests(
  forwardEntries: Record<string, unknown>[],
  reverseEntries: Record<string, unknown>[],
) {
  const root = await mkdtemp(join(tmpdir(), "posix-manifest-verify-"));
  roots.push(root);
  const forwardPath = join(root, "forward.jsonl");
  const reversePath = join(root, "reverse.jsonl");
  const forwardSummary = {
    allGreen: true,
    database: {
      files: {
        count: forwardEntries.filter((e) => e.event === "migration-file")
          .length,
      },
      folders: {
        count: forwardEntries.filter((e) => e.event === "migration-folder")
          .length,
      },
    },
    event: "inventory-summary",
    manifestSchema: "deniz-cloud-posix-migration-v1",
    schemaVersion: 1,
  };
  const reverseSummary = {
    event: "reverse-summary",
    manifestSchema: "deniz-cloud-posix-reverse-v1",
    schemaVersion: 1,
  };
  await Promise.all([
    writeFile(
      forwardPath,
      `${[forwardSummary, ...forwardEntries].map((r) => JSON.stringify(r)).join("\n")}\n`,
    ),
    writeFile(
      reversePath,
      `${[reverseSummary, ...reverseEntries].map((r) => JSON.stringify(r)).join("\n")}\n`,
    ),
  ]);
  return { forwardPath, reversePath };
}

describe("POSIX migration manifest verifier", () => {
  it("agrees byte for byte with the shell exporter's canonical form", async () => {
    const canonical = protectedCanonical(
      forwardFile as unknown as ManifestEntry,
      "file",
    );
    expect(canonical).toBe(
      [
        `${PROTECTED_XATTR_KEYS.checksum}=${checksum}`,
        `${PROTECTED_XATTR_KEYS.checksumState}=verified`,
        `${PROTECTED_XATTR_KEYS.createdAt}=2026-07-02T10:00:00Z`,
        `${PROTECTED_XATTR_KEYS.id}=${fileId}`,
        `${PROTECTED_XATTR_KEYS.mimeType}=text/plain`,
        `${PROTECTED_XATTR_KEYS.ownerId}=${ownerId}`,
        `${PROTECTED_XATTR_KEYS.schemaVersion}=1`,
        "",
      ].join("\n"),
    );
    // The reverse exporter pipes exactly this string through `sha256sum`.
    const shell = Bun.spawnSync({
      cmd: [
        "bash",
        "-c",
        `printf '%s' "$1" | sha256sum | cut -d' ' -f1`,
        "_",
        canonical,
      ],
      stdout: "pipe",
    });
    expect(shell.stdout.toString().trim()).toBe(
      protectedHash(forwardFile as unknown as ManifestEntry, "file"),
    );
  });

  it("omits owner and adds scope for the ownerless shared root", () => {
    const canonical = protectedCanonical(
      forwardFolder as unknown as ManifestEntry,
      "folder",
    );
    expect(canonical).not.toContain(PROTECTED_XATTR_KEYS.ownerId);
    expect(canonical).toContain(`${PROTECTED_XATTR_KEYS.scope}=shared`);
  });

  it("passes when both directions describe the same namespace", async () => {
    const { forwardPath, reversePath } = await manifests(
      [forwardFolder, forwardFile],
      [reverseOf(forwardFolder), reverseOf(forwardFile)],
    );
    const result = await verifyManifests({
      forwardPath,
      requireExact: true,
      reversePath,
    });
    expect(result).toMatchObject({
      added: 0,
      drift: 0,
      exact: true,
      ok: true,
    });
    expect(result.differences).toEqual([]);
  });

  it("reports a checksum that moved without the path moving", async () => {
    const { forwardPath, reversePath } = await manifests(
      [forwardFolder, forwardFile],
      // Rewriting the file changes the checksum xattr, so the protected hash
      // moves with it rather than independently.
      [
        reverseOf(forwardFolder),
        reverseOf({ ...forwardFile, checksum: "c".repeat(64) }),
      ],
    );
    const result = await verifyManifests({
      forwardPath,
      requireExact: true,
      reversePath,
    });
    expect(result.ok).toBe(false);
    expect(result.differences.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        "CHECKSUM_CHANGED",
        "PROTECTED_METADATA_CHANGED",
      ]),
    );
  });

  it("reports protected metadata drift even when bytes agree", async () => {
    const { forwardPath, reversePath } = await manifests(
      [forwardFolder, forwardFile],
      [
        reverseOf(forwardFolder),
        reverseOf(forwardFile, { protectedXattrHash: "d".repeat(64) }),
      ],
    );
    const result = await verifyManifests({
      forwardPath,
      requireExact: true,
      reversePath,
    });
    expect(result.ok).toBe(false);
    expect(result.differences).toEqual([
      {
        code: "PROTECTED_METADATA_CHANGED",
        detail: expect.stringContaining("expected"),
        id: fileId,
        path: "/shared/notes.txt",
      },
    ]);
  });

  it("reports an ID the namespace lost", async () => {
    const { forwardPath, reversePath } = await manifests(
      [forwardFolder, forwardFile],
      [reverseOf(forwardFolder)],
    );
    const result = await verifyManifests({
      forwardPath,
      requireExact: true,
      reversePath,
    });
    expect(result.ok).toBe(false);
    expect(result.differences).toEqual([
      {
        code: "MISSING_IN_REVERSE",
        detail: expect.any(String),
        id: fileId,
        path: "/shared/notes.txt",
      },
    ]);
  });

  it("separates post-cutover entries from drift", async () => {
    const postCutover = {
      ...forwardFile,
      id: "50000000-0000-4000-8000-000000000099",
      name: "new.txt",
      path: "/shared/new.txt",
      targetRelativePath: "shared/new.txt",
    };
    const { forwardPath, reversePath } = await manifests(
      [forwardFolder, forwardFile],
      [
        reverseOf(forwardFolder),
        reverseOf(forwardFile),
        reverseOf(postCutover),
      ],
    );

    const strict = await verifyManifests({
      forwardPath,
      requireExact: true,
      reversePath,
    });
    expect(strict).toMatchObject({
      added: 1,
      drift: 0,
      exact: false,
      ok: false,
    });

    // A rollback after writes have been accepted expects exactly this shape.
    const tolerant = await verifyManifests({
      forwardPath,
      requireExact: false,
      reversePath,
    });
    expect(tolerant).toMatchObject({ added: 1, drift: 0, ok: true });
    expect(tolerant.differences).toEqual([
      {
        code: "ADDED_AFTER_FORWARD",
        detail: expect.any(String),
        id: "50000000-0000-4000-8000-000000000099",
        path: "/shared/new.txt",
      },
    ]);
  });

  it("refuses a manifest that is not the expected schema", async () => {
    const { forwardPath, reversePath } = await manifests(
      [forwardFolder],
      [reverseOf(forwardFolder)],
    );
    await writeFile(
      forwardPath,
      `${JSON.stringify({ event: "inventory-summary", manifestSchema: "something-else", schemaVersion: 1 })}\n`,
    );
    expect(
      verifyManifests({ forwardPath, requireExact: true, reversePath }),
    ).rejects.toThrow("deniz-cloud-posix-migration-v1");
  });
});
