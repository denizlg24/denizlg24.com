import { assertDeployHostname } from "@repo/schemas/cloud";

import { optionalEnv, requiredEnv } from "../env";

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Every record this platform owns carries a comment starting with this. It is
 * what tells a deployment record apart from `cloud.denizlg24.com`, and the
 * whole reason the reserved-name guard is not the only thing standing between
 * a deploy and the admin panel's DNS.
 */
export const FORGE_RECORD_COMMENT_PREFIX = "forge ";

export function deploymentRecordComment(deploymentId: string): string {
  return `${FORGE_RECORD_COMMENT_PREFIX}deployment ${deploymentId}`;
}

export function domainRecordComment(domainId: string): string {
  return `${FORGE_RECORD_COMMENT_PREFIX}domain ${domainId}`;
}

export interface ForgeRecordSubject {
  kind: "deployment" | "domain";
  id: string;
}

/**
 * The inverse of the two writers above. A managed record whose comment this
 * cannot read is left alone rather than reaped: an unparseable comment means
 * something wrote a shape this version does not know, and deleting it would
 * make the reconciler destroy exactly what it failed to understand.
 */
export function parseForgeRecordComment(
  comment: string | null,
): ForgeRecordSubject | null {
  if (!comment?.startsWith(FORGE_RECORD_COMMENT_PREFIX)) return null;
  const rest = comment.slice(FORGE_RECORD_COMMENT_PREFIX.length).trim();
  const [kind, id, ...extra] = rest.split(/\s+/);
  if (extra.length > 0 || !id) return null;
  if (kind !== "deployment" && kind !== "domain") return null;
  return { kind, id };
}

export interface CloudflareDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  comment: string | null;
}

export function isForgeManagedRecord(record: CloudflareDnsRecord): boolean {
  return record.comment?.startsWith(FORGE_RECORD_COMMENT_PREFIX) ?? false;
}

/**
 * Records that can still own or delegate a hostname after Forge points it at
 * the tunnel. Mail, verification, and certificate-policy records deliberately
 * do not count: an apex commonly needs MX, TXT, and CAA records alongside its
 * flattened Cloudflare CNAME.
 */
const HOSTNAME_ROUTING_RECORD_TYPES = new Set([
  "A",
  "AAAA",
  "CNAME",
  "HTTPS",
  "NS",
  "SVCB",
]);

export function isHostnameRoutingRecord(record: CloudflareDnsRecord): boolean {
  return HOSTNAME_ROUTING_RECORD_TYPES.has(record.type.toUpperCase());
}

export interface CloudflareDeployConfig {
  apiToken: string;
  zoneId: string;
  zoneName: string;
  tunnelId: string;
}

export function cloudflareDeployConfigFromEnv(): CloudflareDeployConfig {
  return {
    apiToken: requiredEnv("FORGE_CLOUDFLARE_API_TOKEN"),
    zoneId: requiredEnv("FORGE_CLOUDFLARE_ZONE_ID"),
    zoneName: optionalEnv("FORGE_CLOUDFLARE_ZONE_NAME", "denizlg24.com"),
    tunnelId: requiredEnv("FORGE_TUNNEL_ID"),
  };
}

export class CloudflareApiError extends Error {
  readonly status: number;
  readonly codes: number[];

  constructor(message: string, status: number, codes: number[] = []) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
    this.codes = codes;
  }
}

export class HostnameConflictError extends Error {
  readonly record: CloudflareDnsRecord;

  constructor(record: CloudflareDnsRecord) {
    super(
      `${record.name} already has a ${record.type} record this platform did not create`,
    );
    this.name = "HostnameConflictError";
    this.record = record;
  }
}

export interface CloudflareEnvelope {
  success?: unknown;
  errors?: unknown;
  result?: unknown;
}

function readRecord(value: unknown): CloudflareDnsRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    type: typeof record.type === "string" ? record.type : "",
    content: typeof record.content === "string" ? record.content : "",
    proxied: record.proxied === true,
    comment: typeof record.comment === "string" ? record.comment : null,
  };
}

export function readCloudflareErrors(value: unknown): {
  code: number;
  message: string;
}[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const error = entry as Record<string, unknown>;
    return [
      {
        code: typeof error.code === "number" ? error.code : 0,
        message: typeof error.message === "string" ? error.message : "",
      },
    ];
  });
}

