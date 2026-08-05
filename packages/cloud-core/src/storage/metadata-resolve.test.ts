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
import { join } from "node:path";

import {
  isReservedSegment,
  NamespaceResolveError,
  namespaceSegments,
  resolveNamespacePath,
} from "./metadata-resolve";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function namespace(): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "namespace-resolve-")),
  );
  roots.push(root);
  await mkdir(join(root, "acct", "docs"), { recursive: true });
  await writeFile(join(root, "acct", "docs", "note.txt"), "bytes");
  return root;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("expected a rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(NamespaceResolveError);
    expect((error as NamespaceResolveError).code).toBe(code as never);
  }
}

describe("namespace path segments", () => {
  it("accepts a plain relative path with or without a leading slash", () => {
    expect(namespaceSegments("acct/docs/note.txt")).toEqual([
      "acct",
      "docs",
      "note.txt",
    ]);
    expect(namespaceSegments("/acct/docs")).toEqual(["acct", "docs"]);
    expect(namespaceSegments("/")).toEqual([]);
  });

  it("rejects traversal rather than normalising it away", () => {
    // `a/../b` is not rewritten to `b`: a caller that produced `..` is not
    // describing the entry it thinks it is.
    expect(() => namespaceSegments("acct/../etc")).toThrow(
      NamespaceResolveError,
    );
    expect(() => namespaceSegments("./acct")).toThrow(NamespaceResolveError);
    expect(() => namespaceSegments("acct//docs")).toThrow(
      NamespaceResolveError,
    );
  });

  it("rejects NUL and embedded separators", () => {
    expect(() => namespaceSegments("acct/no\0pe")).toThrow("NUL");
    expect(() => namespaceSegments("acct/back\\slash")).toThrow(
      NamespaceResolveError,
    );
  });

  it("refuses names the namespace owns", () => {
    for (const reserved of [
      ".denizcloud-branch.json",
      ".denizcloud-mount-witness",
      "._resourcefork",
      ".abc.migration.partial",
      ".abc.reverse.partial",
    ]) {
      expect(isReservedSegment(reserved)).toBe(true);
      expect(() => namespaceSegments(`acct/${reserved}`)).toThrow(
        NamespaceResolveError,
      );
    }
    expect(isReservedSegment("normal.txt")).toBe(false);
  });
});

describe("resolving beneath the namespace root", () => {
  it("resolves a file and a folder with their stat facts", async () => {
    const root = await namespace();
    const file = await resolveNamespacePath(root, "acct/docs/note.txt");
    expect(file).toMatchObject({
      absolutePath: join(root, "acct", "docs", "note.txt"),
      kind: "file",
      sizeBytes: 5,
    });
    expect((await resolveNamespacePath(root, "acct")).kind).toBe("folder");
    expect((await resolveNamespacePath(root, "/")).kind).toBe("folder");
  });

  it("refuses to traverse a symlinked directory", async () => {
    const root = await namespace();
    const outside = await realpath(await mkdtemp(join(tmpdir(), "outside-")));
    roots.push(outside);
    await writeFile(join(outside, "secret.txt"), "not yours");
    await symlink(outside, join(root, "acct", "escape"));

    await expectCode(
      resolveNamespacePath(root, "acct/escape/secret.txt"),
      "SYMLINK",
    );
    await expectCode(resolveNamespacePath(root, "acct/escape"), "SYMLINK");
  });

  it("refuses a symlinked leaf even though it resolves inside the root", async () => {
    const root = await namespace();
    await symlink(
      join(root, "acct", "docs", "note.txt"),
      join(root, "acct", "alias.txt"),
    );
    await expectCode(resolveNamespacePath(root, "acct/alias.txt"), "SYMLINK");
  });

  it("reports a missing entry distinctly from a rejected one", async () => {
    const root = await namespace();
    await expectCode(resolveNamespacePath(root, "acct/missing"), "NOT_FOUND");
    await expectCode(
      resolveNamespacePath(root, "acct/docs/note.txt/deeper"),
      "NOT_FOUND",
    );
  });

  it("rejects a path that would leave the root", async () => {
    const root = await namespace();
    await expectCode(resolveNamespacePath(root, "../outside"), "INVALID_PATH");
  });
});
