import {
  type ChecksumState,
  METADATA_SCHEMA_VERSION,
  PROTECTED_XATTR_KEYS,
  type ProtectedMetadata,
  protectedMetadataHash,
} from "./metadata";
import {
  NamespaceResolveError,
  type ResolvedEntry,
  resolveNamespacePath,
} from "./metadata-resolve";
import type { XattrBackend } from "./xattr";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type MetadataFailure =
  | "INVALID_PATH"
  | "SYMLINK"
  | "ESCAPE"
  | "NOT_FOUND"
  | "UNSUPPORTED_TYPE"
  | "NO_IDENTITY"
  | "MALFORMED_IDENTITY"
  | "IDENTITY_CONFLICT"
  | "ID_MISMATCH";

export class MetadataServiceError extends Error {
  constructor(
    message: string,
    readonly code: MetadataFailure,
  ) {
    super(message);
    this.name = "MetadataServiceError";
  }
}

export interface NamespaceEntry extends ResolvedEntry {
  metadata: ProtectedMetadata;
  protectedXattrHash: string;
  relativePath: string;
}

function requireUuid(
  value: string | null,
  label: string,
  path: string,
): string {
  if (!value) {
    throw new MetadataServiceError(
      `${label} is absent on ${path}`,
      "NO_IDENTITY",
    );
  }
  if (!UUID.test(value)) {
    throw new MetadataServiceError(
      `${label} is malformed on ${path}`,
      "MALFORMED_IDENTITY",
    );
  }
  return value;
}

/**
 * The privileged half of the namespace: the only component that reads or
 * writes protected metadata.
 *
 * It runs as root on the host against the merged mount. The API reaches it
 * over a unix socket and never touches xattrs itself — which is what lets the
 * unprivileged API identity verify an entry's identity without being able to
 * forge one.
 */
export class NamespaceMetadataService {
  constructor(
    private readonly root: string,
    private readonly xattr: XattrBackend,
  ) {}

  private async readMetadata(
    entry: ResolvedEntry,
    relativePath: string,
  ): Promise<NamespaceEntry> {
    const values = await this.xattr.list(entry.absolutePath);
    const id = requireUuid(
      values[PROTECTED_XATTR_KEYS.id] ?? null,
      "id",
      relativePath,
    );
    const createdAt = values[PROTECTED_XATTR_KEYS.createdAt];
    if (!createdAt) {
      throw new MetadataServiceError(
        `created_at is absent on ${relativePath}`,
        "NO_IDENTITY",
      );
    }
    if (
      values[PROTECTED_XATTR_KEYS.schemaVersion] !== METADATA_SCHEMA_VERSION
    ) {
      throw new MetadataServiceError(
        `Unexpected metadata schema on ${relativePath}`,
        "MALFORMED_IDENTITY",
      );
    }
    const rawOwner = values[PROTECTED_XATTR_KEYS.ownerId] ?? null;
    const scope = values[PROTECTED_XATTR_KEYS.scope];
    if (!rawOwner && scope !== "shared") {
      throw new MetadataServiceError(
        `Only the shared root may omit an owner: ${relativePath}`,
        "MALFORMED_IDENTITY",
      );
    }
    const ownerId = rawOwner
      ? requireUuid(rawOwner, "owner_id", relativePath)
      : null;

    const metadata: ProtectedMetadata = {
      createdAt,
      id,
      ownerId,
      ...(ownerId ? {} : { scope: "shared" as const }),
    };
    if (entry.kind === "file") {
      const checksum = values[PROTECTED_XATTR_KEYS.checksum];
      const state = values[PROTECTED_XATTR_KEYS.checksumState] as
        | ChecksumState
        | undefined;
      if (checksum) metadata.checksum = checksum;
      metadata.checksumState = state ?? "pending";
      const mimeType = values[PROTECTED_XATTR_KEYS.mimeType];
      if (mimeType) metadata.mimeType = mimeType;
    }

    return {
      ...entry,
      metadata,
      // A file whose checksum is still pending has no stable protected hash to
      // report; callers must treat it as unverified rather than cache it.
      protectedXattrHash:
        entry.kind === "file" && metadata.checksumState !== "verified"
          ? ""
          : protectedMetadataHash(metadata, entry.kind),
      relativePath,
    };
  }

  async stat(relativePath: string): Promise<NamespaceEntry> {
    const entry = await resolveNamespacePath(this.root, relativePath);
    return this.readMetadata(entry, relativePath);
  }

