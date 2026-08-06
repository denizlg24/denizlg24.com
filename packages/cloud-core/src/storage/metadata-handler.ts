import type { BranchTieringAgent } from "./branch-tiering-agent";
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
import { adoptEntry } from "./namespace-adoption";

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

/**
 * Bounds one `tier-locate` so a batch cannot become an unbounded stat storm on
 * the host. The pass reads its lookahead in chunks rather than one request.
 */
export const TIER_LOCATE_MAX_PATHS = 1_000;

function isRequest(value: unknown): value is MetadataRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  // The SMB and branch-marker operations name no namespace path.
  const isPathless =
    candidate.op === "smb-provision" ||
    candidate.op === "smb-revoke" ||
    candidate.op === "branch-markers" ||
    candidate.op === "branch-usage" ||
    candidate.op === "tier-locate";
  if (!isPathless && typeof candidate.relativePath !== "string") return false;
  switch (candidate.op) {
    case "branch-markers":
    case "branch-usage":
      return true;
    case "tier-locate":
      return (
        Array.isArray(candidate.relativePaths) &&
        candidate.relativePaths.length <= TIER_LOCATE_MAX_PATHS &&
        candidate.relativePaths.every((path) => typeof path === "string")
      );
    case "tier-move":
      return (
        (candidate.toTier === "ssd" || candidate.toTier === "hdd") &&
        typeof candidate.expectedId === "string" &&
        typeof candidate.expectedChecksum === "string"
      );
    case "smb-provision":
      return (
        typeof candidate.accountId === "string" &&
        typeof candidate.principal === "string" &&
        typeof candidate.secret === "string"
      );
    case "smb-revoke":
      return typeof candidate.principal === "string";
    case "stat":
    case "list":
    case "audit-writer":
      return true;
    case "adopt":
      return (
        candidate.ownerId === undefined || typeof candidate.ownerId === "string"
      );
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
export interface SmbProvisioningAgent {
  provision(input: {
    accountId: string;
    principal: string;
    secret: string;
  }): Promise<void>;
  revoke(principal: string): Promise<void>;
}

export async function handleMetadataRequest(
  service: NamespaceMetadataService,
  body: unknown,
  smb?: SmbProvisioningAgent,
  branchMarkers?: () => Promise<Record<string, string>>,
  auditWriters?: (
    relativePath: string,
  ) => { at: number; principal: string } | null,
  tiering?: BranchTieringAgent,
): Promise<MetadataResponse> {
  if (!isRequest(body)) {
    return {
      code: "BAD_REQUEST",
      message: "Unrecognised metadata request",
      ok: false,
    };
  }

  try {
    if (body.op === "branch-markers") {
      // An absent provider answers with no markers rather than an error: the
      // projector reads an empty map as "cannot prove the branches held" and
      // withholds every deletion, which is the safe reading of not knowing.
      return {
        branchMarkers: branchMarkers ? await branchMarkers() : {},
        ok: true,
      };
    }
    if (
      body.op === "branch-usage" ||
      body.op === "tier-locate" ||
      body.op === "tier-move"
    ) {
      // A host with no branch roles configured has not deployed tiering yet.
      // UNAVAILABLE makes the pass report itself blocked; anything else would
      // have it treat "not set up" as "nothing to move".
      if (!tiering) {
        return {
          code: "UNAVAILABLE",
          message: "Branch tiering is not enabled on this host",
          ok: false,
        };
      }
      if (body.op === "branch-usage") {
        return { branchUsage: await tiering.usage(), ok: true };
      }
      if (body.op === "tier-locate") {
        return {
          ok: true,
          placements: await tiering.locate(body.relativePaths),
        };
      }
      return {
        ok: true,
        tierMove: await tiering.move({
          expectedChecksum: body.expectedChecksum,
          expectedId: body.expectedId,
          relativePath: body.relativePath,
          toTier: body.toTier,
        }),
      };
    }
    if (body.op === "smb-provision" || body.op === "smb-revoke") {
      if (!smb) {
        return {
          code: "UNAVAILABLE",
          message: "SMB provisioning is not enabled on this host",
          ok: false,
        };
      }
      if (body.op === "smb-provision") {
        await smb.provision({
          accountId: body.accountId,
          principal: body.principal,
          secret: body.secret,
        });
      } else {
        await smb.revoke(body.principal);
      }
      return { ok: true, provisioned: true };
    }
    if (body.op === "list") {
      const listing = await service.list(body.relativePath);
      return {
        listing: {
          entries: listing.entries.map(payload),
          problems: listing.problems,
        },
        ok: true,
      };
    }
    if (body.op === "audit-writer") {
      return { ok: true, writer: auditWriters?.(body.relativePath) ?? null };
    }
    if (body.op === "adopt") {
      const result = await adoptEntry(service, body.relativePath, body.ownerId);
      return {
        adopted: result.attribution,
        entry: payload(result.entry),
        ok: true,
      };
    }
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
