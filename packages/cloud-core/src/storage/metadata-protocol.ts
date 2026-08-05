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
  | { op: "checksum"; relativePath: string; checksum: string };

export interface MetadataListingPayload {
  entries: MetadataEntryPayload[];
  problems: { code: string; relativePath: string }[];
}

export type MetadataResponse =
  | { ok: true; entry: MetadataEntryPayload }
  | { ok: true; listing: MetadataListingPayload }
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
