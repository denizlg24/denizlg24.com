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
 * database, used by production and previews alike.
 */
export const RESOURCE_CONNECTION_SCOPES = [
  "production",
  "preview",
  "both",
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
  envPrefix: resourceEnvPrefixSchema,
  createdAt: z.iso.datetime(),
});
export type ResourceConnection = z.infer<typeof resourceConnectionSchema>;

export const createResourceInputSchema = z.object({
  kind: resourceKindSchema,
  /** Derived from the connected project's slug when absent. */
  name: resourceNameSchema.optional(),
  engine: z.string().max(64).optional(),
});
export type CreateResourceInput = z.infer<typeof createResourceInputSchema>;

export const connectResourceInputSchema = z.object({
  projectId: z.uuid(),
  scopes: resourceConnectionScopeSchema.default("both"),
  envPrefix: resourceEnvPrefixSchema.default(""),
});
export type ConnectResourceInput = z.infer<typeof connectResourceInputSchema>;

/**
 * `both` satisfies either side. Anything else has to match the deployment being
 * resolved, which is what lets one project hold a production database and a
 * staging database without the preview builds reaching the production one.
 */
export function connectionAppliesTo(
  scopes: ResourceConnectionScope,
  kind: "production" | "preview",
): boolean {
  return scopes === "both" || scopes === kind;
}
