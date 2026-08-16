import { describe, expect, it } from "bun:test";

import type { Folder } from "../db/schema";
import type { ProtectedMetadata } from "./metadata";
import { MetadataClientError } from "./metadata-client";
import type { MetadataEntryPayload } from "./metadata-protocol";
import { ensureRootIdentity } from "./service";

const OWNER = "d1a94f94-f148-4010-9e8d-f771980f3822";
const ROOT_ID = "4976dfe1-4a9d-4387-b5a6-76ad3a94c222";
const CREATED_AT = new Date("2026-08-14T16:44:27.698Z");

function root(overrides: Partial<Folder> = {}): Folder {
  return {
    createdAt: CREATED_AT,
    id: ROOT_ID,
    name: OWNER,
    ownerId: OWNER,
    parentId: null,
    path: `/${OWNER}`,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

/** Records what was stamped; the wire payload is irrelevant to these tests. */
function recordingClient(onAssign?: () => never): {
  assign: (
    relativePath: string,
    metadata: ProtectedMetadata,
  ) => Promise<MetadataEntryPayload>;
  calls: { relativePath: string; metadata: ProtectedMetadata }[];
} {
  const calls: { relativePath: string; metadata: ProtectedMetadata }[] = [];
  return {
    calls,
    async assign(relativePath, metadata) {
      calls.push({ metadata, relativePath });
      if (onAssign) onAssign();
      return {} as MetadataEntryPayload;
    },
  };
}

describe("storage root identity", () => {
  it("stamps a user root with the row's own id and creation time", async () => {
    const client = recordingClient();
    await ensureRootIdentity(client, root());

    expect(client.calls).toHaveLength(1);
    const [call] = client.calls;
    expect(call?.relativePath).toBe(`/${OWNER}`);
    // The row and the xattr have to agree: a root stamped with a fresh id
    // would leave the projector adopting a second identity for one directory.
    expect(call?.metadata.id).toBe(ROOT_ID);
    expect(call?.metadata.ownerId).toBe(OWNER);
    expect(call?.metadata.createdAt).toBe("2026-08-14T16:44:27.698Z");
    expect(call?.metadata.scope).toBeUndefined();
  });

  it("marks the ownerless shared root as shared rather than owning it", async () => {
    const client = recordingClient();
    await ensureRootIdentity(
      client,
      root({ name: "shared", ownerId: null, path: "/shared" }),
    );

    const [call] = client.calls;
    expect(call?.metadata.ownerId).toBeNull();
    // `readMetadata` rejects a missing owner unless the scope says shared.
    expect(call?.metadata.scope).toBe("shared");
  });

  it("does nothing in legacy mode, where there is no namespace to stamp", async () => {
    await expect(ensureRootIdentity(null, root())).resolves.toBeUndefined();
  });

  it("does not fail the caller when the metadata service refuses", async () => {
    const client = recordingClient(() => {
      throw new MetadataClientError("socket is down", "UNAVAILABLE");
    });

    // Listing a user's storage may not depend on an xattr write succeeding:
    // the row and the directory are already consistent and the next call
    // retries, while the projector keeps reporting the entry until it lands.
    await expect(ensureRootIdentity(client, root())).resolves.toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });
});
