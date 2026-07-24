import { z } from "zod";

import { cloudDateTimeSchema } from "./common";

const projectSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);
const databaseIdentifierSchema = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
const mongoResourceNameSchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)
  .refine((value) => !value.includes("$"));
const mongoFieldPathSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/);
const collectionNameSchema = z
  .string()
  .max(50)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);

export const safeProjectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  ownerId: z.uuid(),
  storageFolderId: z.uuid().nullable(),
  meiliApiKeyUid: z.string().nullable(),
  meiliApiKey: z.string().nullable(),
  createdAt: cloudDateTimeSchema,
  updatedAt: cloudDateTimeSchema,
});
export type SafeProject = z.infer<typeof safeProjectSchema>;

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1),
  slug: projectSlugSchema,
  description: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const fieldMappingSchema = z.object({
  includeFields: z.array(z.string()).optional(),
  excludeFields: z.array(z.string()).optional(),
  searchableAttributes: z.array(z.string()).optional(),
  filterableAttributes: z.array(z.string()).optional(),
  sortableAttributes: z.array(z.string()).optional(),
  primaryKey: z.string().optional(),
});
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

export const syncStatusSchema = z.enum(["idle", "syncing", "error"]);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const collectionSourceTypeSchema = z.enum(["mongodb", "postgres"]);
export type CollectionSourceType = z.infer<typeof collectionSourceTypeSchema>;

export const safeProjectCollectionSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  sourceType: collectionSourceTypeSchema,
  mongoDatabase: z.string().nullable(),
  mongoCollection: z.string().nullable(),
  pgDatabase: z.string().nullable(),
  pgSchema: z.string().nullable(),
  pgTable: z.string().nullable(),
  pgIdColumn: z.string().nullable(),
  pgOutboxCursor: z.number(),
  meiliIndexUid: z.string(),
  fieldMapping: fieldMappingSchema,
  syncEnabled: z.boolean(),
  syncStatus: syncStatusSchema,
  resumeToken: z.record(z.string(), z.unknown()).nullable(),
  lastSyncedAt: cloudDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  documentCount: z.number().int(),
  createdAt: cloudDateTimeSchema,
  updatedAt: cloudDateTimeSchema,
});
export type SafeProjectCollection = z.infer<typeof safeProjectCollectionSchema>;

const mongoCollectionSourceSchema = z.object({
  name: collectionNameSchema,
  sourceType: z.literal("mongodb"),
  fieldMapping: fieldMappingSchema.optional(),
  mongoDatabase: mongoResourceNameSchema,
  mongoCollection: mongoResourceNameSchema,
});

const postgresCollectionSourceSchema = z.object({
  name: collectionNameSchema,
  sourceType: z.literal("postgres"),
  fieldMapping: fieldMappingSchema.optional(),
  pgDatabase: databaseIdentifierSchema,
  pgSchema: databaseIdentifierSchema,
  pgTable: databaseIdentifierSchema,
  pgIdColumn: databaseIdentifierSchema,
});

export const createCollectionInputSchema = z.discriminatedUnion("sourceType", [
  mongoCollectionSourceSchema,
  postgresCollectionSourceSchema,
]);
export type CreateCollectionInput = z.infer<typeof createCollectionInputSchema>;

export const updateCollectionInputSchema = z.object({
  fieldMapping: fieldMappingSchema.optional(),
  syncEnabled: z.boolean().optional(),
});
export type UpdateCollectionInput = z.infer<typeof updateCollectionInputSchema>;

export const discoverFieldsInputSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("mongodb"),
    mongoDatabase: mongoResourceNameSchema,
    mongoCollection: mongoResourceNameSchema,
  }),
  z.object({
    sourceType: z.literal("postgres"),
    pgDatabase: databaseIdentifierSchema,
    pgSchema: databaseIdentifierSchema,
    pgTable: databaseIdentifierSchema,
  }),
]);
export type DiscoverFieldsInput = z.infer<typeof discoverFieldsInputSchema>;

export const discoveredFieldSchema = z.object({
  name: z.string(),
  types: z.array(z.string()),
});
export type DiscoveredField = z.infer<typeof discoveredFieldSchema>;

export const discoverFieldsResultSchema = z.object({
  fields: z.array(discoveredFieldSchema),
  sampleCount: z.number().int(),
});
export type DiscoverFieldsResult = z.infer<typeof discoverFieldsResultSchema>;

export const searchRulesSchema = z.record(
  z.string(),
  z.object({ filter: z.string().optional() }).nullable(),
);
export type SearchRules = z.infer<typeof searchRulesSchema>;

