import type {
  DbType,
  DeploymentKind,
  ProjectDatabase as ProjectDatabaseContract,
  ProjectDatabaseMetadata,
  Resource,
  ResourceConnectionScope,
  ResourceKind,
} from "@repo/schemas/cloud";
import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../db";
import {
  deployEnvironments,
  deployTargets,
  projects,
  type ResourceConnectionRow,
  type ResourceRow,
  resourceConnections,
  resources,
} from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";

/** cloud-core exports `Database` but not its transaction handle; derive it. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Every helper here takes either, because provisioning a resource and
 * connecting it have to happen in one transaction — a resource that exists with
 * no connection is invisible to every binding.
 */
export type DbExecutor = Database | Transaction;

export interface ConnectedResource {
  resource: ResourceRow;
  connection: ResourceConnectionRow;
}

/**
 * A connection with an empty prefix is the default one — what a bare
 * `database.postgres.*` binding resolves to. Ordering on "has a prefix" rather
 * than on the prefix itself keeps that rule independent of how the database
 * collates the empty string, and the `createdAt` tiebreak makes the pick
 * deterministic when a project has several prefixed resources of one kind and
 * no default.
 */
const DEFAULT_CONNECTION_FIRST = [
  /**
   * A connection naming this exact environment outranks the `both` one it
   * shares a prefix with — otherwise giving staging its own database would
   * depend on which row happened to be created first.
   */
  asc(sql`${resourceConnections.environmentId} IS NULL`),
  asc(sql`${resourceConnections.envPrefix} <> ''`),
  asc(resourceConnections.createdAt),
];

/**
 * The SQL mirror of `connectionAppliesTo`. `both` satisfies every slot; a
 * custom environment otherwise resolves only a connection naming it, because
 * `preview` covers the ephemeral side alone.
 *
 * Erring the other way is the failure that matters: an environment silently
 * inheriting whatever the previews — or worse, production — were pointed at
 * would write to data it was never given, with nothing in the UI saying so.
 * An environment nobody connected anything to resolves nothing, and an unset
 * namespace is a visible failure where a borrowed database is not.
 */
function scopeFilter(
  deploymentKind: DeploymentKind | undefined,
  environmentId: string | null | undefined,
) {
  if (!deploymentKind) return undefined;
  if (deploymentKind === "environment") {
    // An `environment` deployment with no environment on it cannot match a
    // named connection, so it is left with the unscoped ones.
    if (!environmentId) return eq(resourceConnections.scopes, "both");
    return or(
      eq(resourceConnections.scopes, "both"),
      and(
        eq(resourceConnections.scopes, "environment"),
        eq(resourceConnections.environmentId, environmentId),
      ),
    );
  }
  return inArray(resourceConnections.scopes, ["both", deploymentKind]);
}

export interface ConnectedResourceQuery {
  projectId: string;
  kind: ResourceKind;
  /**
   * Narrows to connections that apply to this side. Omitted means "any", which
   * is what the pre-flight availability check wants: a preview-only database
   * still makes `database.postgres.*` a bindable reference on the target.
   */
  deploymentKind?: DeploymentKind;
  /** Which environment, when `deploymentKind` is `environment`. */
  environmentId?: string | null;
  envPrefix?: string;
}

export async function findConnectedResources(
  db: DbExecutor,
  query: ConnectedResourceQuery,
): Promise<ConnectedResource[]> {
  const rows = await db
    .select({ connection: resourceConnections, resource: resources })
    .from(resourceConnections)
    .innerJoin(resources, eq(resources.id, resourceConnections.resourceId))
    .where(
      and(
        eq(resourceConnections.projectId, query.projectId),
        eq(resources.kind, query.kind),
        isNull(resources.deletedAt),
        scopeFilter(query.deploymentKind, query.environmentId),
        query.envPrefix === undefined
          ? undefined
          : eq(resourceConnections.envPrefix, query.envPrefix),
      ),
    )
    .orderBy(...DEFAULT_CONNECTION_FIRST);
  return rows;
}

/**
 * The single resource a binding reference resolves to. `null` means the project
 * has nothing of this kind connected on this side, which the resolver turns
 * into an unset namespace rather than a blank connection string.
 */
export async function resolveConnectedResource(
  db: DbExecutor,
  query: ConnectedResourceQuery,
): Promise<ConnectedResource | null> {
  const [first] = await findConnectedResources(db, query);
  return first ?? null;
}

/** Which kinds this project has connected, used to build binding availability. */
export async function connectedResourceKinds(
  db: DbExecutor,
  projectId: string,
  deploymentKind?: DeploymentKind,
  environmentId?: string | null,
): Promise<Set<ResourceKind>> {
  const rows = await db
    .selectDistinct({ kind: resources.kind })
    .from(resourceConnections)
    .innerJoin(resources, eq(resources.id, resourceConnections.resourceId))
    .where(
      and(
        eq(resourceConnections.projectId, projectId),
        isNull(resources.deletedAt),
        scopeFilter(deploymentKind, environmentId),
      ),
    );
  return new Set(rows.map((row) => row.kind));
}

