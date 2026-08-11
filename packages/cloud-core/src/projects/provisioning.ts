import { randomBytes } from "node:crypto";

import type {
  DbType,
  ProjectDatabase as ProjectDatabaseContract,
  ProjectDatabaseMetadata,
} from "@repo/schemas/cloud";
import { and, eq, isNull } from "drizzle-orm";
import type { MongoClient } from "mongodb";

import {
  decryptLegacyTotpSecret,
  encryptLegacyTotpSecret,
} from "../auth/legacy-totp";
import type { Database, RawSqlClient } from "../db";
import { createRawClient } from "../db";
import {
  type Project,
  projects,
  type ResourceRow,
  resourceConnections,
  resources,
} from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import {
  availableResourceName,
  type DatabaseResourceCredentials,
  databaseCredentials,
  findConnectedResources,
  toDatabaseMetadata,
} from "../resources/resources";

const REDIS_DENIED_COMMANDS = [
  "-acl",
  "-config",
  "-debug",
  "-flushall",
  "-flushdb",
  "-module",
  "-monitor",
  "-replicaof",
  "-save",
  "-shutdown",
  "-slaveof",
] as const;

export interface ProvisionTarget {
  projectId: string;
  projectSlug: string;
  dbName: string;
  username: string;
  password: string;
}

export interface Provisioner {
  readonly type: DbType;
  provision(target: ProvisionTarget): Promise<void>;
  deprovision(
    target: Omit<ProvisionTarget, "password" | "projectSlug">,
  ): Promise<void>;
}

export interface RedisCommander {
  sendCommand(args: string[]): Promise<unknown>;
}

export interface ProjectDatabaseHosts {
  postgresInternal: string;
  postgresExternal: string;
  mongodbInternal: string;
  mongodbExternal: string;
  redisInternal: string;
  redisExternal: string;
}

function identifierForSlug(slug: string): string {
  const normalized = slug.replaceAll("-", "_").replace(/[^a-z0-9_]/g, "");
  return `proj_${normalized}`.slice(0, 63);
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error("Unsafe generated database identifier");
  }
  return `"${identifier}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function password(): string {
  return randomBytes(24).toString("base64url");
}

async function withAdminSql<T>(
  databaseUrl: string,
  operation: (sql: RawSqlClient) => Promise<T>,
): Promise<T> {
  const sql = createRawClient(databaseUrl, { max: 1 });
  try {
    return await operation(sql);
  } finally {
    await sql.end();
  }
}

export class PostgresProvisioner implements Provisioner {
  readonly type = "postgres" as const;

  constructor(private readonly databaseUrl: string) {}

  async provision(target: ProvisionTarget): Promise<void> {
    const role = quoteIdentifier(target.username);
    const database = quoteIdentifier(target.dbName);
    await withAdminSql(this.databaseUrl, async (sql) => {
      await sql.unsafe(
        `CREATE ROLE ${role} WITH LOGIN PASSWORD ${quoteLiteral(target.password)}`,
      );
      try {
        await sql.unsafe(`CREATE DATABASE ${database} OWNER ${role}`);
        await sql.unsafe(
          `GRANT ALL PRIVILEGES ON DATABASE ${database} TO ${role}`,
        );
      } catch (error) {
        await sql
          .unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
          .catch(() => undefined);
        await sql.unsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
        throw error;
      }
    });
  }

  async deprovision(
    target: Omit<ProvisionTarget, "password" | "projectSlug">,
  ): Promise<void> {
    const role = quoteIdentifier(target.username);
    const database = quoteIdentifier(target.dbName);
    await withAdminSql(this.databaseUrl, async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await sql.unsafe(`DROP ROLE IF EXISTS ${role}`);
    });
  }
}

export class MongoProvisioner implements Provisioner {
  readonly type = "mongodb" as const;

  constructor(private readonly mongo: MongoClient) {}

  async provision(target: ProvisionTarget): Promise<void> {
    const database = this.mongo.db(target.dbName);
    await database.command({
      createUser: target.username,
      pwd: target.password,
      roles: [{ role: "dbOwner", db: target.dbName }],
    });
    try {
      await database.collection("_meta").insertOne({
        createdAt: new Date(),
        projectId: target.projectId,
        projectSlug: target.projectSlug,
      });
    } catch (error) {
      await database
        .command({ dropUser: target.username })
        .catch(() => undefined);
      throw error;
    }
  }

  async deprovision(
    target: Omit<ProvisionTarget, "password" | "projectSlug">,
  ): Promise<void> {
    const database = this.mongo.db(target.dbName);
    await database
      .command({ dropUser: target.username })
      .catch(() => undefined);
    await database.dropDatabase();
  }
}

async function saveRedisAcls(redis: RedisCommander): Promise<void> {
  await redis.sendCommand(["ACL", "SAVE"]);
}

async function setRedisUser(
  redis: RedisCommander,
  username: string,
  userPassword: string,
  keyPrefix: string,
): Promise<void> {
  await redis.sendCommand([
    "ACL",
    "SETUSER",
    username,
    "reset",
    "on",
    `>${userPassword}`,
    `~${keyPrefix}:*`,
    `&${keyPrefix}:*`,
    "+@all",
    ...REDIS_DENIED_COMMANDS,
  ]);
}

async function deleteRedisKeys(
  redis: RedisCommander,
  pattern: string,
): Promise<void> {
  let cursor = "0";
  do {
    const result = await redis.sendCommand([
      "SCAN",
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "500",
    ]);
    if (
      !Array.isArray(result) ||
      typeof result[0] !== "string" ||
      !Array.isArray(result[1])
    ) {
      throw new Error("Unexpected Redis SCAN response");
    }
    cursor = result[0];
    const keys = result[1].filter(
      (key): key is string => typeof key === "string",
    );
    if (keys.length > 0) {
      await redis.sendCommand(["UNLINK", ...keys]);
    }
  } while (cursor !== "0");
}

export class RedisProvisioner implements Provisioner {
  readonly type = "redis" as const;

  constructor(private readonly redis: RedisCommander) {}

  async provision(target: ProvisionTarget): Promise<void> {
    await setRedisUser(
      this.redis,
      target.username,
      target.password,
      target.dbName,
    );
    await saveRedisAcls(this.redis);
  }

  async deprovision(
    target: Omit<ProvisionTarget, "password" | "projectSlug">,
  ): Promise<void> {
    await deleteRedisKeys(this.redis, `${target.dbName}:*`);
    await this.redis.sendCommand(["ACL", "DELUSER", target.username]);
    await saveRedisAcls(this.redis);
  }
}

export function createProvisionerRegistry(
  provisioners: readonly Provisioner[],
): ReadonlyMap<DbType, Provisioner> {
  const registry = new Map<DbType, Provisioner>();
  for (const provisioner of provisioners) {
    if (registry.has(provisioner.type)) {
      throw new Error(`Duplicate ${provisioner.type} provisioner`);
    }
    registry.set(provisioner.type, provisioner);
  }
  return registry;
}

function connectionUri(
  record: Pick<DatabaseResourceCredentials, "dbName" | "type" | "username">,
  secret: string,
  host: string,
): string {
  const credentials = `${encodeURIComponent(record.username)}:${encodeURIComponent(secret)}`;
  if (record.type === "postgres") {
    return `postgresql://${credentials}@${host}/${encodeURIComponent(record.dbName)}`;
  }
  if (record.type === "mongodb") {
    return `mongodb://${credentials}@${host}/${encodeURIComponent(record.dbName)}`;
  }
  return `redis://${credentials}@${host}`;
}