export const generateSearchTokenInputSchema = z.object({
  expiresInHours: z.number().positive().optional(),
  searchRules: searchRulesSchema.optional(),
});
export type GenerateSearchTokenInput = z.infer<
  typeof generateSearchTokenInputSchema
>;

export const searchTokenResultSchema = z.object({
  token: z.string(),
  expiresAt: cloudDateTimeSchema,
});
export type SearchTokenResult = z.infer<typeof searchTokenResultSchema>;

export const dbTypeSchema = z.enum(["postgres", "mongodb", "redis"]);
export type DbType = z.infer<typeof dbTypeSchema>;

export const projectDatabaseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  type: dbTypeSchema,
  dbName: z.string(),
  username: z.string(),
  password: z.string(),
  keyPrefix: z.string().optional(),
  uris: z.object({
    internal: z.string(),
    external: z.string(),
  }),
  createdAt: cloudDateTimeSchema,
});
export type ProjectDatabase = z.infer<typeof projectDatabaseSchema>;

export const projectDatabaseMetadataSchema = projectDatabaseSchema.omit({
  password: true,
  uris: true,
});
export type ProjectDatabaseMetadata = z.infer<
  typeof projectDatabaseMetadataSchema
>;

export const provisionDatabaseInputSchema = z.object({
  type: dbTypeSchema,
});
export type ProvisionDatabaseInput = z.infer<
  typeof provisionDatabaseInputSchema
>;

export const s3CredentialsSchema = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(true),
    endpoint: z.string(),
    region: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    shared: z.literal(true),
  }),
  z.object({
    enabled: z.literal(false),
    endpoint: z.string(),
    region: z.string(),
    shared: z.literal(true),
  }),
]);
export type S3Credentials = z.infer<typeof s3CredentialsSchema>;

export const createProjectS3CredentialInputSchema = z.object({
  label: z.string().trim().min(1).max(255),
});
export type CreateProjectS3CredentialInput = z.infer<
  typeof createProjectS3CredentialInputSchema
>;

export const projectS3CredentialMetadataSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  accessKeyId: z.string(),
  label: z.string(),
  createdAt: cloudDateTimeSchema,
  lastUsedAt: cloudDateTimeSchema.nullable(),
  revokedAt: cloudDateTimeSchema.nullable(),
});
export type ProjectS3CredentialMetadata = z.infer<
  typeof projectS3CredentialMetadataSchema
>;

export const issuedProjectS3CredentialSchema =
  projectS3CredentialMetadataSchema.extend({
    secretAccessKey: z.string(),
  });
export type IssuedProjectS3Credential = z.infer<
  typeof issuedProjectS3CredentialSchema
>;

export const vectorSimilaritySchema = z.enum([
  "cosine",
  "euclidean",
  "dotProduct",
]);
export type VectorSimilarity = z.infer<typeof vectorSimilaritySchema>;

export const vectorQuantizationSchema = z.enum(["none", "scalar", "binary"]);
export type VectorQuantization = z.infer<typeof vectorQuantizationSchema>;

export const projectVectorIndexSchema = z.object({
  collection: z.string(),
  name: z.string(),
  status: z.string(),
  queryable: z.boolean(),
  path: z.string(),
  numDimensions: z.number().int(),
  similarity: vectorSimilaritySchema,
  quantization: vectorQuantizationSchema,
  filterPaths: z.array(z.string()),
});
export type ProjectVectorIndex = z.infer<typeof projectVectorIndexSchema>;

export const projectVectorSearchOverviewSchema = z.object({
  database: z.string(),
  collections: z.array(z.string()),
  indexes: z.array(projectVectorIndexSchema),
  mongot: z.object({
    status: z.enum(["ready", "unavailable"]),
    message: z.string().optional(),
  }),
  maxIndexes: z.number().int(),
});
export type ProjectVectorSearchOverview = z.infer<
  typeof projectVectorSearchOverviewSchema
>;

export const createProjectVectorIndexInputSchema = z
  .object({
    collection: mongoResourceNameSchema,
    name: mongoResourceNameSchema,
    path: mongoFieldPathSchema,
    numDimensions: z.number().int().min(1).max(4096),
    similarity: vectorSimilaritySchema,
    quantization: vectorQuantizationSchema.default("none"),
    filterPaths: z
      .array(mongoFieldPathSchema)
      .max(5)
      .default([])
      .transform((paths) => [...new Set(paths)]),
  })
  .refine((input) => !input.filterPaths.includes(input.path), {
    message: "The vector path cannot also be a filter path",
    path: ["filterPaths"],
  });
export type CreateProjectVectorIndexInput = z.infer<
  typeof createProjectVectorIndexInputSchema
>;
