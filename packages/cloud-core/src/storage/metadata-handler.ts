import {
  METADATA_PROTOCOL_VERSION,
  type MetadataEntryPayload,
  type MetadataRequest,
  type MetadataResponse,
} from "./metadata-protocol";
import { NamespaceResolveError } from "./metadata-resolve";
import type {
  NamespaceEntry,
  NamespaceMetadataService,
} from "./metadata-service";
import { MetadataServiceError } from "./metadata-service";

function payload(entry: NamespaceEntry): MetadataEntryPayload {
  return {
    kind: entry.kind,
    metadata: entry.metadata,
    modifiedAt: entry.modifiedAt.toISOString(),
    protectedXattrHash: entry.protectedXattrHash,
    relativePath: entry.relativePath,
    sizeBytes: entry.sizeBytes,
  };
}

function isRequest(value: unknown): value is MetadataRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.relativePath !== "string") return false;
  switch (candidate.op) {
    case "stat":
      return true;
    case "verify":
      return typeof candidate.expectedId === "string";
    case "checksum":
      return typeof candidate.checksum === "string";
    case "assign":
      return (
        typeof candidate.metadata === "object" && candidate.metadata !== null
      );
    default:
      return false;
  }
}

/**
 * Turns one protocol request into one response, mapping every internal failure
 * onto a stable code.
 *
 * Unknown errors deliberately collapse to UNAVAILABLE rather than leaking a
 * message: the caller is the API, but the blast radius of an error string that
 * embeds a host path is the whole namespace layout.
 */
export async function handleMetadataRequest(
  service: NamespaceMetadataService,
  body: unknown,
): Promise<MetadataResponse> {
  if (!isRequest(body)) {
    return {
      code: "BAD_REQUEST",
      message: "Unrecognised metadata request",
      ok: false,
    };
  }

  try {
    let entry: NamespaceEntry;
    switch (body.op) {
      case "stat":
        entry = await service.stat(body.relativePath);
        break;
      case "verify":
        entry = await service.verify(body.relativePath, body.expectedId);
        break;
      case "assign":
        entry = await service.assign(body.relativePath, body.metadata);
        break;
      case "checksum":
        entry = await service.recordChecksum(body.relativePath, body.checksum);
        break;
    }
    return { entry: payload(entry), ok: true };
  } catch (error) {
    if (
      error instanceof MetadataServiceError ||
      error instanceof NamespaceResolveError
    ) {
      return { code: error.code, message: error.message, ok: false };
    }
    return {
      code: "UNAVAILABLE",
      message: "Metadata operation failed",
      ok: false,
    };
  }
}

export function isSupportedProtocolVersion(header: string | null): boolean {
  return header === String(METADATA_PROTOCOL_VERSION);
}

/**
 * Constant-time-ish token comparison. The socket is already root-owned and
 * mode 0660, so the token is defence in depth against another container that
 * gains the bind mount, not the primary control.
 */
export function tokenMatches(
  expected: string,
  provided: string | null,
): boolean {
  if (!provided || expected.length !== provided.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return difference === 0;
}
