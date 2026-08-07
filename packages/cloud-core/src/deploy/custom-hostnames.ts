import type {
  DeployDomainStatus,
  DomainVerificationRecords,
} from "@repo/schemas/cloud";

import {
  CLOUDFLARE_API_BASE,
  CloudflareApiError,
  type CloudflareDeployConfig,
  type CloudflareEnvelope,
  readCloudflareErrors,
} from "./cloudflare-dns";

export interface CustomHostname {
  id: string;
  hostname: string;
  status: DeployDomainStatus;
  verification: DomainVerificationRecords;
}

export interface CloudflareCustomHostnameClientOptions {
  config: CloudflareDeployConfig;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const HOSTNAME_NOT_FOUND_CODE = 1_436;

function readStrings(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Cloudflare reports two statuses — the hostname's and its certificate's — and
 * a domain is only usable when both are `active`. Collapsing them to one field
 * loses nothing the owner can act on: the DV records are the action, and they
 * are carried separately.
 */
export function readCustomHostnameStatus(result: Record<string, unknown>): {
  status: DeployDomainStatus;
  verification: DomainVerificationRecords;
} {
  const hostnameStatus = readString(result.status);
  const ssl = readStrings(result.ssl);
  const sslStatus = readString(ssl.status);

  const ownership = readStrings(result.ownership_verification);
  const ownershipRecords =
    ownership.name && ownership.value
      ? [
          {
            name: readString(ownership.name),
            type: readString(ownership.type) || "TXT",
            value: readString(ownership.value),
          },
        ]
      : [];

  const validation = Array.isArray(ssl.validation_records)
    ? ssl.validation_records
    : [];
  const sslRecords = validation.flatMap((entry) => {
    const record = readStrings(entry);
    const name = readString(record.txt_name);
    const value = readString(record.txt_value);
    return name && value ? [{ name, type: "TXT", value }] : [];
  });

  const errors = [
    ...(Array.isArray(result.verification_errors)
      ? result.verification_errors
      : []),
    ...(Array.isArray(ssl.validation_errors) ? ssl.validation_errors : []),
  ]
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : readString(readStrings(entry).message),
    )
    .filter((message) => message.length > 0);

  // `moved` and `blocked` are terminal on Cloudflare's side; everything else is
  // a state the owner can still get out of by adding the records.
  const failed =
    hostnameStatus === "moved" ||
    hostnameStatus === "blocked" ||
    hostnameStatus === "pending_blocked" ||
    hostnameStatus === "pending_deletion" ||
    hostnameStatus === "deleted";

  let status: DeployDomainStatus = "verifying";
  if (failed) status = "failed";
  else if (hostnameStatus === "active" && sslStatus === "active") {
    status = "active";
  }

  return {
    status,
    verification: {
      ownership: ownershipRecords,
      ssl: sslRecords,
      error: errors[0] ?? null,
    },
  };
}

/**
 * Cloudflare for SaaS, and only for the case that needs it: a domain whose
 * nameservers someone else controls. The free allowance is 100 hostnames and
 * previews are the one thing here that churns, so nothing ephemeral is ever
 * given one — a plain proxied record in a zone we own is free, unlimited and
 * live in seconds.
 */
export class CloudflareCustomHostnameClient {
  readonly #config: CloudflareDeployConfig;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: CloudflareCustomHostnameClientOptions) {
    this.#config = options.config;
    this.#baseUrl = (options.baseUrl ?? CLOUDFLARE_API_BASE).replace(
      /\/+$/,
      "",
    );
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async #request(
    path: string,
    init: RequestInit & { method: string },
  ): Promise<{ status: number; envelope: CloudflareEnvelope }> {
    const response = await this.#fetch(
      `${this.#baseUrl}/zones/${this.#config.zoneId}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${this.#config.apiToken}`,
          "content-type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    return {
      status: response.status,
      envelope: typeof body === "object" && body !== null ? body : {},
    };
  }

  #fail(
    action: string,
    status: number,
    envelope: CloudflareEnvelope,
  ): CloudflareApiError {
    const errors = readCloudflareErrors(envelope.errors);
    const detail =
      errors.map((error) => `${error.code}: ${error.message}`).join("; ") ||
      `HTTP ${status}`;
    return new CloudflareApiError(
      `Cloudflare ${action} failed (${detail})`,
      status,
      errors.map((error) => error.code),
    );
  }

  #read(result: unknown): CustomHostname | null {
    const record = readStrings(result);
    if (typeof record.id !== "string") return null;
    return {
      id: record.id,
      hostname: readString(record.hostname),
      ...readCustomHostnameStatus(record),
    };
  }

  async create(hostname: string): Promise<CustomHostname> {
    const { status, envelope } = await this.#request("/custom_hostnames", {
      method: "POST",
      body: JSON.stringify({
        hostname,
        ssl: {
          method: "txt",
          type: "dv",
          settings: { min_tls_version: "1.2" },
        },
      }),
    });
    const created =
      envelope.success === true ? this.#read(envelope.result) : null;
    if (!created) throw this.#fail("custom hostname create", status, envelope);
    return created;
  }

  async get(id: string): Promise<CustomHostname | null> {
    const { status, envelope } = await this.#request(
      `/custom_hostnames/${id}`,
      {
        method: "GET",
      },
    );
    if (envelope.success !== true) {
      const error = this.#fail("custom hostname lookup", status, envelope);
      if (status === 404 || error.codes.includes(HOSTNAME_NOT_FOUND_CODE)) {
        return null;
      }
      throw error;
    }
    return this.#read(envelope.result);
  }

  /** Already gone counts as deleted, for the same reason a DNS record does. */
  async delete(id: string): Promise<boolean> {
    const { status, envelope } = await this.#request(
      `/custom_hostnames/${id}`,
      {
        method: "DELETE",
      },
    );
    if (envelope.success === true) return true;
    const error = this.#fail("custom hostname delete", status, envelope);
    if (status === 404 || error.codes.includes(HOSTNAME_NOT_FOUND_CODE)) {
      return false;
    }
    throw error;
  }
}