export async function getResource(
  db: DbExecutor,
  resourceId: string,
): Promise<ResourceRow> {
  const row = await db.query.resources.findFirst({
    where: and(eq(resources.id, resourceId), isNull(resources.deletedAt)),
  });
  if (!row) {
    throw new NotFoundError("Resource not found", "RESOURCE_NOT_FOUND");
  }
  return row;
}

/**
 * `name` is unique per kind among live rows, so a second postgres resource for
 * a project whose slug is already taken gets `-2`, `-3` and so on rather than
 * failing the insert. Soft-deleted names are reusable, which is why this
 * counts only live rows.
 */
export async function availableResourceName(
  db: DbExecutor,
  kind: ResourceKind,
  base: string,
): Promise<string> {
  const taken = await db
    .select({ name: resources.name })
    .from(resources)
    .where(
      and(
        eq(resources.kind, kind),
        isNull(resources.deletedAt),
        sql`${resources.name} = ${base} OR ${resources.name} LIKE ${`${base}-%`}`,
      ),
    );
  const names = new Set(taken.map((row) => row.name));
  if (!names.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

export interface ConnectResourceOptions {
  resourceId: string;
  projectId: string;
  scopes?: ResourceConnectionScope;
  /** Required by an `environment` scope and meaningless to every other one. */
  environmentId?: string | null;
  envPrefix?: string;
}

export async function connectResource(
  db: DbExecutor,
  options: ConnectResourceOptions,
): Promise<ResourceConnectionRow> {
  const scopes = options.scopes ?? "both";
  const [row] = await db
    .insert(resourceConnections)
    .values({
      environmentId: scopes === "environment" ? options.environmentId : null,
      envPrefix: options.envPrefix ?? "",
      projectId: options.projectId,
      resourceId: options.resourceId,
      scopes,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    throw new ConflictError(
      "That resource is already connected to this project under the same prefix",
      "RESOURCE_ALREADY_CONNECTED",
    );
  }
  return row;
}

/**
 * A connection is project-scoped and an environment is target-scoped, so
 * nothing in the column types stops one project's connection naming another
 * project's environment. This is the check that does.
 */
export async function assertEnvironmentInProject(
  db: DbExecutor,
  projectId: string,
  environmentId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: deployEnvironments.id })
    .from(deployEnvironments)
    .innerJoin(deployTargets, eq(deployTargets.id, deployEnvironments.targetId))
    .where(
      and(
        eq(deployEnvironments.id, environmentId),
        eq(deployTargets.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new NotFoundError(
      "Environment not found on this project",
      "ENVIRONMENT_NOT_FOUND",
    );
  }
}

/** The environments a project can scope a connection to, across its targets. */
export async function connectableEnvironments(
  db: DbExecutor,
  projectId: string,
): Promise<
  { id: string; name: string; targetId: string; targetName: string }[]
> {
  return db
    .select({
      id: deployEnvironments.id,
      name: deployEnvironments.name,
      targetId: deployTargets.id,
      targetName: deployTargets.name,
    })
    .from(deployEnvironments)
    .innerJoin(deployTargets, eq(deployTargets.id, deployEnvironments.targetId))
    .where(eq(deployTargets.projectId, projectId))
    .orderBy(asc(deployTargets.name), asc(deployEnvironments.name));
}

export async function disconnectResource(
  db: DbExecutor,
  connectionId: string,
): Promise<void> {
  const deleted = await db
    .delete(resourceConnections)
    .where(eq(resourceConnections.id, connectionId))
    .returning({ id: resourceConnections.id });
  if (deleted.length === 0) {
    throw new NotFoundError("Connection not found", "CONNECTION_NOT_FOUND");
  }
}

export interface ListResourcesQuery {
  kind?: ResourceKind | null;
  search?: string | null;
  /** Only resources nothing connects to. */
  unconnected?: boolean;
}

/**
 * Every live resource, kind-major so the list reads as groups without the page
 * having to sort it. Counts are looked up separately rather than joined: a
 * resource connected to nothing has to stay in the result, and that is the
 * normal case for the four applications that deploy on Vercel and only use the
 * Pi's postgres.
 */
export async function listResources(
  db: DbExecutor,
  query: ListResourcesQuery = {},
): Promise<{ row: ResourceRow; connectionCount: number }[]> {
  const rows = await db
    .select()
    .from(resources)
    .where(
      and(
        isNull(resources.deletedAt),
        query.kind ? eq(resources.kind, query.kind) : undefined,
        query.search
          ? or(
              ilike(resources.name, `%${query.search}%`),
              ilike(resources.dbName, `%${query.search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(resources.kind), asc(resources.name));
  const counts = await resourceConnectionCounts(
    db,
    rows.map((row) => row.id),
  );
  return rows
    .map((row) => ({ connectionCount: counts.get(row.id) ?? 0, row }))
    .filter((entry) => !query.unconnected || entry.connectionCount === 0);
}

export interface ResourceConnectionDetailRow {
  connection: ResourceConnectionRow;
  projectSlug: string;
  projectName: string;
  targetId: string | null;
}

/**
 * A resource's consumers. The deploy target is joined in so the UI can link a
 * connection at the project page it belongs to; it stays `null` for a project
 * that holds no deployable, which is not an error condition.
 */
export async function resourceConnectionDetails(
  db: DbExecutor,
  resourceId: string,
): Promise<ResourceConnectionDetailRow[]> {
  return db
    .select({
      connection: resourceConnections,
      projectName: projects.name,
      projectSlug: projects.slug,
      targetId: deployTargets.id,
    })
    .from(resourceConnections)
    .innerJoin(projects, eq(projects.id, resourceConnections.projectId))
    .leftJoin(deployTargets, eq(deployTargets.projectId, projects.id))
    .where(eq(resourceConnections.resourceId, resourceId))
    .orderBy(asc(projects.slug), asc(resourceConnections.envPrefix));
}

/**
 * Everything one project has connected, in the order the storage tab lists it.
 * Unlike `findConnectedResources` this is not narrowed to a kind or a scope —
 * the tab shows the whole set, including a preview-only database that no
 * production build will ever resolve.
 */
export async function projectConnectedResources(
  db: DbExecutor,
  projectId: string,
): Promise<ConnectedResource[]> {
  return db
    .select({ connection: resourceConnections, resource: resources })
    .from(resourceConnections)
    .innerJoin(resources, eq(resources.id, resourceConnections.resourceId))
    .where(
      and(
        eq(resourceConnections.projectId, projectId),
        isNull(resources.deletedAt),
      ),
    )
    .orderBy(asc(resources.kind), ...DEFAULT_CONNECTION_FIRST);
}

export async function resourceConnectionCounts(
  db: DbExecutor,
  resourceIds: readonly string[],
): Promise<Map<string, number>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db
    .select({
      resourceId: resourceConnections.resourceId,
      total: count(),
    })
    .from(resourceConnections)
    .where(inArray(resourceConnections.resourceId, [...resourceIds]))
    .groupBy(resourceConnections.resourceId);
  return new Map(rows.map((row) => [row.resourceId, row.total]));
}

export function toResourceContract(
  row: ResourceRow,
  connectionCount: number,
): Resource {
  return {
    bucket: row.bucket,
    connectionCount,
    createdAt: row.createdAt.toISOString(),
    database: row.dbName,
    engine: row.engine,
    id: row.id,
    kind: row.kind,
    name: row.name,
    username: row.username,
  };
}

/**
 * The database kinds are the ones that carry credentials in the shape the old
 * `project_databases` row did. Narrowing here rather than at every call site
 * keeps the non-null assertions in one place, backed by the
 * `resources_kind_shape` check constraint.
 */
export interface DatabaseResourceCredentials {
  type: DbType;
  dbName: string;
  username: string;
  encryptedPassword: string;
  iv: string;
  authTag: string;
}

export function databaseCredentials(
  row: ResourceRow,
): DatabaseResourceCredentials {
  if (
    row.kind === "s3" ||
    row.kind === "meilisearch" ||
    row.dbName === null ||
    row.username === null ||
    row.encryptedPassword === null ||
    row.iv === null ||
    row.authTag === null
  ) {
    throw new Error(`Resource ${row.id} carries no database credentials`);
  }
  return {
    authTag: row.authTag,
    dbName: row.dbName,
    encryptedPassword: row.encryptedPassword,
    iv: row.iv,
    type: row.kind,
    username: row.username,
  };
}

/**
 * Keeps `GET /projects/:id/databases` answering exactly what it did before the
 * resource split. The contract still carries a `projectId` because the route is
 * project-scoped; it now comes from the connection rather than from the
 * resource, which is what makes one database shared by four projects possible.
 */
export function toDatabaseMetadata(
  row: ResourceRow,
  projectId: string,
): ProjectDatabaseMetadata {
  const credentials = databaseCredentials(row);
  return {
    createdAt: row.createdAt.toISOString(),
    dbName: credentials.dbName,
    id: row.id,
    projectId,
    type: credentials.type,
    username: credentials.username,
    ...(credentials.type === "redis"
      ? { keyPrefix: `${credentials.dbName}:` }
      : {}),
  };
}

export type { ProjectDatabaseContract };
