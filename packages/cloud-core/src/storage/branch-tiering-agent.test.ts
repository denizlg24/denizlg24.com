import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BranchTieringAgent } from "./branch-tiering-agent";
import { PROTECTED_XATTR_KEYS } from "./metadata";
import { InMemoryXattrBackend } from "./xattr";

/**
 * Creating a symlink on Windows needs SeCreateSymbolicLinkPrivilege, which an
 * unelevated shell without Developer Mode does not hold — the fixture throws
 * EPERM before the assertion is reached. The traversal refusal being tested is
 * a property of the Linux deployment; CI runs it there.
 */
const CAN_SYMLINK = process.platform !== "win32";

const roots: string[] = [];
const fileId = "50000000-0000-4000-8000-000000000006";
// sha256 of "bytes"
const checksum =
  "b0d68ada4d4b1fd8d8e0e6c60d1f2b8ee6b8b39ab54cbd3e1cc0c9e1a0f5a58f";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function branches() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "branch-tier-")));
  roots.push(root);
  const ssd = join(root, "ssd");
  const hdd = join(root, "hdd");
  await mkdir(join(ssd, "acct"), { recursive: true });
  await mkdir(join(hdd, "acct"), { recursive: true });
  // Both branch roots must be non-empty: an empty one reads as unmounted, and
  // the agent refuses to answer from a branch it cannot prove is there.
  await writeFile(join(ssd, ".keep"), "");
  await writeFile(join(hdd, ".keep"), "");
  const xattr = new InMemoryXattrBackend();
  return {
    agent: new BranchTieringAgent({ hdd, ssd }, xattr),
    hdd,
    ssd,
    xattr,
  };
}

async function realChecksum(path: string): Promise<string> {
  const { computeChecksum } = await import("./fs");
  return computeChecksum(path);
}

