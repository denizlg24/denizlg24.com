import type {
  DbType,
  ResourceConnectionScope,
  ResourceKind,
} from "@repo/schemas/cloud";
import { isDatabaseResourceKind } from "@repo/schemas/cloud";
import { and, eq, isNull } from "drizzle-orm";

import { encryptLegacyTotpSecret } from "../auth/legacy-totp";
import type { Database } from "../db";
import {
  type Project,
  projects,
  type ResourceRow,
  resourceConnections,
  resources,
} from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  generateDatabasePassword,
  identifierForSlug,
  type Provisioner,
} from "../projects/provisioning";
import {
  createProjectSearchKey,
  deleteProjectSearchKey,
} from "../search/tokens";
import { availableResourceName, databaseCredentials } from "./resources";

/**
 * The Meilisearch calls a `meilisearch` resource needs, narrowed to the two it
 * makes. Taking the client whole would pull the search dependency into every
 * caller that only ever provisions a database.
 */
export interface SearchKeyClient {
  createKey(input: {
    description: string;
    actions: string[];
    indexes: string[];
    expiresAt: null;
  }): Promise<{ key: string; uid: string }>;
  deleteKey(uid: string): Promise<unknown>;
}

export interface ResourceProvisionDeps {
  registry: ReadonlyMap<DbType, Provisioner>;
  /** Encrypts the generated database password at rest. */
  encryptionSecret: string;
  search: SearchKeyClient;
}

/**
 * The cleartext password is returned once, at creation, because that is the
 * only moment it exists outside the encrypted column. Null for `s3` and
 * `meilisearch`, which carry no password. Anything later reads it back through
 * the credentials reveal.
 */
export interface ProvisionedResource {
  resource: ResourceRow;
  password: string | null;
}

export interface CreateResourceOptions {
  kind: ResourceKind;
  /** Defaults to the connected project's slug. Required when standalone. */
  name?: string | null;
  /**
   * The project to connect the new resource to, and — for `s3` and
   * `meilisearch` — the namespace whose slug addresses the bucket or index
   * prefix. A database needs neither, which is the whole point of the split:
   * four of these applications deploy on Vercel and only use the Pi's postgres.
   */
  projectId?: string | null;
  scopes?: ResourceConnectionScope;
  /** Required by an `environment` scope and meaningless to every other one. */
  environmentId?: string | null;
  envPrefix?: string;
}

async function requireProject(
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
 * Creates a resource on its engine and, when a project is given, connects it in
 * the same transaction — a resource that exists with no connection is invisible
 * to every binding, so a create-then-connect pair would leave a window where
 * the deployment that asked for it cannot resolve it.
 *
 * Unlike `provisionProjectDatabase` this places no limit on how many resources
 * of a kind a project may hold. That limit is the reason twenty projects exist
 * for ten applications, and removing it is what the resource model is for.
 */
export async function provisionResource(
  db: Database,
  deps: ResourceProvisionDeps,
  options: CreateResourceOptions,
): Promise<ProvisionedResource> {
  const project = options.projectId
    ? await requireProject(db, options.projectId)
    : null;

  if (!project && !isDatabaseResourceKind(options.kind)) {
    throw new ValidationError(
      `A ${options.kind} resource is addressed by a project's slug, so it needs a project`,
      "RESOURCE_NAMESPACE_REQUIRED",
    );
  }

  const base = options.name ?? project?.slug;
  if (!base) {
    throw new ValidationError(
      "A resource connected to no project needs a name",
      "RESOURCE_NAME_REQUIRED",
    );
  }

  const name = await availableResourceName(db, options.kind, base);

  if (isDatabaseResourceKind(options.kind)) {
    return provisionDatabaseResource(db, deps, options, project, name);
  }
  if (!project) {
    throw new ValidationError(
      `A ${options.kind} resource needs a project`,
      "RESOURCE_NAMESPACE_REQUIRED",
    );
  }
  const resource =
    options.kind === "meilisearch"
      ? await provisionSearchResource(db, deps, options, project, name)
      : await provisionBucketResource(db, options, project, name);
  return { password: null, resource };
}

async function insertResource(
  db: Database,
  values: typeof resources.$inferInsert,
  connect: {
    projectId: string;
    scopes: ResourceConnectionScope;
    environmentId: string | null;
    envPrefix: string;
  } | null,
): Promise<ResourceRow> {
  return db.transaction(async (tx) => {
    const [resource] = await tx.insert(resources).values(values).returning();
    if (!resource) {
      throw new Error("Failed to save resource");
    }
    if (connect) {
      await tx.insert(resourceConnections).values({
        environmentId: connect.environmentId,
        envPrefix: connect.envPrefix,
        projectId: connect.projectId,
        resourceId: resource.id,
        scopes: connect.scopes,
      });
    }
    return resource;
  });
}

function connectionFor(
  project: Project | null,
  options: CreateResourceOptions,
) {
  if (!project) return null;
  const scopes = options.scopes ?? ("both" as const);
  return {
    environmentId:
      scopes === "environment" ? (options.environmentId ?? null) : null,
    envPrefix: options.envPrefix ?? "",
    projectId: project.id,
    scopes,
  };
}

async function provisionDatabaseResource(
  db: Database,
  deps: ResourceProvisionDeps,
  options: CreateResourceOptions,
  project: Project | null,
  name: string,
): Promise<ProvisionedResource> {
  const kind = options.kind as DbType;
  const provisioner = deps.registry.get(kind);
  if (!provisioner) {
    throw new Error(`No ${kind} provisioner configured`);
  }

  // From the resolved name, not from the project slug: the name is unique per
  // kind, so two postgres resources on one project get two databases rather
  // than two rows pointing at the same one.
  const identifier = identifierForSlug(name);
  const cleartextPassword = generateDatabasePassword();

  await provisioner.provision({
    dbName: identifier,
    password: cleartextPassword,
    projectId: project?.id ?? null,
    projectSlug: project?.slug ?? null,
    username: identifier,
  });

  try {
    const encrypted = encryptLegacyTotpSecret(
      cleartextPassword,
      deps.encryptionSecret,
    );
    const resource = await insertResource(
      db,
      {
        authTag: encrypted.authTag,
        dbName: identifier,
        encryptedPassword: encrypted.encrypted,
        iv: encrypted.iv,
        kind,
        name,
        username: identifier,
      },
      connectionFor(project, options),
    );
    return { password: cleartextPassword, resource };
  } catch (error) {
    await provisioner
      .deprovision({
        dbName: identifier,
        projectId: project?.id ?? null,
        username: identifier,
      })
      .catch(() => undefined);
    throw error;
  }
}

/**
 * One search key per project, matching what `ensureMeiliKey` has always done:
 * the key is scoped to an index prefix derived from the slug, so a second key
 * on the same namespace would grant exactly the same access.
 */
async function provisionSearchResource(
  db: Database,
  deps: ResourceProvisionDeps,
  options: CreateResourceOptions,
  project: Project,
  name: string,
): Promise<ResourceRow> {
  const existing = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.kind, "meilisearch"),
        eq(resources.namespaceId, project.id),
        isNull(resources.deletedAt),
      ),
    );
  if (existing.length > 0) {
    throw new ConflictError(
      "That project already has a search key",
      "SEARCH_KEY_EXISTS",
    );
  }

  const { key, uid } = await createProjectSearchKey(deps.search, project.slug);
  try {
    return await insertResource(
      db,
      {
        kind: "meilisearch",
        meiliApiKey: key,
        meiliApiKeyUid: uid,
        name,
        namespaceId: project.id,
      },
      connectionFor(project, options),
    );
  } catch (error) {
    await deleteProjectSearchKey(deps.search, uid).catch(() => undefined);
    throw error;
  }
}

