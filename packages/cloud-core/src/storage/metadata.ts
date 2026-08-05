import { createHash } from "node:crypto";

/**
 * The xattr namespace protected entry metadata lives in.
 *
 * Gate 1 proved that with `user.`, Samba accepts a client write to the stream
 * name `<file>:user.denizcloud.id`, stores it as a separate `user.DosStream.*`
 * xattr and returns that alias on read. The raw value stays intact, but a
 * round-trippable protected-looking alias is an ambiguous, spoofable metadata
 * channel, which this ADR treats as a hard boundary failure.
 *
 * `security.` closes that structurally rather than by filtering: writing a
 * `security.*` xattr requires CAP_SYS_ADMIN, and Samba's `streams_xattr` only
 * ever maps client streams into `user.*`. A client cannot name, write or read
 * one over SMB at all, and the unprivileged API identity cannot set one either
 * — which is exactly the split the ADR asks for.
 *
 * Switching this constant is the whole migration between the two namespaces;
 * every producer and consumer derives its key names from here. It stays `user.`
 * until Gate 1B measures mergerfs passthrough, backup/restore preservation and
 * CIFS behaviour on the Pi, because a namespace the tooling cannot carry is
 * worse than a spoofable one.
 */
export const PROTECTED_XATTR_NAMESPACE = "user." as const;

export const PROTECTED_XATTR_KEYS = {
  checksum: `${PROTECTED_XATTR_NAMESPACE}denizcloud.checksum`,
  checksumState: `${PROTECTED_XATTR_NAMESPACE}denizcloud.checksum_state`,
  createdAt: `${PROTECTED_XATTR_NAMESPACE}denizcloud.created_at`,
  id: `${PROTECTED_XATTR_NAMESPACE}denizcloud.id`,
  mimeType: `${PROTECTED_XATTR_NAMESPACE}denizcloud.mime_type`,
  ownerId: `${PROTECTED_XATTR_NAMESPACE}denizcloud.owner_id`,
  schemaVersion: `${PROTECTED_XATTR_NAMESPACE}denizcloud.schema_version`,
  scope: `${PROTECTED_XATTR_NAMESPACE}denizcloud.scope`,
} as const;

export const METADATA_SCHEMA_VERSION = "1" as const;

export type ChecksumState = "verified" | "pending" | "failed";

export interface ProtectedMetadata {
  checksum?: string;
  checksumState?: ChecksumState;
  createdAt: string;
  id: string;
  mimeType?: string | null;
  /** Null only on the shared root, which carries `scope` instead. */
  ownerId: string | null;
  scope?: "shared";
}

/**
 * The canonical byte form the protected-metadata hash is taken over: every
 * present key as `key=value\n`, ordered by key.
 *
 * Ordering is by the *suffix* rather than the full key so that changing
 * PROTECTED_XATTR_NAMESPACE cannot silently reorder the canonical string and
 * invalidate every previously recorded hash.
 */
const CANONICAL_ORDER = [
  "checksum",
  "checksumState",
  "createdAt",
  "id",
  "mimeType",
  "ownerId",
  "schemaVersion",
  "scope",
] as const satisfies readonly (keyof typeof PROTECTED_XATTR_KEYS)[];

export function protectedCanonicalForm(
  metadata: ProtectedMetadata,
  kind: "file" | "folder",
): string {
  const values = new Map<keyof typeof PROTECTED_XATTR_KEYS, string>();
  values.set("id", metadata.id);
  values.set("createdAt", metadata.createdAt);
  values.set("schemaVersion", METADATA_SCHEMA_VERSION);
  if (metadata.ownerId) {
    values.set("ownerId", metadata.ownerId);
  } else {
    values.set("scope", "shared");
  }
  if (kind === "file") {
    if (!metadata.checksum) {
      throw new Error(`File metadata has no checksum: ${metadata.id}`);
    }
    values.set("checksum", metadata.checksum.toLowerCase());
    values.set("checksumState", metadata.checksumState ?? "verified");
    if (metadata.mimeType) values.set("mimeType", metadata.mimeType);
  }
  return CANONICAL_ORDER.filter((key) => values.has(key))
    .map((key) => `${PROTECTED_XATTR_KEYS[key]}=${values.get(key)}\n`)
    .join("");
}

export function protectedMetadataHash(
  metadata: ProtectedMetadata,
  kind: "file" | "folder",
): string {
  return createHash("sha256")
    .update(protectedCanonicalForm(metadata, kind))
    .digest("hex");
}
