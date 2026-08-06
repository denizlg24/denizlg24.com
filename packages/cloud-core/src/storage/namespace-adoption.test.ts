import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROTECTED_XATTR_KEYS } from "./metadata";
import {
  MetadataServiceError,
  NamespaceMetadataService,
} from "./metadata-service";
import { adoptEntry, ancestorPaths, isAdoptable } from "./namespace-adoption";
import type { XattrBackend } from "./xattr";

/** In-memory xattrs keyed by absolute path — the filesystem itself is real. */
function memoryXattr(): XattrBackend & {
  seed: (path: string, values: Record<string, string>) => void;
} {
  const store = new Map<string, Map<string, string>>();
  return {
    seed(path, values) {
      store.set(path, new Map(Object.entries(values)));
    },
    async get(path, key) {
      return store.get(path)?.get(key) ?? null;
    },
    async list(path) {
      return Object.fromEntries(store.get(path) ?? new Map());
    },
    async set(path, key, value) {
      const existing = store.get(path) ?? new Map<string, string>();
      existing.set(key, value);
      store.set(path, existing);
    },
    async remove(path, key) {
      store.get(path)?.delete(key);
    },
  };
}

const OWNER = "08a8066a-79b5-427a-b368-7feb6c473aa4";

function identity(id: string, ownerId: string | null): Record<string, string> {
  return {
    [PROTECTED_XATTR_KEYS.id]: id,
    [PROTECTED_XATTR_KEYS.createdAt]: "2026-07-25T23:25:33.454Z",
    [PROTECTED_XATTR_KEYS.schemaVersion]: "1",
    ...(ownerId
      ? { [PROTECTED_XATTR_KEYS.ownerId]: ownerId }
      : { [PROTECTED_XATTR_KEYS.scope]: "shared" }),
  };
}

describe("ancestorPaths", () => {
  it("walks nearest first and ends at the root", () => {
    expect(ancestorPaths("a/b/c.pdf")).toEqual(["a/b", "a", "/"]);
    expect(ancestorPaths("top.pdf")).toEqual(["/"]);
    expect(ancestorPaths("/")).toEqual([]);
  });
});

describe("isAdoptable", () => {
  it("accepts only a total absence of identity", () => {
    expect(isAdoptable("NO_IDENTITY")).toBe(true);
    // Something is present but unreadable; a share link may already sign for it.
    expect(isAdoptable("MALFORMED_IDENTITY")).toBe(false);
    expect(isAdoptable("IDENTITY_CONFLICT")).toBe(false);
    expect(isAdoptable("NOT_FOUND")).toBe(false);
  });
});

describe("adoptEntry", () => {
  let root: string;
  let xattr: ReturnType<typeof memoryXattr>;
  let service: NamespaceMetadataService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "adoption-"));
    xattr = memoryXattr();
    service = new NamespaceMetadataService(root, xattr);
    await mkdir(join(root, "account", "nested"), { recursive: true });
    xattr.seed(
      join(root, "account"),
      identity("11111111-1111-4111-8111-111111111111", OWNER),
    );
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("inherits the owner from the nearest identified ancestor", async () => {
    await writeFile(join(root, "account", "dropped.pdf"), "bytes");

    const result = await adoptEntry(service, "account/dropped.pdf");

    expect(result.attribution).toEqual({
      fromRelativePath: "account",
      ownerId: OWNER,
    });
    expect(result.entry.metadata.ownerId).toBe(OWNER);
    expect(result.entry.metadata.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("skips an unidentified parent and keeps walking up", async () => {
    await writeFile(join(root, "account", "nested", "deep.txt"), "bytes");

    const result = await adoptEntry(service, "account/nested/deep.txt");

    // `account/nested` has no identity of its own, so the owner comes from the
    // account root above it rather than the adoption failing.
    expect(result.attribution.fromRelativePath).toBe("account");
    expect(result.entry.metadata.ownerId).toBe(OWNER);
  });

  it("dates the entry from its mtime, not from the scan that found it", async () => {
    const path = join(root, "account", "old.txt");
    await writeFile(path, "bytes");
    const observed = await service.observe("account/old.txt");

    const result = await adoptEntry(service, "account/old.txt");

    expect(result.entry.metadata.createdAt).toBe(
      observed.modifiedAt.toISOString(),
    );
  });

  it("inherits shared scope rather than an owner under the shared root", async () => {
    await mkdir(join(root, "shared"), { recursive: true });
    xattr.seed(
      join(root, "shared"),
      identity("22222222-2222-4222-8222-222222222222", null),
    );
    await writeFile(join(root, "shared", "team.txt"), "bytes");

    const result = await adoptEntry(service, "shared/team.txt");

    expect(result.entry.metadata.ownerId).toBeNull();
    expect(result.entry.metadata.scope).toBe("shared");
  });

  it("refuses to overwrite an entry that already carries identity", async () => {
    const path = join(root, "account", "owned.txt");
    await writeFile(path, "bytes");
    xattr.seed(path, identity("33333333-3333-4333-8333-333333333333", OWNER));

    // The whole point: a wrong or unreadable id is a problem to look at, never
    // a blank to fill, because a share link may already sign for those bytes.
    expect(adoptEntry(service, "account/owned.txt")).rejects.toThrow(
      /already carries/,
    );
  });

  it("refuses when no ancestor carries identity", async () => {
    await mkdir(join(root, "orphan"), { recursive: true });
    await writeFile(join(root, "orphan", "stray.txt"), "bytes");

    let code: string | null = null;
    try {
      await adoptEntry(service, "orphan/stray.txt");
    } catch (error) {
      code = error instanceof MetadataServiceError ? error.code : "OTHER";
    }

    expect(code).toBe("NO_IDENTITY");
  });
});