  /**
   * Confirms the entry at `relativePath` still carries `expectedId` before its
   * bytes are served.
   *
   * The ADR forbids a path-only check because a rename between lookup and open
   * serves the wrong file. This narrows that window but does not close it: the
   * caller must hold the opened handle across the check, so the identity it
   * verifies belongs to the entry it is about to stream.
   */
  async verify(
    relativePath: string,
    expectedId: string,
  ): Promise<NamespaceEntry> {
    const entry = await this.stat(relativePath);
    if (entry.metadata.id !== expectedId) {
      throw new MetadataServiceError(
        `Entry at ${relativePath} is ${entry.metadata.id}, not ${expectedId}`,
        "ID_MISMATCH",
      );
    }
    return entry;
  }

  /**
   * Stamps identity onto a newly published entry.
   *
   * Idempotent for the same ID so a retried create converges. A different ID
   * already present is a conflict, never an overwrite: that is either an SMB
   * copy that inherited metadata or a genuine collision, and both need repair
   * rather than a silent reassignment.
   */
  async assign(
    relativePath: string,
    metadata: ProtectedMetadata,
  ): Promise<NamespaceEntry> {
    if (!UUID.test(metadata.id)) {
      throw new MetadataServiceError(
        `Refusing to assign malformed id ${metadata.id}`,
        "MALFORMED_IDENTITY",
      );
    }
    const entry = await resolveNamespacePath(this.root, relativePath);
    const existing = await this.xattr.get(
      entry.absolutePath,
      PROTECTED_XATTR_KEYS.id,
    );
    if (existing && existing !== metadata.id) {
      throw new MetadataServiceError(
        `${relativePath} already carries ${existing}`,
        "IDENTITY_CONFLICT",
      );
    }

    await this.xattr.set(
      entry.absolutePath,
      PROTECTED_XATTR_KEYS.id,
      metadata.id,
    );
    await this.xattr.set(
      entry.absolutePath,
      PROTECTED_XATTR_KEYS.createdAt,
      metadata.createdAt,
    );
    await this.xattr.set(
      entry.absolutePath,
      PROTECTED_XATTR_KEYS.schemaVersion,
      METADATA_SCHEMA_VERSION,
    );
    if (metadata.ownerId) {
      await this.xattr.set(
        entry.absolutePath,
        PROTECTED_XATTR_KEYS.ownerId,
        metadata.ownerId,
      );
      await this.xattr.remove(entry.absolutePath, PROTECTED_XATTR_KEYS.scope);
    } else {
      await this.xattr.set(
        entry.absolutePath,
        PROTECTED_XATTR_KEYS.scope,
        "shared",
      );
      await this.xattr.remove(entry.absolutePath, PROTECTED_XATTR_KEYS.ownerId);
    }

    if (entry.kind === "file") {
      // An SMB write invalidates the checksum immediately; the projector
      // recomputes it. Reporting `pending` is what stops a stale ETag or share
      // response from being served against new bytes.
      const state: ChecksumState = metadata.checksum
        ? (metadata.checksumState ?? "verified")
        : "pending";
      await this.xattr.set(
        entry.absolutePath,
        PROTECTED_XATTR_KEYS.checksumState,
        state,
      );
      if (metadata.checksum) {
        await this.xattr.set(
          entry.absolutePath,
          PROTECTED_XATTR_KEYS.checksum,
          metadata.checksum.toLowerCase(),
        );
      }
      if (metadata.mimeType) {
        await this.xattr.set(
          entry.absolutePath,
          PROTECTED_XATTR_KEYS.mimeType,
          metadata.mimeType,
        );
      }
    }

    return this.readMetadata(entry, relativePath);
  }

  /** Records a recomputed checksum, moving the entry back to `verified`. */
  async recordChecksum(
    relativePath: string,
    checksum: string,
  ): Promise<NamespaceEntry> {
    const entry = await resolveNamespacePath(this.root, relativePath);
    if (entry.kind !== "file") {
      throw new MetadataServiceError(
        `${relativePath} is not a file`,
        "UNSUPPORTED_TYPE",
      );
    }
    await this.xattr.set(
      entry.absolutePath,
      PROTECTED_XATTR_KEYS.checksum,
      checksum.toLowerCase(),
    );
    await this.xattr.set(
      entry.absolutePath,
      PROTECTED_XATTR_KEYS.checksumState,
      "verified",
    );
    return this.readMetadata(entry, relativePath);
  }
}

export { NamespaceResolveError };