/**
 * No engine call: a bucket is a directory under `.s3-v2` that the first
 * `CreateBucket` creates. The row records which bucket the project addresses,
 * explicitly rather than by deriving it from the slug again — deriving it is
 * what would make the project unrenameable.
 */
async function provisionBucketResource(
  db: Database,
  options: CreateResourceOptions,
  project: Project,
  name: string,
): Promise<ResourceRow> {
  const existing = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.kind, "s3"),
        eq(resources.bucket, project.slug),
        isNull(resources.deletedAt),
      ),
    );
  if (existing.length > 0) {
    throw new ConflictError(
      "That bucket already has a resource",
      "BUCKET_EXISTS",
    );
  }

  return insertResource(
    db,
    {
      bucket: project.slug,
      kind: "s3",
      name,
      namespaceId: project.id,
    },
    connectionFor(project, options),
  );
}

/**
 * Drops a resource and everything backing it.
 *
 * Refuses while anything is still connected. Disconnecting is the reversible
 * act and this one is not, so the two are kept separate rather than having a
 * delete quietly cut four projects loose from the database they read.
 *
 * An `s3` resource loses only its row. The bucket directory and its contents
 * survive, because the alternative is deleting the data of every dependent
 * project that signs with the legacy key pair, and nothing here can tell
 * whether that is what was meant.
 */
export async function deprovisionResource(
  db: Database,
  deps: ResourceProvisionDeps,
  resourceId: string,
): Promise<void> {
  const row = await db.query.resources.findFirst({
    where: and(eq(resources.id, resourceId), isNull(resources.deletedAt)),
  });
  if (!row) {
    throw new NotFoundError("Resource not found", "RESOURCE_NOT_FOUND");
  }

  const connections = await db
    .select({ id: resourceConnections.id })
    .from(resourceConnections)
    .where(eq(resourceConnections.resourceId, row.id));
  if (connections.length > 0) {
    throw new ConflictError(
      "Disconnect that resource from every project before deleting it",
      "RESOURCE_CONNECTED",
    );
  }

  if (isDatabaseResourceKind(row.kind)) {
    const record = databaseCredentials(row);
    const provisioner = deps.registry.get(record.type);
    if (!provisioner) {
      throw new Error(`No ${record.type} provisioner configured`);
    }
    await provisioner.deprovision({
      dbName: record.dbName,
      projectId: row.namespaceId,
      username: record.username,
    });
  } else if (row.kind === "meilisearch" && row.meiliApiKeyUid) {
    await deleteProjectSearchKey(deps.search, row.meiliApiKeyUid).catch(
      () => undefined,
    );
  }

  await db
    .update(resources)
    .set({ deletedAt: new Date() })
    .where(eq(resources.id, row.id));
}
