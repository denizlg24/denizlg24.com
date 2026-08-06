import type { ProtectedMetadata } from "./metadata";
import type { MetadataFailure } from "./metadata-service";

/**
 * The wire contract between the unprivileged API and the privileged metadata
 * service. Deliberately tiny: every operation names one namespace-relative
 * path, and none of them accepts an absolute or branch path, so a compromised
 * API cannot ask for anything outside the namespace.
 */
export const METADATA_PROTOCOL_VERSION = 1;

export interface MetadataEntryPayload {
  kind: "file" | "folder";
  metadata: ProtectedMetadata;
  modifiedAt: string;
  protectedXattrHash: string;
  relativePath: string;
  sizeBytes: number;
}

export type MetadataRequest =
  | { op: "stat"; relativePath: string }
  | { op: "list"; relativePath: string }
  | { op: "verify"; relativePath: string; expectedId: string }
  | { op: "assign"; relativePath: string; metadata: ProtectedMetadata }
  | { op: "checksum"; relativePath: string; checksum: string }
  // Assigns identity to an entry that has none. Only the privileged service can
  // do this, and only it can read an unstamped entry's timestamps at all.
  | { op: "adopt"; relativePath: string; ownerId?: string }
  // Who the SMB audit stream says last wrote a path. Read-only, and a miss is
  // "unknown" rather than "nobody": the stream is a log with a retention window.
  | { op: "audit-writer"; relativePath: string }
  // SMB account provisioning. Samba's passdb lives on the host, so the
  // unprivileged API can only ask; the privileged agent performs it. The
  // secret crosses this socket once and is never stored on the API side.
  | {
      op: "smb-provision";
      accountId: string;
      principal: string;
      secret: string;
    }
  | { op: "smb-revoke"; principal: string }
  // Branch mount proof for the projector. Names no path: the branch roots are
  // the host's own configuration, and the API is never told where they are.
  | { op: "branch-markers" };

export interface MetadataListingPayload {
  entries: MetadataEntryPayload[];
  problems: { code: MetadataFailure; relativePath: string }[];
}

export type MetadataResponse =
  | { ok: true; entry: MetadataEntryPayload }
  | {
      ok: true;
      adopted: {
        fromRelativePath: string | null;
        ownerId: string | null;
        via: "audit" | "ancestor";
      };
      entry: MetadataEntryPayload;
    }
  | { ok: true; writer: { at: number; principal: string } | null }
  | { ok: true; provisioned: true }
  | { ok: true; listing: MetadataListingPayload }
  | { ok: true; branchMarkers: Record<string, string> }
  | {
      ok: false;
      code: MetadataFailure | "UNAVAILABLE" | "BAD_REQUEST";
      message: string;
    };

export class MetadataClientError extends Error {
  constructor(
    message: string,
    readonly code: MetadataFailure | "UNAVAILABLE" | "BAD_REQUEST",
  ) {
    super(message);
    this.name = "MetadataClientError";
  }
}
