import { randomUUID } from "node:crypto";

import type { ProtectedMetadata } from "./metadata";
import type { ResolvedEntry } from "./metadata-resolve";
import {
  MetadataServiceError,
  type NamespaceEntry,
  type NamespaceMetadataService,
} from "./metadata-service";

/**
 * The owner an unstamped entry inherits, and the ancestor it came from.
 *
 * The ancestor is reported so a caller can say *why* an entry was attributed
 * where it was; adoption is the one operation here that invents durable
 * identity, and an unexplained owner is not reviewable after the fact.
 */
export interface AdoptionAttribution {
  /** The ancestor an owner was inherited from; null when the audit supplied it. */
  fromRelativePath: string | null;
  ownerId: string | null;
  via: "audit" | "ancestor";
}

export interface AdoptionResult {
  attribution: AdoptionAttribution;
  entry: NamespaceEntry;
}

/**
 * The parent chain of a namespace-relative path, nearest first, ending at the
 * root. `"a/b/c.pdf"` yields `["a/b", "a", "/"]`.
 */
export function ancestorPaths(relativePath: string): string[] {
  const trimmed = relativePath.replace(/^\/+|\/+$/g, "");
  if (trimmed.length === 0) return [];
  const segments = trimmed.split("/");
  const ancestors: string[] = [];
  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    ancestors.push(segments.slice(0, depth).join("/"));
  }
  ancestors.push("/");
  return ancestors;
}

/**
 * Assigns identity to an entry that has none.
 *
 * This is the "explicit rule" the plan reserves: missing identity never causes
 * deletion, and it is only ever *assigned* under a stated policy rather than
 * guessed at the point of use.
 *
 * Owner comes from the SMB audit stream when it can, and from the tree when it
 * cannot. The file itself never carries the answer: every share sets
 * `force user`, so an entry records uid 1000 whichever device wrote it.
 *
 * The audit stream is the better evidence — it names the authenticated
 * principal — but it is a log, so it only covers writes still inside its
 * retention window. Inheritance covers the rest: `[Personal]` resolves its path
 * through a per-principal include naming that account's own root, and an
 * unprovisioned principal falls through to a path that does not exist, so a
 * device can only create entries inside its own subtree. There the subtree *is*
 * the credential, and unlike the credential it is still there hours later.
 *
 * Inheritance runs out in exactly one place, which is why the audit path exists:
 * a file dropped straight into the shared root has one ancestor and it is
 * deliberately ownerless, while `files.owner_id` is NOT NULL.
 *
 * Two things are deliberately refused rather than handled:
 *
 * - An entry that already carries an id. `MALFORMED_IDENTITY` means something is
 *   present but unreadable, and overwriting it would mint a second identity for
 *   bytes a share link may already sign for. A wrong id is a problem to be
 *   looked at, not a blank to be filled.
 * - An entry with no identified ancestor. That means the walk reached the
 *   namespace root without finding an owner, so there is no evidence of who the
 *   entry belongs to and inventing one would put a stranger's file in an
 *   account.
 */
export async function adoptEntry(
  service: NamespaceMetadataService,
  relativePath: string,
  /**
   * Owner recovered from the SMB audit stream, when one was found.
   *
   * Takes precedence over the tree because it is the better evidence: it names
   * the credential that actually wrote the entry, where inheritance only says
   * where it landed. It is also the only answer available for a file dropped
   * straight into the shared root, whose one ancestor is deliberately ownerless.
   */
  auditOwnerId?: string | null,
): Promise<AdoptionResult> {
  const existingId = await service.readIdentityId(relativePath);
  if (existingId) {
    throw new MetadataServiceError(
      `${relativePath} already carries ${existingId}; adoption never overwrites identity`,
      "IDENTITY_CONFLICT",
    );
  }

  const observed = await service.observe(relativePath);
  if (auditOwnerId) {
    return finish(service, relativePath, observed, {
      fromRelativePath: null,
      ownerId: auditOwnerId,
      via: "audit",
    });
  }
  // `files.owner_id` is NOT NULL where `folders.owner_id` is not, and the
  // namespace agrees: only the shared *root* is ownerless, while everything
  // inside it carries the owner of whoever put it there. So a file may not
  // inherit the shared root's absent owner — it has to keep looking, and
  // refuse if nothing above supplies one.
  const attribution = await inheritedOwner(
    service,
    relativePath,
    observed.kind === "file",
  );

  return finish(service, relativePath, observed, attribution);
}

async function finish(
  service: NamespaceMetadataService,
  relativePath: string,
  observed: ResolvedEntry,
  attribution: AdoptionAttribution,
): Promise<AdoptionResult> {
  const metadata: ProtectedMetadata = {
    // No birthtime is portable enough to trust here, and mtime is the oldest
    // defensible claim the filesystem still makes about the bytes. Minting
    // `now` instead would date every adopted file to the scan that found it.
    createdAt: observed.modifiedAt.toISOString(),
    id: randomUUID(),
    ownerId: attribution.ownerId,
    ...(attribution.ownerId ? {} : { scope: "shared" as const }),
  };

  return { attribution, entry: await service.assign(relativePath, metadata) };
}

async function inheritedOwner(
  service: NamespaceMetadataService,
  relativePath: string,
  requireOwner: boolean,
): Promise<AdoptionAttribution> {
  for (const ancestor of ancestorPaths(relativePath)) {
    let entry: NamespaceEntry;
    try {
      entry = await service.stat(ancestor);
    } catch {
      // An ancestor that is itself unreadable proves nothing either way; keep
      // walking. If none of them resolves, the throw below is the answer.
      continue;
    }
    if (requireOwner && !entry.metadata.ownerId) continue;
    return {
      fromRelativePath: ancestor,
      ownerId: entry.metadata.ownerId,
      via: "ancestor",
    };
  }
  throw new MetadataServiceError(
    requireOwner
      ? `${relativePath} has no ancestor carrying an owner; a file dropped straight into the shared root cannot be attributed from the tree`
      : `${relativePath} has no ancestor carrying identity; refusing to invent an owner`,
    "NO_IDENTITY",
  );
}

/** Only a total absence of identity is adoptable. */
export function isAdoptable(code: string): boolean {
  return code === "NO_IDENTITY";
}
