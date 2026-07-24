import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import { storageTierSchema } from "./storage";

export const postgresIdentifierSchema = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
export const mongoResourceNameSchema = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/)
  .refine((value) => !value.includes("$") && !value.includes("\0"));

export const diskInfoSchema = z.object({
  device: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  availableBytes: z.number(),
  usagePercent: z.number(),
  online: z.boolean(),
});
export type DiskInfo = z.infer<typeof diskInfoSchema>;

export const systemStatsSchema = z.object({
  cpu: z.object({
    usagePercent: z.number(),
    cores: z.number().int(),
  }),
  cpuTemp: z.number().nullable(),
  memory: z.object({
    totalBytes: z.number(),
    usedBytes: z.number(),
    availableBytes: z.number(),
    usagePercent: z.number(),
  }),
  disk: z.object({
    ssd: diskInfoSchema.nullable(),
    hdd: z.array(diskInfoSchema),
    microsd: diskInfoSchema.nullable(),
  }),
  timestamp: cloudDateTimeSchema,
});
export type SystemStats = z.infer<typeof systemStatsSchema>;

export const storageStatsSchema = z.object({
  files: z.object({
    count: z.number().int(),
    totalSizeBytes: z.number(),
  }),
  tiers: z.object({
    ssd: z.object({
      fileCount: z.number().int(),
      totalSizeBytes: z.number(),
    }),
    hdd: z.object({
      fileCount: z.number().int(),
      totalSizeBytes: z.number(),
    }),
  }),
  folders: z.object({ count: z.number().int() }),
  users: z.object({ count: z.number().int() }),
  activeSessions: z.object({ count: z.number().int() }),
  timestamp: cloudDateTimeSchema,
});
export type StorageStats = z.infer<typeof storageStatsSchema>;

export const userStorageStatSchema = z.object({
  userId: z.uuid(),
  username: z.string(),
  fileCount: z.number().int(),
  totalSizeBytes: z.number(),
});
export type UserStorageStat = z.infer<typeof userStorageStatSchema>;

export const largestFileSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  path: z.string(),
  sizeBytes: z.number(),
  tier: storageTierSchema,
  ownerUsername: z.string(),
});
export type LargestFile = z.infer<typeof largestFileSchema>;

export const pgDatabaseSchema = z.object({
  name: z.string(),
  sizeBytes: z.number(),
  isProtected: z.boolean(),
});
export type PgDatabase = z.infer<typeof pgDatabaseSchema>;

export const createPgDatabaseInputSchema = z.object({
  name: postgresIdentifierSchema,
});
export type CreatePgDatabaseInput = z.infer<typeof createPgDatabaseInputSchema>;

export const pgSchemaSchema = z.object({ name: z.string() });
export type PgSchema = z.infer<typeof pgSchemaSchema>;

export const pgTableSchema = z.object({
  name: z.string(),
  schema: z.string(),
  rowEstimate: z.number(),
  sizeBytes: z.number(),
});
export type PgTable = z.infer<typeof pgTableSchema>;

export const pgColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  position: z.number().int(),
});
export type PgColumn = z.infer<typeof pgColumnSchema>;

export const pgColumnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
});
export type PgColumnInfo = z.infer<typeof pgColumnInfoSchema>;

export const pgIndexSchema = z.object({
  name: z.string(),
  definition: z.string(),
});
export type PgIndex = z.infer<typeof pgIndexSchema>;

export const pgConstraintSchema = z.object({
  name: z.string(),
  type: z.string(),
  columns: z.array(z.string()),
});
export type PgConstraint = z.infer<typeof pgConstraintSchema>;

export const pgTableDetailSchema = z.object({
  columns: z.array(pgColumnSchema),
  indexes: z.array(pgIndexSchema),
  constraints: z.array(pgConstraintSchema),
});
export type PgTableDetail = z.infer<typeof pgTableDetailSchema>;

export const pgColumnInputSchema = z.object({
  name: postgresIdentifierSchema,
  type: z.string(),
  nullable: z.boolean().optional(),
  default: z.string().max(1_000).optional(),
  primaryKey: z.boolean().optional(),
});
export type PgColumnInput = z.infer<typeof pgColumnInputSchema>;

export const createPgTableInputSchema = z.object({
  name: postgresIdentifierSchema,
  columns: z.array(pgColumnInputSchema).min(1).max(100),
});
export type CreatePgTableInput = z.infer<typeof createPgTableInputSchema>;

export const executePgQueryInputSchema = z.object({
  sql: z.string().trim().min(1).max(10_000),
});
export type ExecutePgQueryInput = z.infer<typeof executePgQueryInputSchema>;

export const pgQueryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int(),
  truncated: z.boolean(),
  durationMs: z.number(),
});
export type PgQueryResult = z.infer<typeof pgQueryResultSchema>;

export const pgQueryErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
  data: z.object({ durationMs: z.number() }),
});
export type PgQueryError = z.infer<typeof pgQueryErrorSchema>;

export const mongoDatabaseSchema = z.object({
  name: z.string(),
  sizeBytes: z.number(),
  empty: z.boolean(),
  isProtected: z.boolean(),
});
export type MongoDatabase = z.infer<typeof mongoDatabaseSchema>;

export const createMongoDatabaseInputSchema = z.object({
  name: mongoResourceNameSchema,
});
export type CreateMongoDatabaseInput = z.infer<
  typeof createMongoDatabaseInputSchema
>;

export const mongoCollectionSchema = z.object({
  name: z.string(),
  type: z.string(),
  documentCount: z.number(),
  sizeBytes: z.number(),
  indexCount: z.number().int(),
});
export type MongoCollection = z.infer<typeof mongoCollectionSchema>;

export const createMongoCollectionInputSchema = z.object({
  name: mongoResourceNameSchema,
  capped: z.boolean().optional(),
  size: z.number().positive().optional(),
  max: z.number().int().positive().optional(),
});
export type CreateMongoCollectionInput = z.infer<
  typeof createMongoCollectionInputSchema
>;

export const mongoIndexSchema = z.object({
  name: z.string(),
  key: z.record(z.string(), z.number()),
  unique: z.boolean(),
  sparse: z.boolean(),
});
export type MongoIndex = z.infer<typeof mongoIndexSchema>;

export const createMongoIndexInputSchema = z.object({
  fields: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(255)
          .refine((value) => !value.startsWith("$") && !value.includes("\0")),
        direction: z.union([z.literal(1), z.literal(-1)]),
      }),
    )
    .min(1)
    .max(32),
  unique: z.boolean().optional(),
  sparse: z.boolean().optional(),
  name: mongoResourceNameSchema.optional(),
});
export type CreateMongoIndexInput = z.infer<typeof createMongoIndexInputSchema>;

export const findMongoDocumentsInputSchema = z.object({
  filter: z.string().max(10_000).optional(),
  sort: z.string().max(10_000).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  skip: z.number().int().min(0).default(0),
});
export type FindMongoDocumentsInput = z.infer<
  typeof findMongoDocumentsInputSchema
>;

export const mongoFindResultSchema = z.object({
  documents: z.array(z.record(z.string(), z.unknown())),
  totalCount: z.number().int(),
  durationMs: z.number(),
});
export type MongoFindResult = z.infer<typeof mongoFindResultSchema>;