/**
 * `projectId` comes from the connection rather than from the resource, because
 * a resource is no longer owned by one project. The contract keeps the field
 * so the project-scoped routes answer exactly what they did before.
 */
export function formatDatabaseResource(
  row: ResourceRow,
  projectId: string,
  secret: string,
  hosts: ProjectDatabaseHosts,
): ProjectDatabaseContract {
  const record = databaseCredentials(row);
  const pair: readonly [string, string] =
    record.type === "postgres"
      ? [hosts.postgresInternal, hosts.postgresExternal]
      : record.type === "mongodb"
        ? [hosts.mongodbInternal, hosts.mongodbExternal]
        : [hosts.redisInternal, hosts.redisExternal];
  return {
    id: row.id,
    projectId,
    type: record.type,
    dbName: record.dbName,
    username: record.username,
    password: secret,
    ...(record.type === "redis" ? { keyPrefix: `${record.dbName}:` } : {}),
    uris: {
      internal: connectionUri(record, secret, pair[0]),
      external: connectionUri(record, secret, pair[1]),
    },
    createdAt: row.createdAt.toISOString(),
  };
}

async function projectForProvisioning(
  db: Database,
  projectId: string,
): Promise<Project> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) {
    throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
  }
  return project;
}

/**
 * Provisions a database on its engine and connects it to the project.
 *
 * The one-per-type rejection is now a query over connections rather than the
 * `unique(project_id, type)` index it used to be. The index is gone on purpose
 * — it is what forced a second environment to become a second project — but the
 * project-scoped route keeps the old behaviour so Cloud's UI is unchanged. The
 * resource-scoped surface is what will connect several postgres resources to
 * one project.
 */
