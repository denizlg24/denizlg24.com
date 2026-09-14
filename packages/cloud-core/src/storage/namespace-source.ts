import { join } from "node:path";

import type { NamespaceMetadataClient } from "./metadata-client";
import {
  MetadataClientError,
  type MetadataEntryPayload,
} from "./metadata-protocol";
import type { NamespaceEntry, NamespaceListing } from "./metadata-service";
import type {
  AdoptionOutcome,
  ApplierSource,
  IdentityClaim,
} from "./namespace-applier";
import type { NamespaceSource } from "./namespace-projector";

/**
 * Presents the privileged metadata service to the projector.
 *
 * The wire payload deliberately omits the host path — leaking the branch layout
 * to the unprivileged side is the thing the socket protocol exists to prevent —
 * but the projection stores a `diskPath` per row. That column is filled with
 * the broker-mounted path this process would actually open, which in
 * broker-mounted mode is what `resolveFilePath` computes anyway. Writing the
 * host's path instead would record something no container can open, and
 * describe a filesystem layout the API is not entitled to know.
 */
export function createNamespaceSource(
  client: NamespaceMetadataClient,
  requestRootPath: string,
  /**
   * Maps an SMB principal to the account it belongs to.
   *
   * Lives here rather than in the metadata service because that service never
   * touches PostgreSQL — it is the privileged host component, and giving it a
   * database handle would widen it from "reads xattrs" to "reads the platform".
   * So the API asks who wrote the path, resolves the principal itself, and
   * hands the answer back down.
   */
  resolvePrincipalOwner?: (principal: string) => Promise<string | null>,
): NamespaceSource & ApplierSource {
  const toEntry = (payload: MetadataEntryPayload): NamespaceEntry => ({
    absolutePath: join(requestRootPath, payload.relativePath),
    kind: payload.kind,
    metadata: payload.metadata,
    modifiedAt: new Date(payload.modifiedAt),
    protectedXattrHash: payload.protectedXattrHash,
    relativePath: payload.relativePath,
    sizeBytes: payload.sizeBytes,
  });

  return {
    async branchMarkers() {
      return client.branchMarkers();
    },
    async stat(relativePath: string): Promise<NamespaceEntry> {
      return toEntry(await client.stat(relativePath));
    },
    async adopt(
      relativePath: string,
      claim?: IdentityClaim,
    ): Promise<AdoptionOutcome> {
      if (claim) {
        // The projection already names this entry, so stamping is saying
        // rather than guessing — `assign` is the same call the API's own
        // writers make. Losing the race to another stamp is not a failure:
        // the entry has identity now, and a plain stat reads it.
        try {
          await client.assign(relativePath, {
            createdAt: claim.createdAt.toISOString(),
            id: claim.id,
            ownerId: claim.ownerId,
            ...(claim.ownerId ? {} : { scope: "shared" as const }),
          });
        } catch (error) {
          if (
            !(
              error instanceof MetadataClientError &&
              error.code === "IDENTITY_CONFLICT"
            )
          ) {
            throw error;
          }
        }
        return {
          attribution: {
            fromRelativePath: null,
            ownerId: claim.ownerId,
            via: "projection",
          },
          entry: toEntry(await client.stat(relativePath)),
        };
      }
      // A miss here is "unknown", never "nobody": the audit stream is a log with
      // a retention window, so anything older than it falls through to the tree.
      let ownerId: string | undefined;
      if (resolvePrincipalOwner) {
        const writer = await client.auditWriter(relativePath).catch(() => null);
        if (writer) {
          ownerId =
            (await resolvePrincipalOwner(writer.principal).catch(() => null)) ??
            undefined;
        }
      }
      const result = await client.adopt(relativePath, ownerId);
      return {
        attribution: result.attribution,
        entry: toEntry(result.entry),
      };
    },
    async list(relativePath: string): Promise<NamespaceListing> {
      const listing = await client.list(relativePath);
      return {
        entries: listing.entries.map(toEntry),
        problems: listing.problems,
      };
    },
  };
}