export interface CloudflareDnsClientOptions {
  config: CloudflareDeployConfig;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const RECORD_NOT_FOUND_CODE = 81_044;

/**
 * One proxied `CNAME` per hostname, pointing at the tunnel. Deliberately not a
 * wildcard: a wildcard `CNAME` answers every query type for every unregistered
 * name in the zone, including the `_dmarc` and `_acme-challenge` lookups that
 * email and certificate renewal depend on.
 */
export class CloudflareDnsClient {
  readonly #config: CloudflareDeployConfig;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: CloudflareDnsClientOptions) {
    this.#config = options.config;
    this.#baseUrl = (options.baseUrl ?? CLOUDFLARE_API_BASE).replace(
      /\/+$/,
      "",
    );
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  get zoneName(): string {
    return this.#config.zoneName;
  }

  get tunnelTarget(): string {
    return `${this.#config.tunnelId}.cfargotunnel.com`;
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
    const envelope: CloudflareEnvelope =
      typeof body === "object" && body !== null ? body : {};
    return { status: response.status, envelope };
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

  async listRecordsByName(hostname: string): Promise<CloudflareDnsRecord[]> {
    const { status, envelope } = await this.#request(
      `/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`,
      { method: "GET" },
    );
    if (envelope.success !== true) {
      throw this.#fail("DNS record lookup", status, envelope);
    }
    const results = Array.isArray(envelope.result) ? envelope.result : [];
    return results.flatMap((entry) => {
      const record = readRecord(entry);
      return record ? [record] : [];
    });
  }

  /**
   * The check people leave out. The reserved list covers the names known today;
   * this covers everything added to the zone since, which is what stops a
   * deployment quietly taking over a hostname that already points somewhere.
   */
  async findConflictingRecord(
    hostname: string,
  ): Promise<CloudflareDnsRecord | null> {
    const records = await this.listRecordsByName(hostname);
    return (
      records.find(
        (record) =>
          isHostnameRoutingRecord(record) && !isForgeManagedRecord(record),
      ) ?? null
    );
  }

  async assertHostnameAvailable(hostname: string): Promise<string> {
    const normalised = assertDeployHostname(hostname, this.#config.zoneName);
    const conflict = await this.findConflictingRecord(normalised);
    if (conflict) throw new HostnameConflictError(conflict);
    return normalised;
  }

  async createManagedRecord(
    hostname: string,
    comment: string,
  ): Promise<CloudflareDnsRecord> {
    const { status, envelope } = await this.#request("/dns_records", {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: hostname,
        content: this.tunnelTarget,
        proxied: true,
        ttl: 1,
        comment,
      }),
    });
    const record =
      envelope.success === true ? readRecord(envelope.result) : null;
    if (!record) throw this.#fail("DNS record create", status, envelope);
    return record;
  }

  /**
   * Created at enqueue rather than after the build. A proxied record is live in
   * seconds and a build takes minutes, so by the time the health gate passes
   * the hostname already resolves — the alternative is a green deployment whose
   * URL 404s for the first minute.
   */
  async createDeploymentRecord(options: {
    hostname: string;
    deploymentId: string;
  }): Promise<CloudflareDnsRecord> {
    return this.createManagedRecord(
      options.hostname,
      deploymentRecordComment(options.deploymentId),
    );
  }

  /**
   * A record that is already gone counts as deleted. This is called on
   * teardown, and a leaked `CNAME` is a 404 from Caddy rather than an
   * exposure — it must never be the thing that blocks a deployment from being
   * torn down.
   */
  async deleteRecord(recordId: string): Promise<boolean> {
    const { status, envelope } = await this.#request(
      `/dns_records/${recordId}`,
      { method: "DELETE" },
    );
    if (envelope.success === true) return true;
    const error = this.#fail("DNS record delete", status, envelope);
    if (status === 404 || error.codes.includes(RECORD_NOT_FOUND_CODE)) {
      return false;
    }
    throw error;
  }

  /** Every record this platform owns, for the GC pass to reconcile against. */
  async listManagedRecords(): Promise<CloudflareDnsRecord[]> {
    const records: CloudflareDnsRecord[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { status, envelope } = await this.#request(
        `/dns_records?per_page=100&page=${page}&comment.startswith=${encodeURIComponent(FORGE_RECORD_COMMENT_PREFIX)}`,
        { method: "GET" },
      );
      if (envelope.success !== true) {
        throw this.#fail("DNS record list", status, envelope);
      }
      const results = Array.isArray(envelope.result) ? envelope.result : [];
      for (const entry of results) {
        const record = readRecord(entry);
        // Filtered again on this side: the server-side filter is a convenience,
        // and reconciling against a record we do not own would delete it.
        if (record && isForgeManagedRecord(record)) records.push(record);
      }
      if (results.length < 100) break;
    }
    return records;
  }
}