export async function provisionProjectDatabase(
  db: Database,
  registry: ReadonlyMap<DbType, Provisioner>,
  encryptionSecret: string,
  hosts: ProjectDatabaseHosts,
  input: { projectId: string; type: DbType },
): Promise<ProjectDatabaseContract> {
  const project = await projectForProvisioning(db, input.projectId);
  const connected = await findConnectedResources(db, {
    kind: input.type,
    projectId: input.projectId,
  });
  if (connected.length > 0) {
    throw new ConflictError(
      `A ${input.type} database already exists for this project`,
      "DATABASE_EXISTS",
    );
  }
  const provisioner = registry.get(input.type);
  if (!provisioner) {
    throw new Error(`No ${input.type} provisioner configured`);
  }
  const identifier = identifierForSlug(project.slug);
  const name = await availableResourceName(db, input.type, project.slug);
  const cleartextPassword = password();
  const target: ProvisionTarget = {
    projectId: project.id,
    projectSlug: project.slug,
    dbName: identifier,
    username: identifier,
    password: cleartextPassword,
  };
  await provisioner.provision(target);
  try {
    const encrypted = encryptLegacyTotpSecret(
      cleartextPassword,
      encryptionSecret,
    );
    const row = await db.transaction(async (tx) => {
      const [resource] = await tx
        .insert(resources)
        .values({
          authTag: encrypted.authTag,
          dbName: identifier,
          encryptedPassword: encrypted.encrypted,
          iv: encrypted.iv,
          kind: input.type,
          name,
          username: identifier,
        })
        .returning();
      if (!resource) {
        throw new Error("Failed to save resource");
      }
      await tx.insert(resourceConnections).values({
        projectId: project.id,
        resourceId: resource.id,
        scopes: "both",
      });
      return resource;
    });
    return formatDatabaseResource(row, project.id, cleartextPassword, hosts);
  } catch (error) {
    await provisioner
      .deprovision({
        projectId: target.projectId,
        dbName: target.dbName,
        username: target.username,
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function listProjectDatabases(
  db: Database,
  projectId: string,
): Promise<ProjectDatabaseMetadata[]> {
  await projectForProvisioning(db, projectId);
  const rows = (
    await Promise.all(
      (["postgres", "mongodb", "redis"] as const).map((kind) =>
        findConnectedResources(db, { kind, projectId }),
      ),
    )
  ).flat();
  return rows
    .sort(
      (left, right) =>
        left.resource.createdAt.getTime() - right.resource.createdAt.getTime(),
    )
    .map(({ resource }) => toDatabaseMetadata(resource, projectId));
}

/**
 * Disconnects the resource from this project, and drops it from its engine only
 * when nothing else is connected. Every backfilled resource has exactly one
 * connection, so this drops the database in the same cases the old route did —
 * but once a resource is shared, disconnecting one project can no longer
 * destroy the data the other three are reading.
 */
export async function deprovisionProjectDatabase(
  db: Database,
  registry: ReadonlyMap<DbType, Provisioner>,
  projectId: string,
  databaseId: string,
): Promise<void> {
  const row = await db.query.resources.findFirst({
    where: and(eq(resources.id, databaseId), isNull(resources.deletedAt)),
  });
  if (!row) {
    throw new NotFoundError("Database not found", "DATABASE_NOT_FOUND");
  }
  const record = databaseCredentials(row);
  const connections = await db
    .select({ projectId: resourceConnections.projectId })
    .from(resourceConnections)
    .where(eq(resourceConnections.resourceId, row.id));
  const mine = connections.filter((row) => row.projectId === projectId);
  if (mine.length === 0) {
    throw new NotFoundError("Database not found", "DATABASE_NOT_FOUND");
  }
  const lastConnection = connections.length === mine.length;
  if (lastConnection) {
    const provisioner = registry.get(record.type);
    if (!provisioner) {
      throw new Error(`No ${record.type} provisioner configured`);
    }
    await provisioner.deprovision({
      projectId,
      dbName: record.dbName,
      username: record.username,
    });
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(resourceConnections)
      .where(
        and(
          eq(resourceConnections.resourceId, row.id),
          eq(resourceConnections.projectId, projectId),
        ),
      );
    if (lastConnection) {
      await tx
        .update(resources)
        .set({ deletedAt: new Date() })
        .where(eq(resources.id, row.id));
    }
  });
}

export async function syncRedisProjectAclUsers(
  db: Database,
  redis: RedisCommander,
  encryptionSecret: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(resources)
    .where(and(eq(resources.kind, "redis"), isNull(resources.deletedAt)));
  for (const row of rows) {
    const record = databaseCredentials(row);
    const cleartextPassword = decryptLegacyTotpSecret(
      record.encryptedPassword,
      record.iv,
      record.authTag,
      encryptionSecret,
    );
    await setRedisUser(
      redis,
      record.username,
      cleartextPassword,
      record.dbName,
    );
  }
  if (rows.length > 0) {
    await saveRedisAcls(redis);
  }
  return rows.length;
}