describe("BranchTieringAgent", () => {
  it("reports which branch holds each path", async () => {
    const { agent, hdd, ssd } = await branches();
    await writeFile(join(ssd, "acct", "hot.bin"), "bytes");
    await writeFile(join(hdd, "acct", "cold.bin"), "bytes");

    expect(
      await agent.locate(["acct/hot.bin", "acct/cold.bin", "acct/gone.bin"]),
    ).toEqual([
      { duplicate: false, relativePath: "acct/hot.bin", tier: "ssd" },
      { duplicate: false, relativePath: "acct/cold.bin", tier: "hdd" },
      { duplicate: false, relativePath: "acct/gone.bin", tier: null },
    ]);
  });

  it("flags a path present on both branches as a duplicate", async () => {
    const { agent, hdd, ssd } = await branches();
    await writeFile(join(ssd, "acct", "both.bin"), "bytes");
    await writeFile(join(hdd, "acct", "both.bin"), "bytes");
    const [placement] = await agent.locate(["acct/both.bin"]);
    expect(placement?.duplicate).toBe(true);
  });

  it("publishes the bytes and carries identity across, then unlinks", async () => {
    const { agent, hdd, ssd, xattr } = await branches();
    const source = join(ssd, "acct", "note.bin");
    await writeFile(source, "bytes");
    await xattr.set(source, PROTECTED_XATTR_KEYS.id, fileId);
    await xattr.set(source, PROTECTED_XATTR_KEYS.checksum, checksum);

    const result = await agent.move({
      expectedChecksum: await realChecksum(source),
      expectedId: fileId,
      relativePath: "acct/note.bin",
      toTier: "hdd",
    });

    expect(result.outcome).toBe("moved");
    const destination = join(hdd, "acct", "note.bin");
    expect(await readFile(destination, "utf8")).toBe("bytes");
    // Identity is written onto the staged copy before it is published, so the
    // entry that appears on the HDD branch is the same file, not a new one.
    // Asserted through the backend's own map rather than the published path:
    // real xattrs travel with the inode through rename, the in-memory fake is
    // keyed by path and cannot.
    const staged = [...xattr.entries.entries()].find(
      ([path, values]) =>
        path.startsWith(join(hdd, "acct")) &&
        values.get(PROTECTED_XATTR_KEYS.id) === fileId,
    );
    expect(staged).toBeDefined();
    expect(staged?.[1].get(PROTECTED_XATTR_KEYS.checksum)).toBe(checksum);
    // The source is gone and no staging file was left behind: the merged view
    // has exactly one copy again.
    const { pathExists } = await import("./fs");
    expect(await pathExists(source)).toBe(false);
    // Awaited, not a floating `.resolves`: without the await the assertion is
    // scheduled and the test ends before it can fail.
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(join(hdd, "acct"))).toEqual(["note.bin"]);
  });

  it("refuses when the entry at the path is no longer the planned one", async () => {
    const { agent, ssd, xattr } = await branches();
    const source = join(ssd, "acct", "note.bin");
    await writeFile(source, "bytes");
    await xattr.set(
      source,
      PROTECTED_XATTR_KEYS.id,
      "99999999-0000-4000-8000-000000000009",
    );

    const result = await agent.move({
      expectedChecksum: await realChecksum(source),
      expectedId: fileId,
      relativePath: "acct/note.bin",
      toTier: "hdd",
    });
    expect(result.outcome).toBe("vanished");
    expect(result.reason).toBe("identity-changed");
  });

  it("reports a path already on the destination as placed, not moved", async () => {
    const { agent, hdd } = await branches();
    await writeFile(join(hdd, "acct", "note.bin"), "bytes");
    const result = await agent.move({
      expectedChecksum: checksum,
      expectedId: fileId,
      relativePath: "acct/note.bin",
      toTier: "hdd",
    });
    expect(result.outcome).toBe("already-placed");
  });

  it("quarantines rather than overwriting an existing destination", async () => {
    const { agent, hdd, ssd, xattr } = await branches();
    const source = join(ssd, "acct", "note.bin");
    await writeFile(source, "bytes");
    await writeFile(join(hdd, "acct", "note.bin"), "other bytes");
    await xattr.set(source, PROTECTED_XATTR_KEYS.id, fileId);

    const result = await agent.move({
      expectedChecksum: await realChecksum(source),
      expectedId: fileId,
      relativePath: "acct/note.bin",
      toTier: "hdd",
    });
    expect(result.outcome).toBe("quarantined");
    // Neither copy touched: that is what a quarantine is for.
    expect(await readFile(join(hdd, "acct", "note.bin"), "utf8")).toBe(
      "other bytes",
    );
    expect(await readFile(source, "utf8")).toBe("bytes");
  });

  it("defers rather than moving when a branch is unmounted", async () => {
    const { agent, hdd, ssd } = await branches();
    await writeFile(join(ssd, "acct", "note.bin"), "bytes");
    // An unmounted branch presents as an empty directory. Treating that as "the
    // file is not on the HDD" would migrate the namespace onto one disk.
    await rm(join(hdd, ".keep"));
    await rm(join(hdd, "acct"), { recursive: true });

    const result = await agent.move({
      expectedChecksum: checksum,
      expectedId: fileId,
      relativePath: "acct/note.bin",
      toTier: "hdd",
    });
    expect(result.outcome).toBe("deferred");
    expect(result.reason).toBe("branch-not-mounted");
    await expect(agent.usage()).rejects.toThrow("not mounted");
  });

  it("refuses a path that escapes the branch root", async () => {
    const { agent } = await branches();
    await expect(
      agent.move({
        expectedChecksum: checksum,
        expectedId: fileId,
        relativePath: "../outside.bin",
        toTier: "hdd",
      }),
    ).rejects.toThrow();
  });

  it.skipIf(!CAN_SYMLINK)(
    "refuses to traverse a symlinked directory component",
    async () => {
      const { agent, ssd } = await branches();
      // `namespaceSegments` rejects `..` but not this: the link resolves outside
      // the branch with no `..` anywhere in the path.
      await mkdir(join(ssd, "real"), { recursive: true });
      await symlink(join(ssd, "real"), join(ssd, "acct", "link"));
      await writeFile(join(ssd, "real", "note.bin"), "bytes");

      await expect(
        agent.move({
          expectedChecksum: checksum,
          expectedId: fileId,
          relativePath: "acct/link/note.bin",
          toTier: "hdd",
        }),
      ).rejects.toThrow(/Symlink/);
    },
  );

  it("quarantines rather than replacing a destination created during the copy", async () => {
    // The absence check happens before the copy; for a large file that gap is
    // minutes. `rename` would silently publish over whatever landed there, so
    // the publish uses `link` and takes the EEXIST as the atomic check.
    const { agent, hdd, ssd, xattr } = await branches();
    const source = join(ssd, "acct", "note.bin");
    await writeFile(source, "bytes");
    await xattr.set(source, PROTECTED_XATTR_KEYS.id, fileId);
    const expectedChecksum = await realChecksum(source);

    const racer = {
      async get(path: string, key: string) {
        const value = await xattr.get(path, key);
        // Fires on the pre-publish identity re-check, which is the last thing
        // the move does before linking.
        if (path === source && key === PROTECTED_XATTR_KEYS.id) {
          await writeFile(join(hdd, "acct", "note.bin"), "someone else").catch(
            () => {},
          );
        }
        return value;
      },
      list: xattr.list.bind(xattr),
      remove: xattr.remove.bind(xattr),
      set: xattr.set.bind(xattr),
    };
    const racing = new BranchTieringAgent(
      { hdd, ssd },
      racer as unknown as InMemoryXattrBackend,
    );

    const result = await racing.move({
      expectedChecksum,
      expectedId: fileId,
      relativePath: "acct/note.bin",
      toTier: "hdd",
    });
    expect(result.outcome).toBe("quarantined");
    // The interloper's bytes are intact and the source is untouched.
    expect(await readFile(join(hdd, "acct", "note.bin"), "utf8")).toBe(
      "someone else",
    );
    expect(await readFile(source, "utf8")).toBe("bytes");
    expect(await readdir(join(hdd, "acct"))).toEqual(["note.bin"]);
  });

  it("defers a second move for a path already being moved", async () => {
    const { agent, ssd, xattr } = await branches();
    const source = join(ssd, "acct", "note.bin");
    await writeFile(source, "bytes");
    await xattr.set(source, PROTECTED_XATTR_KEYS.id, fileId);
    const input = {
      expectedChecksum: await realChecksum(source),
      expectedId: fileId,
      relativePath: "acct/note.bin",
      toTier: "hdd" as const,
    };

    const [first, second] = await Promise.all([
      agent.move(input),
      agent.move(input),
    ]);
    const outcomes = [first?.outcome, second?.outcome].sort();
    expect(outcomes).toEqual(["deferred", "moved"]);
  });

  it("defers rather than moving a directory or a symlink at the path", async () => {
    const { agent, ssd } = await branches();
    await mkdir(join(ssd, "acct", "folder"), { recursive: true });
    const result = await agent.move({
      expectedChecksum: checksum,
      expectedId: fileId,
      relativePath: "acct/folder",
      toTier: "hdd",
    });
    expect(result.outcome).toBe("deferred");
    expect(result.reason).toBe("not-a-regular-file");
  });

  it("reports usage per branch role", async () => {
    const { agent } = await branches();
    const usage = await agent.usage();
    expect(usage.map((entry) => entry.tier).sort()).toEqual(["hdd", "ssd"]);
    for (const entry of usage) {
      expect(entry.totalBytes).toBeGreaterThan(0);
      expect(entry.usagePercent).toBeGreaterThanOrEqual(0);
    }
  });
});
