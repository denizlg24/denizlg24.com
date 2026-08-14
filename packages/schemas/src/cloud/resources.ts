import { z } from "zod";

/**
 * A resource is a datastore that exists on its own — created once, named once,
 * and connected to however many projects need it. The kinds are the daemons the
 * Pi actually runs; `s3` and `meilisearch` join the three databases here
 * because a bucket and a search index are the same sort of thing to a project
 * as a database is, even though they are provisioned differently.
 */
export const RESOURCE_KINDS = [
  "postgres",
  "mongodb",
  "redis",
  "s3",
  "meilisearch",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** The three database kinds, which are the ones with a `db_type` counterpart. */
export const DATABASE_RESOURCE_KINDS = [
  "postgres",
  "mongodb",
  "redis",
] as const;
export type DatabaseResourceKind = (typeof DATABASE_RESOURCE_KINDS)[number];

export function isDatabaseResourceKind(
  kind: ResourceKind,
): kind is DatabaseResourceKind {
  return (DATABASE_RESOURCE_KINDS as readonly string[]).includes(kind);
}

/**
 * Which deployments of a project a connection applies to. `both` is the
 * default because it is what every pre-split project effectively had: one
 * database, used by every deployment alike.
 *
 * `preview` is the ephemeral side only — a custom environment no longer falls
 * under it, and reaches a resource either through `both` or through an
 * `environment` connection naming it. A staging box left off both lists
 * resolves nothing, which is the honest failure: the alternative was staging
 * quietly sharing whatever the previews were pointed at.
 */
export const RESOURCE_CONNECTION_SCOPES = [
  "production",
  "preview",
  "both",
  "environment",
] as const;
export type ResourceConnectionScope =
  (typeof RESOURCE_CONNECTION_SCOPES)[number];

export const resourceKindSchema = z.enum(RESOURCE_KINDS);
export const resourceConnectionScopeSchema = z.enum(RESOURCE_CONNECTION_SCOPES);

/**
 * Empty means "the default connection for this kind" — the one a bare
 * `database.postgres.*` binding resolves to. A non-empty prefix distinguishes a
 * second resource of the same kind on the same project, so it can inject
 * `STAGING_DATABASE_URL` alongside `DATABASE_URL`.
 */
export const resourceEnvPrefixSchema = z
  .string()
  .max(48)
  .regex(
    /^$|^[A-Z][A-Z0-9_]*$/,
    "A prefix is empty or an uppercase environment-variable fragment",
  );

export const resourceNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Lowercase letters, digits and hyphens, starting with a letter or digit",
  );

/**
 * What a browser is allowed to read about a resource. Credentials are never on
 * it: `/resources/[id]` reveals them through a separate call so that listing
 * resources cannot become a way to dump every password at once.
 */
