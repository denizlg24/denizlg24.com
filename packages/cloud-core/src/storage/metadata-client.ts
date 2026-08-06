import type { StorageTier } from "../db/schema";
import type { ProtectedMetadata } from "./metadata";
import {
  type BranchUsagePayload,
  METADATA_PROTOCOL_VERSION,
  MetadataClientError,
  type MetadataEntryPayload,
  type MetadataListingPayload,
  type MetadataRequest,
  type MetadataResponse,
  type TierMovePayload,
  type TierPlacementPayload,
} from "./metadata-protocol";
import type { NamespaceWatchMessage } from "./namespace-watch";

export interface MetadataClientOptions {
  socketPath: string;
  token: string;
  /** Bounded so a wedged privileged service degrades the API rather than hanging it. */
  timeoutMs?: number;
}

/**
 * The API's handle on the privileged metadata service.
 *
 * Every failure surfaces as MetadataClientError with a code. In particular an
 * unreachable service is `UNAVAILABLE`, which callers must treat as
 * fail-closed: the ADR forbids falling back to the authoritative mount, and an
 * entry whose identity cannot be confirmed must not have its bytes served.
 */
export class NamespaceMetadataClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: MetadataClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  private async raw(request: MetadataRequest): Promise<MetadataResponse> {
    let response: Response;
    try {
      response = await fetch("http://metadata/v1", {
        body: JSON.stringify(request),
        headers: {
          "content-type": "application/json",
          "x-metadata-token": this.options.token,
          "x-metadata-version": String(METADATA_PROTOCOL_VERSION),
        },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
        unix: this.options.socketPath,
      } as RequestInit & { unix: string });
    } catch (error) {
      throw new MetadataClientError(
        `Metadata service is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "UNAVAILABLE",
      );
    }

    let payload: MetadataResponse;
    try {
      payload = (await response.json()) as MetadataResponse;
    } catch {
      throw new MetadataClientError(
        `Metadata service returned a non-JSON ${response.status}`,
        "UNAVAILABLE",
      );
    }
    if (!payload.ok) {
      throw new MetadataClientError(payload.message, payload.code);
    }
    return payload;
  }

  private async send(request: MetadataRequest): Promise<MetadataEntryPayload> {
    const payload = await this.raw(request);
    if (!payload.ok || !("entry" in payload)) {
      throw new MetadataClientError(
        "Metadata service returned no entry",
        "UNAVAILABLE",
      );
    }
    return payload.entry;
  }

  async provisionSmb(input: {
    accountId: string;
    principal: string;
    secret: string;
  }): Promise<void> {
    const payload = await this.raw({ ...input, op: "smb-provision" });
    if (!payload.ok) {
      throw new MetadataClientError(payload.message, payload.code);
    }
  }

  /**
   * Streams watch messages until the caller aborts or the host closes.
   *
   * Ending the stream is always safe: the supervisor treats any end as a gap it
   * cannot account for and falls back to a full scan, so nothing here needs to
   * buffer, replay or acknowledge.
   */
  async *watch(signal: AbortSignal): AsyncGenerator<NamespaceWatchMessage> {
    const response = await fetch("http://metadata/v1/watch", {
      headers: {
        "x-metadata-token": this.options.token,
        "x-metadata-version": String(METADATA_PROTOCOL_VERSION),
      },
      method: "POST",
      signal,
      unix: this.options.socketPath,
    } as RequestInit & { unix: string });

    if (!response.ok || !response.body) {
      throw new MetadataClientError(
        `Metadata watch failed with ${response.status}`,
        "UNAVAILABLE",
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.length === 0) continue;
        try {
          yield JSON.parse(line) as NamespaceWatchMessage;
        } catch {
          // A malformed line means the stream is no longer trustworthy; ending
          // it sends the supervisor down the full-scan path.
          throw new MetadataClientError(
            "Metadata watch produced a malformed message",
            "UNAVAILABLE",
          );
        }
      }
    }
  }

  async branchMarkers(): Promise<Record<string, string>> {
    const payload = await this.raw({ op: "branch-markers" });
    if (!payload.ok || !("branchMarkers" in payload)) {
      throw new MetadataClientError(
        "Metadata service returned no branch markers",
        "UNAVAILABLE",
      );
    }
    return payload.branchMarkers;
  }

  /**
   * Free space per physical branch.
   *
   * `UNAVAILABLE` here means the host has no branch roles configured, which is
   * the state every host is in until tiering is deployed. The pass reads that
   * as "cannot judge the watermark" and does nothing, rather than assuming an
   * empty disk and demoting on a guess.
   */
  async branchUsage(): Promise<BranchUsagePayload[]> {
    const payload = await this.raw({ op: "branch-usage" });
    if (!payload.ok || !("branchUsage" in payload)) {
      throw new MetadataClientError(
        "Metadata service returned no branch usage",
        "UNAVAILABLE",
      );
    }
    return payload.branchUsage;
  }

  async locateTiers(
    relativePaths: readonly string[],
  ): Promise<TierPlacementPayload[]> {
    if (relativePaths.length === 0) return [];
    const payload = await this.raw({
      op: "tier-locate",
      relativePaths: [...relativePaths],
    });
    if (!payload.ok || !("placements" in payload)) {
      throw new MetadataClientError(
        "Metadata service returned no placements",
        "UNAVAILABLE",
      );
    }
    return payload.placements;
  }

  async moveTier(input: {
    relativePath: string;
    toTier: StorageTier;
    expectedId: string;
    expectedChecksum: string;
  }): Promise<TierMovePayload> {
    const payload = await this.raw({ ...input, op: "tier-move" });
    if (!payload.ok || !("tierMove" in payload)) {
      throw new MetadataClientError(
        "Metadata service returned no move result",
        "UNAVAILABLE",
      );
    }
    return payload.tierMove;
  }

  async revokeSmb(principal: string): Promise<void> {
    const payload = await this.raw({ op: "smb-revoke", principal });
    if (!payload.ok) {
      throw new MetadataClientError(payload.message, payload.code);
    }
  }

  async list(relativePath: string): Promise<MetadataListingPayload> {
    const payload = await this.raw({ op: "list", relativePath });
    if (!payload.ok || !("listing" in payload)) {
      throw new MetadataClientError(
        "Metadata service returned no listing",
        "UNAVAILABLE",
      );
    }
    return payload.listing;
  }

  stat(relativePath: string): Promise<MetadataEntryPayload> {
    return this.send({ op: "stat", relativePath });
  }

  /**
   * Assigns identity to an entry that has none, returning the entry and the
   * ancestor its owner was inherited from.
   *
   * Refusals are ordinary failures, not faults: `IDENTITY_CONFLICT` means the
   * entry already had identity and `NO_IDENTITY` means no ancestor could
   * supply an owner. Both leave the entry exactly as it was.
   */
  async auditWriter(
    relativePath: string,
  ): Promise<{ at: number; principal: string } | null> {
    const payload = await this.raw({ op: "audit-writer", relativePath });
    return payload.ok && "writer" in payload ? payload.writer : null;
  }

  async adopt(
    relativePath: string,
    ownerId?: string,
  ): Promise<{
    attribution: {
      fromRelativePath: string | null;
      ownerId: string | null;
      via: "audit" | "ancestor";
    };
    entry: MetadataEntryPayload;
  }> {
    const payload = await this.raw({ op: "adopt", ownerId, relativePath });
    if (!payload.ok || !("adopted" in payload)) {
      throw new MetadataClientError(
        "Metadata service returned no adoption result",
        "UNAVAILABLE",
      );
    }
    return { attribution: payload.adopted, entry: payload.entry };
  }

  verify(
    relativePath: string,
    expectedId: string,
  ): Promise<MetadataEntryPayload> {
    return this.send({ expectedId, op: "verify", relativePath });
  }

  assign(
    relativePath: string,
    metadata: ProtectedMetadata,
  ): Promise<MetadataEntryPayload> {
    return this.send({ metadata, op: "assign", relativePath });
  }

  recordChecksum(
    relativePath: string,
    checksum: string,
  ): Promise<MetadataEntryPayload> {
    return this.send({ checksum, op: "checksum", relativePath });
  }
}

export { MetadataClientError };
