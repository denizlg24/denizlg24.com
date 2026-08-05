import type { ProtectedMetadata } from "./metadata";
import {
  METADATA_PROTOCOL_VERSION,
  MetadataClientError,
  type MetadataEntryPayload,
  type MetadataRequest,
  type MetadataResponse,
} from "./metadata-protocol";

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

  private async send(request: MetadataRequest): Promise<MetadataEntryPayload> {
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
    return payload.entry;
  }

  stat(relativePath: string): Promise<MetadataEntryPayload> {
    return this.send({ op: "stat", relativePath });
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