export const resourceSchema = z.object({
  id: z.uuid(),
  kind: resourceKindSchema,
  name: resourceNameSchema,
  engine: z.string().max(64),
  /** The bucket a `s3` resource addresses. Null for every other kind. */
  bucket: z.string().nullable(),
  /** The database name on the engine. Null for `s3` and `meilisearch`. */
  database: z.string().nullable(),
  username: z.string().nullable(),
  connectionCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type Resource = z.infer<typeof resourceSchema>;

export const resourceConnectionSchema = z.object({
  id: z.uuid(),
  resourceId: z.uuid(),
  projectId: z.uuid(),
  scopes: resourceConnectionScopeSchema,
  /** Set on an `environment` connection and null on every other scope. */
  environmentId: z.uuid().nullable(),
  /** Carried with the id because a bare uuid tells a reader nothing. */
  environmentName: z.string().nullable(),
  envPrefix: resourceEnvPrefixSchema,
  createdAt: z.iso.datetime(),
});
export type ResourceConnection = z.infer<typeof resourceConnectionSchema>;

/**
 * The two halves of the scope have to agree: `environment` is the only scope
 * that names one, and it is the only one that may. Written as a refinement so
 * the wire shape stays a flat object rather than a discriminated union.
 */
function scopeNamesItsEnvironment(value: {
  scopes: ResourceConnectionScope;
  environmentId: string | null;
}): boolean {
  return (value.environmentId !== null) === (value.scopes === "environment");
}

const SCOPE_ENVIRONMENT_MISMATCH = {
  error: "An `environment` scope names an environment, and no other scope may",
  path: ["environmentId"],
};

/**
 * `projectId` connects the new resource in the same transaction that creates
 * it, which is what `/[project]/storage`'s "Create new" does. It is optional
 * for the three database kinds — a resource connected to nothing is the normal
 * case for the four applications that deploy on Vercel and only use the Pi's
 * postgres — and required for `s3` and `meilisearch`, which are addressed by a
 * namespace slug rather than by a name they choose.
 */
export const createResourceInputSchema = z
  .object({
    kind: resourceKindSchema,
    /** Derived from the connected project's slug when absent. */
    name: resourceNameSchema.optional(),
    projectId: z.uuid().optional(),
    scopes: resourceConnectionScopeSchema.default("both"),
    environmentId: z.uuid().nullable().default(null),
    envPrefix: resourceEnvPrefixSchema.default(""),
  })
  .refine(scopeNamesItsEnvironment, SCOPE_ENVIRONMENT_MISMATCH);
export type CreateResourceInput = z.infer<typeof createResourceInputSchema>;

export const connectResourceInputSchema = z
  .object({
    projectId: z.uuid(),
    scopes: resourceConnectionScopeSchema.default("both"),
    environmentId: z.uuid().nullable().default(null),
    envPrefix: resourceEnvPrefixSchema.default(""),
  })
  .refine(scopeNamesItsEnvironment, SCOPE_ENVIRONMENT_MISMATCH);
export type ConnectResourceInput = z.infer<typeof connectResourceInputSchema>;

/**
 * What creating a resource answers with. The password is here and nowhere else
 * in the contract: it is the one moment it exists outside the encrypted column,
 * and every later read goes through the credentials reveal.
 */
export const createdResourceSchema = z.object({
  resource: resourceSchema,
  password: z.string().nullable(),
});
export type CreatedResource = z.infer<typeof createdResourceSchema>;

/**
 * A connection carrying the project it points at. The list page shows a
 * resource's consumers by slug, and a resource connected to four projects is
 * the case the split exists to make possible — so the slug travels with the
 * connection rather than costing a lookup per row.
 */
export const resourceConnectionDetailSchema = resourceConnectionSchema.extend({
  projectSlug: z.string(),
  projectName: z.string(),
  /**
   * Null when the project holds no deployable. Four of these applications
   * deploy on Vercel and only use the Pi's postgres, so a connection with
   * nowhere to link to is normal.
   */
  targetId: z.uuid().nullable(),
});
export type ResourceConnectionDetail = z.infer<
  typeof resourceConnectionDetailSchema
>;

export const resourceDetailSchema = resourceSchema.extend({
  connections: z.array(resourceConnectionDetailSchema),
  /** The namespace record naming the on-disk bucket or index prefix. */
  namespaceSlug: z.string().nullable(),
  /**
   * The same record's id. The collections synced into a `meilisearch` resource
   * and the vector indexes beside a `postgres` one are still addressed
   * project-scoped, so the detail page needs the id to reach them.
   */
  namespaceId: z.uuid().nullable(),
});
export type ResourceDetail = z.infer<typeof resourceDetailSchema>;

/**
 * Revealed on demand and never part of a list. Shaped per kind because the
 * three database kinds carry a password while `s3` carries a key pair and
 * `meilisearch` a single API key.
 */
export const resourceCredentialsSchema = z.object({
  resourceId: z.uuid(),
  kind: resourceKindSchema,
  /** Ready to paste. Carries the password inline, as every URL form does. */
  url: z.string().nullable(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  username: z.string().nullable(),
  password: z.string().nullable(),
  database: z.string().nullable(),
  bucket: z.string().nullable(),
  accessKeyId: z.string().nullable(),
  secretAccessKey: z.string().nullable(),
  apiKey: z.string().nullable(),
});
export type ResourceCredentials = z.infer<typeof resourceCredentialsSchema>;

/**
 * A project as the connect picker sees it. `hasTarget` is false for the twelve
 * that exist only to hold a database — they are still valid connection
 * targets, so they are listed rather than filtered out, but nothing links to
 * a project page they do not have.
 */
export const connectableProjectSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  hasTarget: z.boolean(),
});
export type ConnectableProject = z.infer<typeof connectableProjectSchema>;

export const connectableProjectListSchema = z.object({
  projects: z.array(connectableProjectSchema),
});

export const resourceListQuerySchema = z.object({
  kind: resourceKindSchema.nullable().default(null),
  /** Matched against the resource name and its database name. */
  search: z.string().min(1).max(200).nullable().default(null),
  /** `true` narrows to resources nothing connects to — the tidy-up view. */
  unconnected: z.coerce.boolean().default(false),
});
export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

export const resourceListSchema = z.object({
  resources: z.array(resourceSchema),
});
export type ResourceList = z.infer<typeof resourceListSchema>;

/**
 * One connected resource as a project sees it. `injectedKeys` are the env vars
 * on that project's target whose value is a binding reference resolving through
 * this resource — what the connection actually puts in the container, rather
 * than what it theoretically could.
 */
export const projectResourceSchema = z.object({
  resource: resourceSchema,
  connection: resourceConnectionSchema,
  injectedKeys: z.array(
    z.object({
      key: z.string(),
      reference: z.string(),
      secret: z.boolean(),
    }),
  ),
});
export type ProjectResource = z.infer<typeof projectResourceSchema>;

export const projectResourceListSchema = z.object({
  resources: z.array(projectResourceSchema),
});
export type ProjectResourceList = z.infer<typeof projectResourceListSchema>;

/**
 * `both` satisfies every slot. Anything else has to match the deployment being
 * resolved, which is what lets one project hold a production database and a
 * staging database without the preview builds reaching the production one.
 *
 * An environment matches only a connection naming that exact environment — it
 * is deliberately not covered by `preview`. `scopeFilter` in cloud-core is the
 * SQL mirror of this; the two have to move together.
 */
export function connectionAppliesTo(
  connection: {
    scopes: ResourceConnectionScope;
    environmentId: string | null;
  },
  slot: {
    kind: "production" | "preview" | "environment";
    environmentId: string | null;
  },
): boolean {
  if (connection.scopes === "both") return true;
  if (slot.kind === "environment") {
    return (
      connection.scopes === "environment" &&
      connection.environmentId === slot.environmentId
    );
  }
  return connection.scopes === slot.kind;
}

/**
 * An environment as the connect picker sees it. Environments belong to a
 * target and connections belong to a project, so a project with two
 * deployables can offer two environments called `staging` — the target's name
 * travels with each so the picker can tell them apart.
 */
export const connectableEnvironmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  targetId: z.uuid(),
  targetName: z.string(),
});
export type ConnectableEnvironment = z.infer<
  typeof connectableEnvironmentSchema
>;

export const connectableEnvironmentListSchema = z.object({
  environments: z.array(connectableEnvironmentSchema),
});
