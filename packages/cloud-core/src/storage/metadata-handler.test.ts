import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handleMetadataRequest,
  isSupportedProtocolVersion,
  tokenMatches,
} from "./metadata-handler";
import { NamespaceMetadataService } from "./metadata-service";
import { InMemoryXattrBackend } from "./xattr";

const roots: string[] = [];
const ownerId = "30000000-0000-4000-8000-000000000003";
const fileId = "50000000-0000-4000-8000-000000000006";
const createdAt = "2026-07-02T10:00:00Z";
const checksum = "a".repeat(64);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function service() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "metadata-rpc-")));
  roots.push(root);
  await mkdir(join(root, "acct"), { recursive: true });
  await writeFile(join(root, "acct", "note.txt"), "bytes");
  return new NamespaceMetadataService(root, new InMemoryXattrBackend());
}

describe("metadata request handling", () => {
  it("assigns then stats an entry over the protocol", async () => {
    const target = await service();
    const assigned = await handleMetadataRequest(target, {
      metadata: { checksum, createdAt, id: fileId, ownerId },
      op: "assign",
      relativePath: "acct/note.txt",
    });
    expect(assigned.ok).toBe(true);

    const stat = await handleMetadataRequest(target, {
      op: "stat",
      relativePath: "acct/note.txt",
    });
    expect(stat).toMatchObject({
      entry: { kind: "file", metadata: { id: fileId }, sizeBytes: 5 },
      ok: true,
    });
  });

  it("maps an ID mismatch and a missing entry to their own codes", async () => {
    const target = await service();
    await handleMetadataRequest(target, {
      metadata: { checksum, createdAt, id: fileId, ownerId },
      op: "assign",
      relativePath: "acct/note.txt",
    });

    expect(
      await handleMetadataRequest(target, {
        expectedId: "50000000-0000-4000-8000-000000000099",
        op: "verify",
        relativePath: "acct/note.txt",
      }),
    ).toMatchObject({ code: "ID_MISMATCH", ok: false });

    expect(
      await handleMetadataRequest(target, {
        op: "stat",
        relativePath: "acct/missing.txt",
      }),
    ).toMatchObject({ code: "NOT_FOUND", ok: false });
  });

  it("rejects a malformed request rather than guessing the operation", async () => {
    const target = await service();
    for (const body of [
      null,
      {},
      { op: "stat" },
      { op: "nope", relativePath: "acct" },
      { op: "verify", relativePath: "acct" },
      { checksum: 1, op: "checksum", relativePath: "acct" },
    ]) {
      expect(await handleMetadataRequest(target, body)).toMatchObject({
        code: "BAD_REQUEST",
        ok: false,
      });
    }
  });

  it("refuses a path that tries to leave the namespace", async () => {
    const target = await service();
    expect(
      await handleMetadataRequest(target, {
        op: "stat",
        relativePath: "../../etc/passwd",
      }),
    ).toMatchObject({ code: "INVALID_PATH", ok: false });
  });

  it("does not leak a host path in an unexpected failure", async () => {
    const broken = {
      stat() {
        throw new Error("ENOENT: /srv/deniz-cloud/storage/secret");
      },
    } as unknown as NamespaceMetadataService;
    const response = await handleMetadataRequest(broken, {
      op: "stat",
      relativePath: "acct",
    });
    expect(response).toMatchObject({ code: "UNAVAILABLE", ok: false });
    expect(JSON.stringify(response)).not.toContain("/srv/");
  });
});

describe("transport guards", () => {
  it("accepts only the current protocol version", () => {
    expect(isSupportedProtocolVersion("1")).toBe(true);
    expect(isSupportedProtocolVersion("2")).toBe(false);
    expect(isSupportedProtocolVersion(null)).toBe(false);
  });

  it("compares tokens without early-exiting on the first difference", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
    expect(tokenMatches("abc123", "abc124")).toBe(false);
    expect(tokenMatches("abc123", "abc")).toBe(false);
    expect(tokenMatches("abc123", null)).toBe(false);
  });
});
