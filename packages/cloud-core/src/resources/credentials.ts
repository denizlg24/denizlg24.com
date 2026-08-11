import type { ResourceCredentials } from "@repo/schemas/cloud";

import type { ResourceRow } from "../db/schema";
import {
  formatDatabaseResource,
  type ProjectDatabaseHosts,
} from "../projects/provisioning";
import { decryptS3Secret } from "../storage/s3/credentials";
import { databaseCredentials } from "./resources";

export interface ResourceCredentialsConfig {
  databaseEncryptionSecret: string;
  databaseHosts: ProjectDatabaseHosts;
  meilisearchUrl: string;
  s3Endpoint: string;
  s3Region: string;
}

const EMPTY = {
  accessKeyId: null,
  apiKey: null,
  bucket: null,
  database: null,
  host: null,
  password: null,
  port: null,
  secretAccessKey: null,
  url: null,
  username: null,
} satisfies Omit<ResourceCredentials, "resourceId" | "kind">;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function splitHost(value: string): { host: string; port: number | null } {
  const separator = value.lastIndexOf(":");
  if (separator === -1) return { host: value, port: null };
  const port = Number(value.slice(separator + 1));
  return {
    host: value.slice(0, separator),
    port: Number.isFinite(port) ? port : null,
  };
}

function externalHost(
  kind: "postgres" | "mongodb" | "redis",
  hosts: ProjectDatabaseHosts,
): string {
  if (kind === "postgres") return hosts.postgresExternal;
  if (kind === "mongodb") return hosts.mongodbExternal;
  return hosts.redisExternal;
}

/**
 * What `/resources/[id]` reveals when asked. Reading it is a deliberate act —
 * the list route never carries any of this — and it is assembled rather than
 * stored: a database password is decrypted here, and the external host is the
 * one that matters because a deployment reaches the Pi over the tailnet.
 *
 * An `s3` resource has no key pair to reveal. Credentials there are issued per
 * deployment against the project, so the only honest answer is the endpoint and
 * the bucket; minting one to display would write a real credential row that
 * nothing later revokes.
 */
export function resourceCredentials(
  row: ResourceRow,
  config: ResourceCredentialsConfig,
): ResourceCredentials {
  const base = { ...EMPTY, kind: row.kind, resourceId: row.id };

  if (row.kind === "s3") {
    const endpoint = splitHost(config.s3Endpoint);
    return {
      ...base,
      bucket: row.bucket,
      host: endpoint.host,
      url: config.s3Endpoint,
    };
  }

  if (row.kind === "meilisearch") {
    const parsed = parseUrl(config.meilisearchUrl);
    return {
      ...base,
      apiKey: row.meiliApiKey,
      host: parsed?.hostname ?? config.meilisearchUrl,
      port: parsed?.port ? Number(parsed.port) : null,
      url: config.meilisearchUrl,
    };
  }

  const record = databaseCredentials(row);
  const password = decryptS3Secret(
    record.encryptedPassword,
    record.iv,
    record.authTag,
    config.databaseEncryptionSecret,
  );
  // `formatDatabaseResource` wants the project the credential belongs to, but
  // a resource is standalone now and the id is only echoed back on a field this
  // shape drops. The uris are the reason to call it.
  const contract = formatDatabaseResource(
    row,
    row.namespaceId ?? row.id,
    password,
    config.databaseHosts,
  );
  const { host, port } = splitHost(
    externalHost(record.type, config.databaseHosts),
  );
  return {
    ...base,
    database: record.dbName,
    host,
    password,
    port,
    url: contract.uris.external,
    username: record.username,
  };
}
