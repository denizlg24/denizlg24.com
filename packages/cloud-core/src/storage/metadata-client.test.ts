import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MetadataClientError,
  NamespaceMetadataClient,
} from "./metadata-client";
import {
  handleMetadataRequest,
  isSupportedProtocolVersion,
  tokenMatches,
} from "./metadata-handler";
import { NamespaceMetadataService } from "./metadata-service";
import { InMemoryXattrBackend } from "./xattr";

const roots: string[] = [];
const servers: { stop: () => void }[] = [];
const token = "a-sufficiently-long-token";
const ownerId = "30000000-0000-4000-8000-000000000003";
const fileId = "50000000-0000-4000-8000-000000000006";
const createdAt = "2026-07-02T10:00:00Z";
const checksum = "a".repeat(64);

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Mirrors apps/storage-metadata so the wire contract is tested, not mocked. */
async function serve(options: { mounted?: boolean } = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "metadata-socket-")),
  );
  roots.push(root);
  await mkdir(join(root, "ns", "acct"), { recursive: true });
  await writeFile(join(root, "ns", "acct", "note.txt"), "bytes");
  const service = new NamespaceMetadataService(
    join(root, "ns"),
    new InMemoryXattrBackend(),
  );
  const socketPath = join(root, "metadata.sock");
  const mounted = options.mounted ?? true;

  const server = Bun.serve({
    async fetch(request) {
      if (!tokenMatches(token, request.headers.get("x-metadata-token"))) {
        return Response.json(
          { code: "BAD_REQUEST", message: "Bad token", ok: false },
          { status: 403 },
        );
      }
      if (
        !isSupportedProtocolVersion(request.headers.get("x-metadata-version"))
      ) {
        return Response.json(
          { code: "BAD_REQUEST", message: "Bad version", ok: false },
          { status: 400 },
        );
      }
      if (!mounted) {
        return Response.json(
          { code: "UNAVAILABLE", message: "Not mounted", ok: false },
          { status: 503 },
        );
      }
      const response = await handleMetadataRequest(
        service,
        await request.json(),
      );
      return Response.json(response, { status: response.ok ? 200 : 409 });
    },
    unix: socketPath,
  });
  servers.push(server);
  return {
    client: new NamespaceMetadataClient({ socketPath, token }),
    socketPath,
  };
}

describe("metadata client over a unix socket", () => {
  it("round-trips assign, stat and verify", async () => {
    const { client } = await serve();
    const assigned = await client.assign("acct/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      mimeType: "text/plain",
      ownerId,
    });
    expect(assigned).toMatchObject({
      kind: "file",
      metadata: { id: fileId, mimeType: "text/plain" },
      relativePath: "acct/note.txt",
      sizeBytes: 5,
    });
    expect(typeof assigned.modifiedAt).toBe("string");

    expect((await client.stat("acct/note.txt")).metadata.id).toBe(fileId);
    expect((await client.verify("acct/note.txt", fileId)).metadata.id).toBe(
      fileId,
    );
  });

  it("surfaces a server-side code rather than a generic failure", async () => {
    const { client } = await serve();
    await client.assign("acct/note.txt", {
      checksum,
      createdAt,
      id: fileId,
      ownerId,
    });
    try {
      await client.verify(
        "acct/note.txt",
        "50000000-0000-4000-8000-000000000099",
      );
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(MetadataClientError);
      expect((error as MetadataClientError).code).toBe("ID_MISMATCH");
    }
  });

  it("fails closed when the namespace is not mounted", async () => {
    const { client } = await serve({ mounted: false });
    try {
      await client.stat("acct/note.txt");
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as MetadataClientError).code).toBe("UNAVAILABLE");
    }
  });

  it("reports an unreachable service as UNAVAILABLE, never as a missing entry", async () => {
    const client = new NamespaceMetadataClient({
      socketPath: "/tmp/definitely-not-a-metadata-socket.sock",
      token,
      timeoutMs: 500,
    });
    try {
      await client.stat("acct/note.txt");
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(MetadataClientError);
      // NOT_FOUND here would let a caller conclude the entry was deleted.
      expect((error as MetadataClientError).code).toBe("UNAVAILABLE");
    }
  });

  it("is rejected when the token is wrong", async () => {
    const { socketPath } = await serve();
    const client = new NamespaceMetadataClient({
      socketPath,
      token: "wrong-token-here",
    });
    try {
      await client.stat("acct/note.txt");
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as MetadataClientError).code).toBe("BAD_REQUEST");
    }
  });
});
