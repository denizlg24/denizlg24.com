import { randomBytes } from "node:crypto";

import type {
  DbType,
  ProjectDatabase as ProjectDatabaseContract,
  ProjectDatabaseMetadata,
} from "@repo/schemas/cloud";
import { and, eq } from "drizzle-orm";
import type { MongoClient } from "mongodb";

import {
  decryptLegacyTotpSecret,
  encryptLegacyTotpSecret,
} from "../auth/legacy-totp";
import type { Database, RawSqlClient } from "../db";
import { createRawClient } from "../db";
import {
  type Project,
  type ProjectDatabase,
  projectDatabases,
  projects,
} from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";

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
  record: Pick<ProjectDatabase, "dbName" | "type" | "username">,
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

export function formatProjectDatabase(
  record: ProjectDatabase,
  secret: string,
  hosts: ProjectDatabaseHosts,
): ProjectDatabaseContract {
  const pair: readonly [string, string] =
    record.type === "postgres"
      ? [hosts.postgresInternal, hosts.postgresExternal]
      : record.type === "mongodb"
        ? [hosts.mongodbInternal, hosts.mongodbExternal]
        : [hosts.redisInternal, hosts.redisExternal];
  return {
    id: record.id,
    projectId: record.projectId,
    type: record.type,
    dbName: record.dbName,
    username: record.username,
    password: secret,
    ...(record.type === "redis" ? { keyPrefix: `${record.dbName}:` } : {}),
    uris: {
      internal: connectionUri(record, secret, pair[0]),
      external: connectionUri(record, secret, pair[1]),
    },
    createdAt: record.createdAt.toISOString(),
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

export async function provisionProjectDatabase(
  db: Database,
  registry: ReadonlyMap<DbType, Provisioner>,
  encryptionSecret: string,
  hosts: ProjectDatabaseHosts,
  input: { projectId: string; type: DbType },
): Promise<ProjectDatabaseContract> {
  const project = await projectForProvisioning(db, input.projectId);
  const existing = await db.query.projectDatabases.findFirst({
    where: and(
      eq(projectDatabases.projectId, input.projectId),
      eq(projectDatabases.type, input.type),
    ),
  });
  if (existing) {
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
    const [record] = await db
      .insert(projectDatabases)
      .values({
        projectId: project.id,
        type: input.type,
        dbName: identifier,
        username: identifier,
        encryptedPassword: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      })
      .returning();
    if (!record) {
      throw new Error("Failed to save project database");
    }
    return formatProjectDatabase(record, cleartextPassword, hosts);
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
  const records = await db
    .select()
    .from(projectDatabases)
    .where(eq(projectDatabases.projectId, projectId))
    .orderBy(projectDatabases.createdAt);
  return records.map((record) => ({
    id: record.id,
    projectId: record.projectId,
    type: record.type,
    dbName: record.dbName,
    username: record.username,
    ...(record.type === "redis" ? { keyPrefix: `${record.dbName}:` } : {}),
    createdAt: record.createdAt.toISOString(),
  }));
}

export async function deprovisionProjectDatabase(
  db: Database,
  registry: ReadonlyMap<DbType, Provisioner>,
  projectId: string,
  databaseId: string,
): Promise<void> {
  const record = await db.query.projectDatabases.findFirst({
    where: and(
      eq(projectDatabases.id, databaseId),
      eq(projectDatabases.projectId, projectId),
    ),
  });
  if (!record) {
    throw new NotFoundError("Database not found", "DATABASE_NOT_FOUND");
  }
  const provisioner = registry.get(record.type);
  if (!provisioner) {
    throw new Error(`No ${record.type} provisioner configured`);
  }
  await provisioner.deprovision({
    projectId: record.projectId,
    dbName: record.dbName,
    username: record.username,
  });
  await db.delete(projectDatabases).where(eq(projectDatabases.id, record.id));
}

export async function syncRedisProjectAclUsers(
  db: Database,
  redis: RedisCommander,
  encryptionSecret: string,
): Promise<number> {
  const records = await db
    .select()
    .from(projectDatabases)
    .where(eq(projectDatabases.type, "redis"));
  for (const record of records) {
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
  if (records.length > 0) {
    await saveRedisAcls(redis);
  }
  return records.length;
}
