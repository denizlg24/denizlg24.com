import {
  type AuthVariables,
  createRawClient,
  type Database,
  type RawSqlClient,
} from "@repo/cloud-core";
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
import { Hono } from "hono";
import type { Document, MongoClient } from "mongodb";

const ALLOWED_POSTGRES_TYPES = new Set([
  "serial",
  "bigserial",
  "integer",
  "bigint",
  "smallint",
  "text",
  "varchar",
  "char",
  "boolean",
  "timestamp",
  "timestamptz",
  "date",
  "time",
  "numeric",
  "real",
  "double precision",
  "jsonb",
  "json",
  "uuid",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
]);
const PROTECTED_MONGO_DATABASES = new Set(["admin", "config", "local"]);

interface DbAdminOptions {
  db: Database;
  databaseUrl: string;
  mongo: MongoClient;
}

function appDatabaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}

function connectionString(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

async function withDatabase<T>(
  databaseUrl: string,
  database: string,
  operation: (sql: RawSqlClient) => Promise<T>,
): Promise<T> {
  const sql = createRawClient(connectionString(databaseUrl, database), {
    max: 1,
  });
  try {
    return await operation(sql);
  } finally {
    await sql.end();
  }
}

function quotedIdentifier(value: string): string {
  const parsed = postgresIdentifierSchema.parse(value);
  return `"${parsed}"`;
}

function parsedJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON value must be an object");
  }
  return parsed as Record<string, unknown>;
}

function parsedSort(
  value: string | undefined,
): Record<string, 1 | -1> | undefined {
  if (!value?.trim()) return undefined;
  const parsed = parsedJsonObject(value);
  const result: Record<string, 1 | -1> = {};
  for (const [field, direction] of Object.entries(parsed)) {
    if (direction !== 1 && direction !== -1) {
      throw new Error("Sort directions must be 1 or -1");
    }
    result[field] = direction;
  }
  return result;
}

