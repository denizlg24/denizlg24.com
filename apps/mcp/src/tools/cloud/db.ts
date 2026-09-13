import type { McpServer } from "@modelcontextprotocol/server";
import {
  createMongoCollectionInputSchema,
  createMongoDatabaseInputSchema,
  createMongoIndexInputSchema,
  createPgDatabaseInputSchema,
  createPgTableInputSchema,
  executePgQueryInputSchema,
  findMongoDocumentsInputSchema,
  mongoResourceNameSchema,
  postgresIdentifierSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { type Api, defineTool, p } from "../define";

const database = postgresIdentifierSchema.describe("Postgres database");
const schema = postgresIdentifierSchema
  .optional()
  .describe("Schema, default public");
const table = postgresIdentifierSchema.describe("Table");
const mongoDb = mongoResourceNameSchema.describe("Mongo database");
const mongoCollection = mongoResourceNameSchema.describe("Mongo collection");

export function registerCloudDb(server: McpServer, api: Api) {
  defineTool(server, {
    name: "cloud_pg_databases_list",
    title: "Cloud: Postgres databases",
    description: "Databases on the Pi's Postgres with size and owner.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/db/postgres/databases"),
  });

  defineTool(server, {
    name: "cloud_pg_database_create",
    title: "Cloud: create Postgres database",
    description: "CREATE DATABASE.",
    input: z.object(createPgDatabaseInputSchema.shape),
    run: (body) => api.cloud.post("/api/db/postgres/databases", body),
  });

  defineTool(server, {
    name: "cloud_pg_database_delete",
    title: "Cloud: drop Postgres database",
    description: "DROP DATABASE. Refused for the cloud's own database.",
    input: z.object({ database }),
    annotations: { destructiveHint: true },
    run: ({ database }) =>
      api.cloud.delete(p`/api/db/postgres/databases/${database}`),
  });

  defineTool(server, {
    name: "cloud_pg_schemas_list",
    title: "Cloud: Postgres schemas",
    description: "Schemas of a database.",
    input: z.object({ database }),
    annotations: { readOnlyHint: true },
    run: ({ database }) =>
      api.cloud.get(p`/api/db/postgres/databases/${database}/schemas`),
  });

  defineTool(server, {
    name: "cloud_pg_tables_list",
    title: "Cloud: Postgres tables",
    description: "Tables of a schema with row estimates and sizes.",
    input: z.object({ database, schema }),
    annotations: { readOnlyHint: true },
    run: ({ database, schema }) =>
      api.cloud.get(p`/api/db/postgres/databases/${database}/tables`, {
        schema,
      }),
  });

  defineTool(server, {
    name: "cloud_pg_table_get",
    title: "Cloud: Postgres table",
    description: "Columns, indexes and constraints of a table.",
    input: z.object({ database, schema, table }),
    annotations: { readOnlyHint: true },
    run: ({ database, schema, table }) =>
      api.cloud.get(p`/api/db/postgres/databases/${database}/tables/${table}`, {
        schema,
      }),
  });

  defineTool(server, {
    name: "cloud_pg_table_create",
    title: "Cloud: create Postgres table",
    description: "CREATE TABLE from a column list.",
    input: z.object({ database, schema, ...createPgTableInputSchema.shape }),
    run: ({ database, schema, ...body }) =>
      api.cloud.post(p`/api/db/postgres/databases/${database}/tables`, body, {
        schema,
      }),
  });

  defineTool(server, {
    name: "cloud_pg_table_delete",
    title: "Cloud: drop Postgres table",
    description: "DROP TABLE.",
    input: z.object({ database, schema, table }),
    annotations: { destructiveHint: true },
    run: ({ database, schema, table }) =>
      api.cloud.delete(
        p`/api/db/postgres/databases/${database}/tables/${table}`,
        { schema },
      ),
  });

  defineTool(server, {
    name: "cloud_pg_query",
    title: "Cloud: run SQL",
    description:
      "Executes SQL in a database and returns rows. Writes are real; there is no dry run.",
    input: z.object({ database, ...executePgQueryInputSchema.shape }),
    annotations: { destructiveHint: true },
    run: ({ database, ...body }) =>
      api.cloud.post(p`/api/db/postgres/databases/${database}/query`, body),
  });

  // Mongo ------------------------------------------------------------------

  defineTool(server, {
    name: "cloud_mongo_databases_list",
    title: "Cloud: Mongo databases",
    description: "Databases on the Pi's Mongo with sizes.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/db/mongodb/databases"),
  });

  defineTool(server, {
    name: "cloud_mongo_database_create",
    title: "Cloud: create Mongo database",
    description: "Creates a database (Mongo materialises it on first write).",
    input: z.object(createMongoDatabaseInputSchema.shape),
    run: (body) => api.cloud.post("/api/db/mongodb/databases", body),
  });

  defineTool(server, {
    name: "cloud_mongo_database_delete",
    title: "Cloud: drop Mongo database",
    description: "dropDatabase.",
    input: z.object({ database: mongoDb }),
    annotations: { destructiveHint: true },
    run: ({ database }) =>
      api.cloud.delete(p`/api/db/mongodb/databases/${database}`),
  });

  defineTool(server, {
    name: "cloud_mongo_collections_list",
    title: "Cloud: Mongo collections",
    description: "Collections of a database with counts and sizes.",
    input: z.object({ database: mongoDb }),
    annotations: { readOnlyHint: true },
    run: ({ database }) =>
      api.cloud.get(p`/api/db/mongodb/databases/${database}/collections`),
  });

  defineTool(server, {
    name: "cloud_mongo_collection_create",
    title: "Cloud: create Mongo collection",
    description: "createCollection, optionally capped.",
    input: z.object({
      database: mongoDb,
      ...createMongoCollectionInputSchema.shape,
    }),
    run: ({ database, ...body }) =>
      api.cloud.post(
        p`/api/db/mongodb/databases/${database}/collections`,
        body,
      ),
  });

  defineTool(server, {
    name: "cloud_mongo_collection_delete",
    title: "Cloud: drop Mongo collection",
    description: "Drops a collection.",
    input: z.object({ database: mongoDb, collection: mongoCollection }),
    annotations: { destructiveHint: true },
    run: ({ database, collection }) =>
      api.cloud.delete(
        p`/api/db/mongodb/databases/${database}/collections/${collection}`,
      ),
  });

  defineTool(server, {
    name: "cloud_mongo_indexes_list",
    title: "Cloud: Mongo indexes",
    description: "Indexes of a collection.",
    input: z.object({ database: mongoDb, collection: mongoCollection }),
    annotations: { readOnlyHint: true },
    run: ({ database, collection }) =>
      api.cloud.get(
        p`/api/db/mongodb/databases/${database}/collections/${collection}/indexes`,
      ),
  });

  defineTool(server, {
    name: "cloud_mongo_index_create",
    title: "Cloud: create Mongo index",
    description: "createIndex on the given fields.",
    input: z.object({
      database: mongoDb,
      collection: mongoCollection,
      ...createMongoIndexInputSchema.shape,
    }),
    run: ({ database, collection, ...body }) =>
      api.cloud.post(
        p`/api/db/mongodb/databases/${database}/collections/${collection}/indexes`,
        body,
      ),
  });

  defineTool(server, {
    name: "cloud_mongo_index_delete",
    title: "Cloud: drop Mongo index",
    description: "dropIndex by name.",
    input: z.object({
      database: mongoDb,
      collection: mongoCollection,
      index: z.string().min(1),
    }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ database, collection, index }) =>
      api.cloud.delete(
        p`/api/db/mongodb/databases/${database}/collections/${collection}/indexes/${index}`,
      ),
  });

  defineTool(server, {
    name: "cloud_mongo_sample",
    title: "Cloud: sample Mongo documents",
    description: "A few documents from a collection, for shape discovery.",
    input: z.object({ database: mongoDb, collection: mongoCollection }),
    annotations: { readOnlyHint: true },
    run: ({ database, collection }) =>
      api.cloud.get(
        p`/api/db/mongodb/databases/${database}/collections/${collection}/sample`,
      ),
  });

  defineTool(server, {
    name: "cloud_mongo_find",
    title: "Cloud: find Mongo documents",
    description: "find with filter, sort, limit and skip.",
    input: z.object({
      database: mongoDb,
      collection: mongoCollection,
      ...findMongoDocumentsInputSchema.shape,
    }),
    annotations: { readOnlyHint: true },
    run: ({ database, collection, ...body }) =>
      api.cloud.post(
        p`/api/db/mongodb/databases/${database}/collections/${collection}/find`,
        body,
      ),
  });
}
