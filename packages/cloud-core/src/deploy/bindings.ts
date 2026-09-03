import type { DbType, DeploymentKind } from "@repo/schemas/cloud";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../db";
import { type DeployEnvVarRow, projects, s3Credentials } from "../db/schema";
import { NotFoundError } from "../errors";
import {
  formatDatabaseResource,
  type ProjectDatabaseHosts,
} from "../projects/provisioning";
import {
  connectedResourceKinds,
  databaseCredentials,
  resolveConnectedResource,
} from "../resources/resources";
import {
  decryptS3Secret,
  encryptS3Secret,
  issueS3Credential,
} from "../storage/s3/credentials";
import type {
  DeployBindingResolvers,
  DeployNamespaceAvailability,
  NamespaceValues,
} from "./env";

export interface DeployEnvCipher {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Keyed by its own `DEPLOY_ENV_ENCRYPTION_KEY`, never by
 * `S3_CREDENTIAL_ENCRYPTION_KEY`. That key is on the list that cannot change,
 * and tying app env vars to it means never being able to rotate either.
 */
export function encryptDeployEnvValue(
  value: string,
  key: string,
): DeployEnvCipher {
  return encryptS3Secret(value, key);
}

export function decryptDeployEnvValue(
  row: Pick<
    DeployEnvVarRow,
    "encryptedValue" | "valueIv" | "valueAuthTag" | "key"
  >,
  key: string,
): string {
  if (!row.encryptedValue || !row.valueIv || !row.valueAuthTag) {
    throw new Error(`Env var ${row.key} has no stored value`);
  }
  return decryptS3Secret(
    row.encryptedValue,
    row.valueIv,
    row.valueAuthTag,
    key,
  );
}

/**
 * Availability is not scoped to a deployment kind on purpose. This backs the
 * pre-flight check and the bindings picker, both of which ask "can this target
 * reference postgres at all" — narrowing it to production would grey out a
 * reference that a preview build resolves perfectly well.
 */
export async function deployNamespaceAvailability(
  db: Database,
  projectId: string,
): Promise<DeployNamespaceAvailability> {
  const connected = await connectedResourceKinds(db, projectId);
  return {
    postgres: connected.has("postgres"),
    mongodb: connected.has("mongodb"),
    redis: connected.has("redis"),
    meilisearch: connected.has("meilisearch"),
  };
}

function externalHost(type: DbType, hosts: ProjectDatabaseHosts): string {
  if (type === "postgres") return hosts.postgresExternal;
  if (type === "mongodb") return hosts.mongodbExternal;
  return hosts.redisExternal;
}

interface DatabaseBindingInput {
  projectId: string;
  deploymentKind: DeploymentKind;
  environmentId: string | null;
  encryptionSecret: string;
  hosts: ProjectDatabaseHosts;
}

function databaseNamespace(
  type: DbType,
  db: Database,
  input: DatabaseBindingInput,
) {
  return async (): Promise<NamespaceValues | null> => {
    const connected = await resolveConnectedResource(db, {
      deploymentKind: input.deploymentKind,
      environmentId: input.environmentId,
      kind: type,
      projectId: input.projectId,
    });
    if (!connected) return null;
    const { resource } = connected;
    const record = databaseCredentials(resource);
    const password = decryptS3Secret(
      record.encryptedPassword,
      record.iv,
      record.authTag,
      input.encryptionSecret,
    );
    const contract = formatDatabaseResource(
      resource,
      input.projectId,
      password,
      input.hosts,
    );
    // The external URI, not the internal one: a deployment runs on the forge
    // host and reaches the Pi over the tailnet. The internal host names a
    // compose service that does not resolve from over there.
    const [host = "", port = ""] = externalHost(type, input.hosts).split(":");
    return {
      url: contract.uris.external,
      host,
      port,
      user: record.username,
      password,
      ...(type === "redis" ? {} : { database: record.dbName }),
    };
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export interface DeployMeilisearchBindingOptions {
  projectId: string;
  deploymentKind: DeploymentKind;
  environmentId: string | null;
  url: string;
}

/**
 * The key is stored in cleartext on the resource, exactly as it was on the
 * `projects` row it moved off. It is a Meilisearch tenant key scoped to one
 * index prefix, not a password that unlocks the host, and it has to be handed
 * to the search client verbatim.
 */
function meilisearchNamespace(
  db: Database,
  input: DeployMeilisearchBindingOptions,
) {
  return async (): Promise<NamespaceValues | null> => {
    const connected = await resolveConnectedResource(db, {
      deploymentKind: input.deploymentKind,
      environmentId: input.environmentId,
      kind: "meilisearch",
      projectId: input.projectId,
    });
    if (!connected?.resource.meiliApiKey) return null;
    const parsed = parseUrl(input.url);
    return {
      url: input.url,
      host: parsed?.hostname ?? input.url,
      port: parsed?.port ?? "",
      key: connected.resource.meiliApiKey,
    };
  };
}

export interface DeployS3BindingOptions {
  projectId: string;
  projectSlug: string;
  deploymentKind: DeploymentKind;
  environmentId: string | null;
  deploymentId: string;
  endpoint: string;
  region: string;
  credentialEncryptionKey: string;
  issueCredentialIfMissing: boolean;
}

/**
 * Resolves one credential per deployment, so repeated build, environment
 * apply, backup and recovery reads all produce the same environment. Revoking
 * one deployment's access never touches another's. Only ever called when a row
 * references `s3.*` — that laziness is what keeps the credential table
 * auditable.
 */
function s3Namespace(db: Database, input: DeployS3BindingOptions) {
  return async (): Promise<NamespaceValues | null> => {
    // A connected `s3` resource names its bucket explicitly. Falling back to
    // the slug preserves what every project got before resources existed: the
    // credential is restricted to one bucket named exactly the project slug,
    // and that bucket is created by the first CreateBucket rather than at
    // provisioning time.
    const connected = await resolveConnectedResource(db, {
      deploymentKind: input.deploymentKind,
      environmentId: input.environmentId,
      kind: "s3",
      projectId: input.projectId,
    });
    const label = `deploy:${input.deploymentId}`;
    type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
    const findExisting = (executor: Database | Transaction) =>
      executor.query.s3Credentials.findFirst({
        where: and(
          eq(s3Credentials.projectId, input.projectId),
          eq(s3Credentials.label, label),
          isNull(s3Credentials.revokedAt),
        ),
        orderBy: [desc(s3Credentials.createdAt), desc(s3Credentials.id)],
      });
    // Older releases issued on every read, so tolerate more than one active
    // row and consistently select the latest one. New reads reuse it, which is
    // essential for a DR semantic fingerprint to describe the environment the
    // original container received rather than rotate it during inventory.
    const resolveExisting = (
      existing: Awaited<ReturnType<typeof findExisting>>,
    ) =>
      existing
        ? {
            credential: existing,
            secretAccessKey: decryptS3Secret(
              existing.encryptedSecretAccessKey,
              existing.secretIv,
              existing.secretAuthTag,
              input.credentialEncryptionKey,
            ),
          }
        : null;
    const current = resolveExisting(await findExisting(db));
    if (!current && !input.issueCredentialIfMissing) return null;
    const issued =
      current ??
      (await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${label}, 0))`,
        );
        return (
          resolveExisting(await findExisting(tx)) ??
          issueS3Credential(tx, {
            projectId: input.projectId,
            label,
            keyEncryptionSecret: input.credentialEncryptionKey,
          })
        );
      }));
    return {
      endpoint: input.endpoint,
      region: input.region,
      bucket: connected?.resource.bucket ?? input.projectSlug,
      accessKeyId: issued.credential.accessKeyId,
      secretAccessKey: issued.secretAccessKey,
    };
  };
}

export interface DeployBindingResolverOptions {
  db: Database;
  projectId: string;
  projectSlug: string;
  deploymentId: string;
  /**
   * Which slot of the project this deployment is. It selects between
   * connections scoped `production`, `preview` and `environment`, which is
   * what lets one project hold a production database and a staging one
   * without preview builds reaching production data.
   */
  deploymentKind: DeploymentKind;
  /** Which environment, when `deploymentKind` is `environment`. */
  environmentId: string | null;
  databaseEncryptionSecret: string;
  databaseHosts: ProjectDatabaseHosts;
  meilisearchUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3CredentialEncryptionKey: string;
  /** DR inventory and preflight are read-only and must never mint state. */
  issueS3CredentialIfMissing?: boolean;
}

export function createDeployBindingResolvers(
  options: DeployBindingResolverOptions,
): DeployBindingResolvers {
  const databaseInput: DatabaseBindingInput = {
    projectId: options.projectId,
    deploymentKind: options.deploymentKind,
    environmentId: options.environmentId,
    encryptionSecret: options.databaseEncryptionSecret,
    hosts: options.databaseHosts,
  };
  return {
    "database.postgres": databaseNamespace(
      "postgres",
      options.db,
      databaseInput,
    ),
    "database.mongodb": databaseNamespace("mongodb", options.db, databaseInput),
    "database.redis": databaseNamespace("redis", options.db, databaseInput),
    "search.meilisearch": meilisearchNamespace(options.db, {
      projectId: options.projectId,
      deploymentKind: options.deploymentKind,
      environmentId: options.environmentId,
      url: options.meilisearchUrl,
    }),
    s3: s3Namespace(options.db, {
      projectId: options.projectId,
      projectSlug: options.projectSlug,
      deploymentKind: options.deploymentKind,
      environmentId: options.environmentId,
      deploymentId: options.deploymentId,
      endpoint: options.s3Endpoint,
      region: options.s3Region,
      credentialEncryptionKey: options.s3CredentialEncryptionKey,
      issueCredentialIfMissing: options.issueS3CredentialIfMissing ?? true,
    }),
  };
}

/**
 * Credentials a deployment was issued live only as long as the deployment. A
 * torn-down preview leaving a working access key behind is the failure this
 * exists to prevent.
 */
export async function revokeDeploymentS3Credentials(
  db: Database,
  deploymentId: string,
): Promise<number> {
  const revoked = await db
    .update(s3Credentials)
    .set({ revokedAt: new Date() })
    .where(eq(s3Credentials.label, `deploy:${deploymentId}`))
    .returning({ id: s3Credentials.id });
  return revoked.length;
}

export async function requireProject(db: Database, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) {
    throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
  }
  return project;
}
