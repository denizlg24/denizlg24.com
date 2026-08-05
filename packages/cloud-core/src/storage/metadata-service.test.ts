import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROTECTED_XATTR_KEYS, protectedMetadataHash } from "./metadata";
import {
  MetadataServiceError,
  NamespaceMetadataService,
} from "./metadata-service";
import { InMemoryXattrBackend } from "./xattr";

const roots: string[] = [];
const ownerId = "30000000-0000-4000-8000-000000000003";
const fileId = "50000000-0000-4000-8000-000000000006";
const sharedId = "40000000-0000-4000-8000-000000000004";
const checksum = "a".repeat(64);
const createdAt = "2026-07-02T10:00:00Z";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function service() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "metadata-service-")),
  );
  roots.push(root);
  await mkdir(join(root, "shared"), { recursive: true });
  await writeFile(join(root, "shared", "note.txt"), "bytes");
  const xattr = new InMemoryXattrBackend();
  return {
    file: join(root, "shared", "note.txt"),
    root,
    service: new NamespaceMetadataService(root, xattr),
    shared: join(root, "shared"),
    xattr,
  };
}

describe("namespace metadata service", () => {
  it("assigns identity and reads it back with a stable hash", async () => {
    const context = await service();
    const assigned = await context.service.assign("shared/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      mimeType: "text/plain",
      ownerId,
    });

    expect(assigned.metadata).toMatchObject({
      checksum,
      checksumState: "verified",
      id: fileId,
      mimeType: "text/plain",
      ownerId,
    });
    expect(assigned.protectedXattrHash).toBe(
      protectedMetadataHash(assigned.metadata, "file"),
    );
    expect(await context.service.stat("shared/note.txt")).toMatchObject({
      kind: "file",
      sizeBytes: 5,
    });
  });

  it("gives an ownerless entry a shared scope instead", async () => {
    const context = await service();
    const assigned = await context.service.assign("shared", {
      createdAt,
      id: sharedId,
      ownerId: null,
    });
    expect(assigned.metadata.scope).toBe("shared");
    expect(
      await context.xattr.get(context.shared, PROTECTED_XATTR_KEYS.ownerId),
    ).toBeNull();
  });

  it("is idempotent for the same id so a retried create converges", async () => {
    const context = await service();
    const metadata = { checksum, createdAt, id: fileId, ownerId };
    const first = await context.service.assign("shared/note.txt", metadata);
    const second = await context.service.assign("shared/note.txt", metadata);
    expect(second.metadata).toEqual(first.metadata);
  });

  it("refuses to overwrite a different id rather than silently reassigning", async () => {
    const context = await service();
    await context.service.assign("shared/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      ownerId,
    });
    // An SMB copy that inherited metadata looks exactly like this, and it needs
    // deterministic repair rather than a new owner for the old ID.
    expect(
      context.service.assign("shared/note.txt", {
        checksum,
        createdAt,
        id: "50000000-0000-4000-8000-000000000099",
        ownerId,
      }),
    ).rejects.toThrow("already carries");
  });

  it("verifies the expected id and refuses a mismatch", async () => {
    const context = await service();
    await context.service.assign("shared/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      ownerId,
    });
    expect(
      (await context.service.verify("shared/note.txt", fileId)).metadata.id,
    ).toBe(fileId);

    try {
      await context.service.verify(
        "shared/note.txt",
        "50000000-0000-4000-8000-000000000099",
      );
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(MetadataServiceError);
      expect((error as MetadataServiceError).code).toBe("ID_MISMATCH");
    }
  });

  it("reports a pending checksum with no hash so nothing caches stale metadata", async () => {
    const context = await service();
    const assigned = await context.service.assign("shared/note.txt", {
      createdAt,
      id: fileId,
      ownerId,
    });
    expect(assigned.metadata.checksumState).toBe("pending");
    expect(assigned.protectedXattrHash).toBe("");

    const recorded = await context.service.recordChecksum(
      "shared/note.txt",
      checksum.toUpperCase(),
    );
    expect(recorded.metadata.checksumState).toBe("verified");
    expect(recorded.metadata.checksum).toBe(checksum);
    expect(recorded.protectedXattrHash).not.toBe("");
  });

  it("treats an entry with no identity as an error, never as a deletion", async () => {
    const context = await service();
    try {
      await context.service.stat("shared/note.txt");
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as MetadataServiceError).code).toBe("NO_IDENTITY");
    }
  });

  it("rejects a malformed owner and a wrong schema version", async () => {
    const context = await service();
    await context.service.assign("shared/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      ownerId,
    });
    await context.xattr.set(
      context.file,
      PROTECTED_XATTR_KEYS.ownerId,
      "not-a-uuid",
    );
    expect(context.service.stat("shared/note.txt")).rejects.toThrow(
      "malformed",
    );

    await context.xattr.set(
      context.file,
      PROTECTED_XATTR_KEYS.ownerId,
      ownerId,
    );
    await context.xattr.set(
      context.file,
      PROTECTED_XATTR_KEYS.schemaVersion,
      "2",
    );
    expect(context.service.stat("shared/note.txt")).rejects.toThrow("schema");
  });

  it("refuses to assign a malformed id", async () => {
    const context = await service();
    expect(
      context.service.assign("shared/note.txt", {
        createdAt,
        id: "nope",
        ownerId,
      }),
    ).rejects.toThrow("malformed id");
  });
});

describe("namespace listing", () => {
  it("lists children with identity and hides reserved names", async () => {
    const context = await service();
    await mkdir(join(context.root, "shared", "sub"), { recursive: true });
    await writeFile(join(context.root, "shared", "._sidecar"), "apple");
    await writeFile(
      join(context.root, "shared", ".denizcloud-mount-witness"),
      "w",
    );
    await context.service.assign("shared/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      ownerId,
    });
    await context.service.assign("shared/sub", {
      createdAt,
      id: "40000000-0000-4000-8000-000000000077",
      ownerId,
    });

    const listing = await context.service.list("shared");
    expect(listing.entries.map((entry) => entry.relativePath)).toEqual([
      "shared/note.txt",
      "shared/sub",
    ]);
    expect(listing.problems).toEqual([]);
  });

  it("reports an unreadable child instead of dropping it from the folder", async () => {
    const context = await service();
    await writeFile(join(context.root, "shared", "orphan.txt"), "no identity");
    await context.service.assign("shared/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      ownerId,
    });

    const listing = await context.service.list("shared");
    // Silently omitting it would let a projection scan conclude it was deleted.
    expect(listing.entries).toHaveLength(1);
    expect(listing.problems).toEqual([
      { code: "NO_IDENTITY", relativePath: "shared/orphan.txt" },
    ]);
  });

  it("refuses to list a file", async () => {
    const context = await service();
    await context.service.assign("shared/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      ownerId,
    });
    expect(context.service.list("shared/note.txt")).rejects.toThrow(
      "not a folder",
    );
  });
});
