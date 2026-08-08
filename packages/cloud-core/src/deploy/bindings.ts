import type { DbType } from "@repo/schemas/cloud";
import { and, eq } from "drizzle-orm";

import type { Database } from "../db";
import {
  type DeployEnvVarRow,
  projectDatabases,
  projects,
  s3Credentials,
} from "../db/schema";
import { NotFoundError } from "../errors";
import {
  formatProjectDatabase,
  type ProjectDatabaseHosts,
} from "../projects/provisioning";
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

export async function deployNamespaceAvailability(
  db: Database,
  projectId: string,
): Promise<DeployNamespaceAvailability> {
  const rows = await db
    .select({ type: projectDatabases.type })
    .from(projectDatabases)
    .where(eq(projectDatabases.projectId, projectId));
  const provisioned = new Set<DbType>(rows.map((row) => row.type));
  return {
    postgres: provisioned.has("postgres"),
    mongodb: provisioned.has("mongodb"),
    redis: provisioned.has("redis"),
  };
}

function externalHost(type: DbType, hosts: ProjectDatabaseHosts): string {
  if (type === "postgres") return hosts.postgresExternal;
  if (type === "mongodb") return hosts.mongodbExternal;
  return hosts.redisExternal;
}

function databaseNamespace(
  type: DbType,
  db: Database,
  input: {
    projectId: string;
    encryptionSecret: string;
    hosts: ProjectDatabaseHosts;
  },
) {
  return async (): Promise<NamespaceValues | null> => {
    const record = await db.query.projectDatabases.findFirst({
      where: and(
        eq(projectDatabases.projectId, input.projectId),
        eq(projectDatabases.type, type),
      ),
    });
    if (!record) return null;
    const password = decryptS3Secret(
      record.encryptedPassword,
      record.iv,
      record.authTag,
      input.encryptionSecret,
    );
    const contract = formatProjectDatabase(record, password, input.hosts);
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

export interface DeployS3BindingOptions {
  projectId: string;
  projectSlug: string;
  deploymentId: string;
  endpoint: string;
  region: string;
  credentialEncryptionKey: string;
}

/**
 * Issues a fresh credential per deployment, so revoking one deployment's
 * access never touches another's. Only ever called when a row references
 * `s3.*` — that laziness is what keeps the credential table auditable.
 */
function s3Namespace(db: Database, input: DeployS3BindingOptions) {
  return async (): Promise<NamespaceValues | null> => {
    const issued = await issueS3Credential(db, {
      projectId: input.projectId,
      label: `deploy:${input.deploymentId}`,
      keyEncryptionSecret: input.credentialEncryptionKey,
    });
    return {
      endpoint: input.endpoint,
      region: input.region,
      // The credential is restricted to one bucket named exactly the project
      // slug, and that bucket is created by the first CreateBucket, not at
      // provisioning time.
      bucket: input.projectSlug,
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
  databaseEncryptionSecret: string;
  databaseHosts: ProjectDatabaseHosts;
  s3Endpoint: string;
  s3Region: string;
  s3CredentialEncryptionKey: string;
}

export function createDeployBindingResolvers(
  options: DeployBindingResolverOptions,
): DeployBindingResolvers {
  const databaseInput = {
    projectId: options.projectId,
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
    s3: s3Namespace(options.db, {
      projectId: options.projectId,
      projectSlug: options.projectSlug,
      deploymentId: options.deploymentId,
      endpoint: options.s3Endpoint,
      region: options.s3Region,
      credentialEncryptionKey: options.s3CredentialEncryptionKey,
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
