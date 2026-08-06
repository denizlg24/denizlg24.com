import { randomUUID } from "node:crypto";

import type { ProtectedMetadata } from "./metadata";
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
  fromRelativePath: string;
  ownerId: string | null;
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
 * Owner is inherited from the nearest ancestor that already carries identity,
 * which is what makes this equivalent to attributing the write to the credential
 * that made it. Samba gives every share `force user`, so the file itself records
 * uid 1000 no matter which device wrote it — but `[Personal]` resolves its path
 * through a per-principal include naming that account's own root, and an
 * unprovisioned principal falls through to a path that does not exist. A device
 * can therefore only create entries inside its own account subtree or `shared`,
 * so the subtree an orphan is found in *is* the credential that produced it.
 * Unlike the credential, the subtree is still there hours later, which is when
 * a scan actually looks.
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
): Promise<AdoptionResult> {
  const existingId = await service.readIdentityId(relativePath);
  if (existingId) {
    throw new MetadataServiceError(
      `${relativePath} already carries ${existingId}; adoption never overwrites identity`,
      "IDENTITY_CONFLICT",
    );
  }

  const attribution = await inheritedOwner(service, relativePath);
  const observed = await service.observe(relativePath);

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
    return {
      fromRelativePath: ancestor,
      ownerId: entry.metadata.ownerId,
    };
  }
  throw new MetadataServiceError(
    `${relativePath} has no ancestor carrying identity; refusing to invent an owner`,
    "NO_IDENTITY",
  );
}

/** Only a total absence of identity is adoptable. */
export function isAdoptable(code: string): boolean {
  return code === "NO_IDENTITY";
}