export function postgresDbAdminRoutes(options: DbAdminOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const protectedDatabases = new Set([
    "postgres",
    "template0",
    "template1",
    appDatabaseName(options.databaseUrl),
  ]);

  app.get("/databases", async (context) => {
    const rows = await options.db.$client`
      SELECT datname AS name,
             pg_database_size(datname)::bigint AS size_bytes
      FROM pg_database
      WHERE NOT datistemplate
      ORDER BY datname
    `;
    return context.json({
      data: rows.map((row) => ({
        name: String(row.name),
        sizeBytes: Number(row.size_bytes),
        isProtected: protectedDatabases.has(String(row.name)),
      })),
    });
  });

  app.post("/databases", async (context) => {
    const parsed = createPgDatabaseInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid database name" } },
        400,
      );
    }
    await options.db.$client.unsafe(
      `CREATE DATABASE ${quotedIdentifier(parsed.data.name)}`,
    );
    return context.json({ data: { name: parsed.data.name } }, 201);
  });

  app.delete("/databases/:name", async (context) => {
    const parsed = postgresIdentifierSchema.safeParse(
      context.req.param("name"),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid database name" } },
        400,
      );
    }
    if (protectedDatabases.has(parsed.data)) {
      return context.json(
        {
          error: {
            code: "PROTECTED_DATABASE",
            message: `Database "${parsed.data}" cannot be dropped`,
          },
        },
        403,
      );
    }
    await options.db.$client`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${parsed.data} AND pid <> pg_backend_pid()
    `;
    await options.db.$client.unsafe(
      `DROP DATABASE ${quotedIdentifier(parsed.data)}`,
    );
    return context.json({ data: { dropped: parsed.data } });
  });

  app.get("/databases/:name/schemas", async (context) => {
    const database = postgresIdentifierSchema.parse(context.req.param("name"));
    const rows = await withDatabase(
      options.databaseUrl,
      database,
      (sql) => sql`
        SELECT schema_name AS name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY schema_name
      `,
    );
    return context.json({
      data: rows.map((row) => ({ name: String(row.name) })),
    });
  });

  app.get("/databases/:name/tables", async (context) => {
    const database = postgresIdentifierSchema.parse(context.req.param("name"));
    const schema = postgresIdentifierSchema.parse(
      context.req.query("schema") ?? "public",
    );
    const rows = await withDatabase(
      options.databaseUrl,
      database,
      (sql) => sql`
        SELECT t.table_name AS name,
               t.table_schema AS schema,
               COALESCE(c.reltuples::bigint, 0) AS row_estimate,
               COALESCE(pg_total_relation_size(
                 quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)
               )::bigint, 0) AS size_bytes
        FROM information_schema.tables t
        LEFT JOIN pg_class c ON c.relname = t.table_name
        LEFT JOIN pg_namespace n
          ON n.oid = c.relnamespace AND n.nspname = t.table_schema
        WHERE t.table_schema = ${schema} AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `,
    );
    return context.json({
      data: rows.map((row) => ({
        name: String(row.name),
        schema: String(row.schema),
        rowEstimate: Math.max(0, Number(row.row_estimate)),
        sizeBytes: Number(row.size_bytes),
      })),
    });
  });

  app.get("/databases/:name/tables/:table", async (context) => {
    const database = postgresIdentifierSchema.parse(context.req.param("name"));
    const table = postgresIdentifierSchema.parse(context.req.param("table"));
    const schema = postgresIdentifierSchema.parse(
      context.req.query("schema") ?? "public",
    );
    const detail = await withDatabase(
      options.databaseUrl,
      database,
      async (sql) => {
        const [columns, indexes, constraints] = await Promise.all([
          sql`
            SELECT column_name, data_type, is_nullable, column_default,
                   ordinal_position
            FROM information_schema.columns
            WHERE table_schema = ${schema} AND table_name = ${table}
            ORDER BY ordinal_position
          `,
          sql`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = ${schema} AND tablename = ${table}
            ORDER BY indexname
          `,
          sql`
            SELECT tc.constraint_name, tc.constraint_type,
                   array_agg(ccu.column_name ORDER BY ccu.column_name) AS columns
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = ${schema} AND tc.table_name = ${table}
            GROUP BY tc.constraint_name, tc.constraint_type
            ORDER BY tc.constraint_name
          `,
        ]);
        return { columns, indexes, constraints };
      },
    );
    return context.json({
      data: {
        columns: detail.columns.map((column) => ({
          name: String(column.column_name),
          type: String(column.data_type),
          nullable: column.is_nullable === "YES",
          default:
            column.column_default === null
              ? null
              : String(column.column_default),
          position: Number(column.ordinal_position),
        })),
        indexes: detail.indexes.map((index) => ({
          name: String(index.indexname),
          definition: String(index.indexdef),
        })),
        constraints: detail.constraints.map((constraint) => ({
          name: String(constraint.constraint_name),
          type: String(constraint.constraint_type),
          columns: constraint.columns,
        })),
      },
    });
  });

  app.post("/databases/:name/tables", async (context) => {
    const database = postgresIdentifierSchema.parse(context.req.param("name"));
    const schema = postgresIdentifierSchema.parse(
      context.req.query("schema") ?? "public",
    );
    const parsed = createPgTableInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: { code: "INVALID_INPUT", message: "Invalid table definition" },
        },
        400,
      );
    }
    const primaryKeys: string[] = [];
    const definitions = parsed.data.columns.map((column) => {
      const type = column.type.toLowerCase();
      if (!ALLOWED_POSTGRES_TYPES.has(type)) {
        throw new Error(`Disallowed column type: ${column.type}`);
      }
      if (column.primaryKey) primaryKeys.push(quotedIdentifier(column.name));
      return [
        quotedIdentifier(column.name),
        type,
        column.nullable === false ? "NOT NULL" : "",
        column.default ? `DEFAULT ${column.default}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    });
    if (primaryKeys.length > 0) {
      definitions.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
    }
    await withDatabase(options.databaseUrl, database, async (sql) => {
      await sql.unsafe(
        `CREATE TABLE ${quotedIdentifier(schema)}.${quotedIdentifier(parsed.data.name)} (${definitions.join(", ")})`,
      );
    });
    return context.json({ data: { name: parsed.data.name, schema } }, 201);
  });

  app.delete("/databases/:name/tables/:table", async (context) => {
    const database = postgresIdentifierSchema.parse(context.req.param("name"));
    const table = postgresIdentifierSchema.parse(context.req.param("table"));
    const schema = postgresIdentifierSchema.parse(
      context.req.query("schema") ?? "public",
    );
    if (
      database === appDatabaseName(options.databaseUrl) &&
      new Set([
        "users",
        "sessions",
        "files",
        "folders",
        "api_keys",
        "projects",
        "project_collections",
        "project_databases",
        "s3_credentials",
      ]).has(table)
    ) {
      return context.json(
        {
          error: {
            code: "PROTECTED_TABLE",
            message: `Table "${table}" is managed by the application`,
          },
        },
        403,
      );
    }
    await withDatabase(options.databaseUrl, database, async (sql) => {
      await sql.unsafe(
        `DROP TABLE ${quotedIdentifier(schema)}.${quotedIdentifier(table)}`,
      );
    });
    return context.json({ data: { dropped: table } });
  });

  app.post("/databases/:name/query", async (context) => {
    const database = postgresIdentifierSchema.parse(context.req.param("name"));
    const parsed = executePgQueryInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid SQL query" } },
        400,
      );
    }
    const started = performance.now();
    try {
      const result = await withDatabase(
        options.databaseUrl,
        database,
        async (sql) => sql.unsafe(parsed.data.sql),
      );
      const rows = Array.isArray(result) ? result : [];
      return context.json({
        data: {
          columns:
            rows.length > 0
              ? Object.keys(rows[0] as Record<string, unknown>)
              : [],
          rows: rows.slice(0, 500),
          rowCount: result.count ?? rows.length,
          truncated: rows.length > 500,
          durationMs: Math.round(performance.now() - started),
        },
      });
    } catch (error) {
      return context.json(
        {
          error: {
            code: "QUERY_ERROR",
            message: error instanceof Error ? error.message : "Query failed",
          },
          data: { durationMs: Math.round(performance.now() - started) },
        },
        400,
      );
    }
  });

  return app;
}

export function mongoDbAdminRoutes(options: DbAdminOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/databases", async (context) => {
    const result = await options.mongo.db().admin().listDatabases();
    return context.json({
      data: result.databases.map((database) => ({
        name: database.name,
        sizeBytes: database.sizeOnDisk ?? 0,
        empty: database.empty ?? false,
        isProtected: PROTECTED_MONGO_DATABASES.has(database.name),
      })),
    });
  });

  app.post("/databases", async (context) => {
    const parsed = createMongoDatabaseInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid database name" } },
        400,
      );
    }
    await options.mongo.db(parsed.data.name).createCollection("_init");
    return context.json({ data: { name: parsed.data.name } }, 201);
  });

  app.delete("/databases/:name", async (context) => {
    const name = mongoResourceNameSchema.parse(context.req.param("name"));
    if (PROTECTED_MONGO_DATABASES.has(name)) {
      return context.json(
        {
          error: {
            code: "PROTECTED_DATABASE",
            message: `Database "${name}" cannot be dropped`,
          },
        },
        403,
      );
    }
    await options.mongo.db(name).dropDatabase();
    return context.json({ data: { dropped: name } });
  });

  app.get("/databases/:name/collections", async (context) => {
    const name = mongoResourceNameSchema.parse(context.req.param("name"));
    const database = options.mongo.db(name);
    const collections = await database.listCollections().toArray();
    const data = await Promise.all(
      collections.map(async (metadata) => {
        const collection = database.collection(metadata.name);
        const [documentCount, indexes] = await Promise.all([
          collection.estimatedDocumentCount().catch(() => 0),
          collection.indexes().catch(() => []),
        ]);
        return {
          name: metadata.name,
          type: metadata.type,
          documentCount,
          sizeBytes: 0,
          indexCount: indexes.length,
        };
      }),
    );
    return context.json({ data });
  });

  app.post("/databases/:name/collections", async (context) => {
    const database = mongoResourceNameSchema.parse(context.req.param("name"));
    const parsed = createMongoCollectionInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid collection" } },
        400,
      );
    }
    await options.mongo.db(database).createCollection(parsed.data.name, {
      ...(parsed.data.capped ? { capped: true } : {}),
      ...(parsed.data.size ? { size: parsed.data.size } : {}),
      ...(parsed.data.max ? { max: parsed.data.max } : {}),
    });
    return context.json({ data: { name: parsed.data.name } }, 201);
  });

  app.delete("/databases/:name/collections/:collection", async (context) => {
    const database = mongoResourceNameSchema.parse(context.req.param("name"));
    const collection = mongoResourceNameSchema.parse(
      context.req.param("collection"),
    );
    await options.mongo.db(database).dropCollection(collection);
    return context.json({ data: { dropped: collection } });
  });

  app.get(
    "/databases/:name/collections/:collection/indexes",
    async (context) => {
      const database = mongoResourceNameSchema.parse(context.req.param("name"));
      const collection = mongoResourceNameSchema.parse(
        context.req.param("collection"),
      );
      const indexes = await options.mongo
        .db(database)
        .collection(collection)
        .indexes();
      return context.json({
        data: indexes.map((index) => ({
          name: index.name,
          key: index.key,
          unique: index.unique ?? false,
          sparse: index.sparse ?? false,
        })),
      });
    },
  );

  app.post(
    "/databases/:name/collections/:collection/indexes",
    async (context) => {
      const database = mongoResourceNameSchema.parse(context.req.param("name"));
      const collection = mongoResourceNameSchema.parse(
        context.req.param("collection"),
      );
      const parsed = createMongoIndexInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json(
          { error: { code: "INVALID_INPUT", message: "Invalid index" } },
          400,
        );
      }
      const keys: Record<string, 1 | -1> = {};
      for (const field of parsed.data.fields) {
        keys[field.name] = field.direction;
      }
      const name = await options.mongo
        .db(database)
        .collection(collection)
        .createIndex(keys, {
          unique: parsed.data.unique,
          sparse: parsed.data.sparse,
          name: parsed.data.name,
        });
      return context.json({ data: { name } }, 201);
    },
  );

  app.delete(
    "/databases/:name/collections/:collection/indexes/:index",
    async (context) => {
      const database = mongoResourceNameSchema.parse(context.req.param("name"));
      const collection = mongoResourceNameSchema.parse(
        context.req.param("collection"),
      );
      const index = mongoResourceNameSchema.parse(context.req.param("index"));
      if (index === "_id_") {
        return context.json(
          {
            error: {
              code: "PROTECTED_INDEX",
              message: "The _id_ index cannot be dropped",
            },
          },
          403,
        );
      }
      await options.mongo.db(database).collection(collection).dropIndex(index);
      return context.json({ data: { dropped: index } });
    },
  );

  app.get(
    "/databases/:name/collections/:collection/sample",
    async (context) => {
      const database = mongoResourceNameSchema.parse(context.req.param("name"));
      const collection = mongoResourceNameSchema.parse(
        context.req.param("collection"),
      );
      const documents = await options.mongo
        .db(database)
        .collection(collection)
        .find()
        .limit(5)
        .toArray();
      return context.json({ data: documents });
    },
  );

  app.post("/databases/:name/collections/:collection/find", async (context) => {
    const database = mongoResourceNameSchema.parse(context.req.param("name"));
    const collectionName = mongoResourceNameSchema.parse(
      context.req.param("collection"),
    );
    const parsed = findMongoDocumentsInputSchema.safeParse(
      await context.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid query" } },
        400,
      );
    }
    const started = performance.now();
    try {
      const filter = parsedJsonObject(parsed.data.filter) as Document;
      const sort = parsedSort(parsed.data.sort);
      const collection = options.mongo.db(database).collection(collectionName);
      let cursor = collection
        .find(filter)
        .skip(parsed.data.skip)
        .limit(parsed.data.limit);
      if (sort) cursor = cursor.sort(sort);
      const [documents, totalCount] = await Promise.all([
        cursor.toArray(),
        collection.countDocuments(filter),
      ]);
      return context.json({
        data: {
          documents,
          totalCount,
          durationMs: Math.round(performance.now() - started),
        },
      });
    } catch (error) {
      return context.json(
        {
          error: {
            code: "QUERY_ERROR",
            message: error instanceof Error ? error.message : "Query failed",
          },
          data: { durationMs: Math.round(performance.now() - started) },
        },
        400,
      );
    }
  });

  return app;
}
